<#
.SYNOPSIS
    Checks start-service.ps1 / stop-service.ps1 without Windows: parses them, then runs them with
    `nssm`, `node` and `Get-Service` replaced by recorders and asserts the NSSM calls per scenario.
    Run through Docker: pnpm test:service-scripts
    Real service registration still needs Windows.
#>
$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$failures = [System.Collections.Generic.List[string]]::new()
$passed = 0

function Assert-True([bool]$condition, [string]$message) {
    if (-not $condition) { throw $message }
}

# ---------- syntax ----------
foreach ($name in "start-service.ps1", "stop-service.ps1") {
    $tokens = $null; $errors = $null
    [System.Management.Automation.Language.Parser]::ParseFile((Join-Path $repo $name), [ref]$tokens, [ref]$errors) | Out-Null
    if ($errors.Count -gt 0) {
        $failures.Add("$name has syntax errors: $($errors | ForEach-Object { $_.Message } | Join-String -Separator '; ')")
    } else {
        $passed++
        Write-Host "  ok  $name parses"
    }
}

# ---------- sandbox ----------
function New-Sandbox {
    param([string]$NodeVersion = "22.18.0", [switch]$NoBuild)
    $dir = Join-Path ([System.IO.Path]::GetTempPath()) ("svc-" + [guid]::NewGuid())
    $bin = Join-Path $dir "bin"
    New-Item -ItemType Directory -Path $bin | Out-Null
    Copy-Item (Join-Path $repo "start-service.ps1"), (Join-Path $repo "stop-service.ps1") $dir
    # the scripts join Windows paths ("dist\main.js"); PowerShell on Linux maps "\" to "/"
    if (-not $NoBuild) { New-Item -ItemType File -Force -Path (Join-Path $dir "dist/main.js") | Out-Null }

    @'
#!/bin/sh
echo "$*" >> "$FAKE_NSSM_LOG"
case "$1" in
  status) grep -q '^install ' "$FAKE_NSSM_LOG" && exit 0; exit "${FAKE_NSSM_STATUS_EXIT:-0}" ;;
  stop)   exit "${FAKE_NSSM_STOP_EXIT:-0}" ;;
  set)    [ "$3" = "${FAKE_NSSM_FAIL_SET:-}" ] && exit 5 ;;
esac
exit 0
'@ | Set-Content -Path (Join-Path $bin "nssm") -NoNewline
    "#!/bin/sh`necho v$NodeVersion" | Set-Content -Path (Join-Path $bin "node") -NoNewline
    chmod +x (Join-Path $bin "nssm") (Join-Path $bin "node")
    return $dir
}

function Invoke-Scenario {
    param([string]$Dir, [string]$Script, [string]$Arguments = "", [hashtable]$Env = @{})
    $log = Join-Path $Dir "nssm.log"
    $childEnv = @{ FAKE_NSSM_LOG = $log; PATH = "$(Join-Path $Dir 'bin'):$env:PATH" } + $Env
    $status = if ($Env.ContainsKey("FAKE_SERVICE_STATUS")) { $Env.FAKE_SERVICE_STATUS } else { "Running" }
    $command = "function Get-Service { param(`$Name) [pscustomobject]@{ Name = `$Name; Status = '$status' } }; & '$(Join-Path $Dir $Script)' $Arguments; exit `$LASTEXITCODE"

    $previous = @{}
    foreach ($key in $childEnv.Keys) { $previous[$key] = [Environment]::GetEnvironmentVariable($key); [Environment]::SetEnvironmentVariable($key, [string]$childEnv[$key]) }
    try {
        $output = & pwsh -NoProfile -NonInteractive -Command $command 2>&1 | Out-String
        $exitCode = $LASTEXITCODE
    } finally {
        foreach ($key in $previous.Keys) { [Environment]::SetEnvironmentVariable($key, $previous[$key]) }
    }
    $calls = if (Test-Path $log) { @(Get-Content $log) } else { @() }
    return [pscustomobject]@{ ExitCode = $exitCode; Calls = $calls; Output = $output }
}

function Test-Case([string]$name, [scriptblock]$body) {
    try {
        & $body
        $script:passed++
        Write-Host "  ok  $name"
    } catch {
        $failures.Add("$name`: $($_.Exception.Message)")
        Write-Host "  FAIL $name`: $($_.Exception.Message)"
    }
}

# ---------- start-service.ps1 ----------
Test-Case "start: fresh install configures and starts the service" {
    $dir = New-Sandbox
    $r = Invoke-Scenario $dir "start-service.ps1" "-Environment staging" @{ FAKE_NSSM_STATUS_EXIT = 3 }
    Assert-True ($r.ExitCode -eq 0) "exit code $($r.ExitCode): $($r.Output)"
    Assert-True (-not ($r.Calls -match '^(stop|remove) ')) "stopped/removed a service that did not exist"
    Assert-True (@($r.Calls -match "^install NestjsDddApiService .*node .*dist[\\/]main\.js$").Count -eq 1) "no install with node + dist\main.js: $($r.Calls -join ' | ')"
    Assert-True ($r.Calls -contains "set NestjsDddApiService AppEnvironmentExtra NODE_ENV=staging") "NODE_ENV not set to staging"
    Assert-True ($r.Calls -contains "set NestjsDddApiService AppStopMethodConsole 30000") "graceful stop timeout not set"
    Assert-True ($r.Calls -contains "set NestjsDddApiService AppExit Default Restart") "restart policy not set"
    Assert-True ($r.Calls[-2] -eq "start NestjsDddApiService") "service not started last: $($r.Calls[-2])"
    Assert-True (-not ($r.Calls -match 'JWT_SECRET|PASSWORD')) "secrets passed to nssm"
}

