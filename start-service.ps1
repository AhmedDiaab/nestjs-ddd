#Requires -RunAsAdministrator
<#
.SYNOPSIS
    Installs (or reinstalls) the API as a Windows service with NSSM and starts it.

.DESCRIPTION
    - Runs `node dist\main.js` directly (no npm wrapper), so stop signals reach Node
      and Nest shutdown hooks can drain database pools.
    - Only NODE_ENV is set on the service. dotenv-flow loads `.env.<Environment>` from the
      app directory at startup, with the same parsing as local development
      (quotes, inline comments). Secrets are not copied into the service registry.
    - stdout/stderr go to logs\ with NSSM rotation.

    Prerequisites: nssm on PATH, Node.js >= 22.18, `pnpm install` and `pnpm build` done.

.EXAMPLE
    .\start-service.ps1
.EXAMPLE
    .\start-service.ps1 -ServiceName MyApiService -Environment staging -NodePath "E:\node\node.exe"
#>
param(
    [string]$ServiceName = "NestjsDddApiService",

    [ValidateSet("production", "staging", "development", "test")]
    [string]$Environment = "production",

    # Defaults to the node.exe found on PATH
    [string]$NodePath,

    # Time NSSM waits after Ctrl+C before killing Node.
    # Must be >= drainDelayMs + forceAfterMs + jobDrainMs + slack (the SHUTDOWN_* env vars), or a
    # slow drain gets SIGKILLed mid-shutdown instead of finishing cleanly.
    [int]$StopTimeoutMs = 30000
)

$ErrorActionPreference = "Stop"

# ============================================
# Configuration
# ============================================
$AppDir    = $PSScriptRoot
$EntryFile = Join-Path $AppDir "dist\main.js"
$EnvFile   = Join-Path $AppDir ".env.$Environment"
$LogDir    = Join-Path $AppDir "logs"
$MinNode   = [version]"22.18.0"

function Invoke-Nssm {
    param([Parameter(ValueFromRemainingArguments = $true)][string[]]$NssmArgs)
    & nssm @NssmArgs | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw "nssm $($NssmArgs -join ' ') failed with exit code $LASTEXITCODE"
    }
}

# ============================================
# Checks
# ============================================
if (-not (Get-Command nssm -ErrorAction SilentlyContinue)) {
    Write-Error "nssm was not found on PATH. Install it from https://nssm.cc and retry."
    exit 1
}

if (-not $NodePath) {
    $nodeCommand = Get-Command node -ErrorAction SilentlyContinue
    if (-not $nodeCommand) {
        Write-Error "node was not found on PATH. Pass -NodePath `"<path>\node.exe`"."
        exit 1
    }
    $NodePath = $nodeCommand.Source
}

if (-not (Test-Path $NodePath)) {
    Write-Error "Node executable not found at $NodePath"
    exit 1
}

$nodeVersion = [version]((& $NodePath --version).TrimStart("v"))
if ($nodeVersion -lt $MinNode) {
    Write-Error "Node $nodeVersion found at $NodePath; $MinNode or newer is required."
    exit 1
}

if (-not (Test-Path $EntryFile)) {
    Write-Error "Build output not found at $EntryFile. Run 'pnpm install' and 'pnpm build' first."
    exit 1
}

if (-not (Test-Path $EnvFile)) {
    Write-Warning "$EnvFile not found. The service will rely on system environment variables only."
}

if (-not (Test-Path $LogDir)) {
    Write-Host "Creating logs directory..."
    New-Item -ItemType Directory -Path $LogDir | Out-Null
}

# ============================================
# (Re)install
# ============================================
Write-Host "Checking if service '$ServiceName' already exists..."
& nssm status $ServiceName 2>&1 | Out-Null
if ($LASTEXITCODE -eq 0) {
    Write-Host "Service '$ServiceName' exists. Stopping and removing it to apply the current configuration..."
    & nssm stop $ServiceName 2>&1 | Out-Null   # fails harmlessly if already stopped
    Invoke-Nssm remove $ServiceName confirm
}

Write-Host "Installing service '$ServiceName' (node $nodeVersion, NODE_ENV=$Environment)..."
Invoke-Nssm install $ServiceName $NodePath $EntryFile

Write-Host "Configuring service..."
Invoke-Nssm set $ServiceName AppDirectory $AppDir
Invoke-Nssm set $ServiceName AppEnvironmentExtra "NODE_ENV=$Environment"
Invoke-Nssm set $ServiceName DisplayName $ServiceName
Invoke-Nssm set $ServiceName Description "NestJS API ($Environment) - $AppDir"
Invoke-Nssm set $ServiceName Start SERVICE_AUTO_START

# graceful stop: Ctrl+C -> SIGINT -> Nest shutdown hooks (pool drain)
Invoke-Nssm set $ServiceName AppStopMethodConsole $StopTimeoutMs

# restart on crash, with a delay to avoid tight loops
Invoke-Nssm set $ServiceName AppExit Default Restart
Invoke-Nssm set $ServiceName AppRestartDelay 5000

# console output, rotated by NSSM (application logs are rotated by pino-roll)
Invoke-Nssm set $ServiceName AppStdout (Join-Path $LogDir "service-stdout.log")
Invoke-Nssm set $ServiceName AppStderr (Join-Path $LogDir "service-stderr.log")
Invoke-Nssm set $ServiceName AppRotateFiles 1
Invoke-Nssm set $ServiceName AppRotateOnline 1
Invoke-Nssm set $ServiceName AppRotateBytes 10485760

# ============================================
# Start
# ============================================
Write-Host "Starting service..."
Invoke-Nssm start $ServiceName

Write-Host ""
Write-Host "Done. Service '$ServiceName' is running."
& nssm status $ServiceName