Test-Case "start: existing service is stopped and removed before reinstall" {
    $dir = New-Sandbox
    $r = Invoke-Scenario $dir "start-service.ps1" "-ServiceName OrdersApiService" @{ FAKE_NSSM_STATUS_EXIT = 0 }
    Assert-True ($r.ExitCode -eq 0) "exit code $($r.ExitCode): $($r.Output)"
    $stop = [array]::IndexOf($r.Calls, "stop OrdersApiService")
    $remove = [array]::IndexOf($r.Calls, "remove OrdersApiService confirm")
    $install = ($r.Calls | Select-String -Pattern '^install OrdersApiService' | Select-Object -First 1).LineNumber - 1
    Assert-True ($stop -ge 0 -and $remove -gt $stop -and $install -gt $remove) "expected stop -> remove -> install, got: $($r.Calls -join ' | ')"
}

Test-Case "start: refuses Node older than 22.18" {
    $dir = New-Sandbox -NodeVersion "20.14.0"
    $r = Invoke-Scenario $dir "start-service.ps1" "" @{ FAKE_NSSM_STATUS_EXIT = 3 }
    Assert-True ($r.ExitCode -ne 0) "should fail"
    Assert-True (-not ($r.Calls -match '^install ')) "installed anyway"
}

Test-Case "start: refuses to install without build output" {
    $dir = New-Sandbox -NoBuild
    $r = Invoke-Scenario $dir "start-service.ps1" "" @{ FAKE_NSSM_STATUS_EXIT = 3 }
    Assert-True ($r.ExitCode -ne 0) "should fail"
    Assert-True ($r.Output -match "pnpm build") "error does not mention pnpm build: $($r.Output)"
    Assert-True (-not ($r.Calls -match '^install ')) "installed anyway"
}

Test-Case "start: a failing nssm call aborts before starting" {
    $dir = New-Sandbox
    $r = Invoke-Scenario $dir "start-service.ps1" "" @{ FAKE_NSSM_STATUS_EXIT = 3; FAKE_NSSM_FAIL_SET = "AppDirectory" }
    Assert-True ($r.ExitCode -ne 0) "should fail"
    Assert-True (-not ($r.Calls -match '^start ')) "started despite failed configuration"
}

# ---------- stop-service.ps1 ----------
Test-Case "stop: running service is stopped and kept registered" {
    $dir = New-Sandbox
    $r = Invoke-Scenario $dir "stop-service.ps1" "" @{ FAKE_NSSM_STATUS_EXIT = 0 }
    Assert-True ($r.ExitCode -eq 0) "exit code $($r.ExitCode): $($r.Output)"
    Assert-True ($r.Calls -contains "stop NestjsDddApiService") "not stopped"
    Assert-True (-not ($r.Calls -match '^remove ')) "removed without -Remove"
}

Test-Case "stop: -Remove also unregisters the service" {
    $dir = New-Sandbox
    $r = Invoke-Scenario $dir "stop-service.ps1" "-Remove" @{ FAKE_NSSM_STATUS_EXIT = 0 }
    Assert-True ($r.ExitCode -eq 0) "exit code $($r.ExitCode): $($r.Output)"
    Assert-True ($r.Calls -contains "remove NestjsDddApiService confirm") "not removed"
}

Test-Case "stop: already stopped service is not stopped again" {
    $dir = New-Sandbox
    $r = Invoke-Scenario $dir "stop-service.ps1" "" @{ FAKE_NSSM_STATUS_EXIT = 0; FAKE_SERVICE_STATUS = "Stopped" }
    Assert-True ($r.ExitCode -eq 0) "exit code $($r.ExitCode)"
    Assert-True (-not ($r.Calls -match '^stop ')) "called stop on a stopped service"
}

Test-Case "stop: missing service is a no-op" {
    $dir = New-Sandbox
    $r = Invoke-Scenario $dir "stop-service.ps1" "-Remove" @{ FAKE_NSSM_STATUS_EXIT = 3 }
    Assert-True ($r.ExitCode -eq 0) "exit code $($r.ExitCode)"
    Assert-True ($r.Calls.Count -eq 1) "expected only a status call: $($r.Calls -join ' | ')"
}

Test-Case "stop: a failing nssm stop exits non-zero" {
    $dir = New-Sandbox
    $r = Invoke-Scenario $dir "stop-service.ps1" "-Remove" @{ FAKE_NSSM_STATUS_EXIT = 0; FAKE_NSSM_STOP_EXIT = 1 }
    Assert-True ($r.ExitCode -ne 0) "should fail"
    Assert-True (-not ($r.Calls -match '^remove ')) "removed after a failed stop"
}

Write-Host ""
Write-Host "$passed passed, $($failures.Count) failed"
if ($failures.Count -gt 0) {
    $failures | ForEach-Object { Write-Host " - $_" }
    exit 1
}
