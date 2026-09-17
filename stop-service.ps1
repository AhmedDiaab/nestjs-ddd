#Requires -RunAsAdministrator
<#
.SYNOPSIS
    Stops the API Windows service. Add -Remove to also unregister it.

.DESCRIPTION
    NSSM sends Ctrl+C first and waits AppStopMethodConsole ms (set by start-service.ps1),
    so Nest shutdown hooks can drain database pools before the process is killed.

.EXAMPLE
    .\stop-service.ps1
.EXAMPLE
    .\stop-service.ps1 -ServiceName MyApiService -Remove
#>
param(
    # Must match the name used with start-service.ps1
    [string]$ServiceName = "NestjsDddApiService",

    # Also unregister the service (default: stop only, keep it registered)
    [switch]$Remove
)

$ErrorActionPreference = "Stop"

if (-not (Get-Command nssm -ErrorAction SilentlyContinue)) {
    Write-Error "nssm was not found on PATH."
    exit 1
}

Write-Host "Checking if service '$ServiceName' exists..."
& nssm status $ServiceName 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) {
    Write-Warning "Service '$ServiceName' does not exist. Nothing to do."
    exit 0
}

$status = (Get-Service -Name $ServiceName).Status
if ($status -ne "Stopped") {
    Write-Host "Stopping service '$ServiceName'..."
    & nssm stop $ServiceName
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Failed to stop '$ServiceName' (nssm exit code $LASTEXITCODE)."
        exit 1
    }
} else {
    Write-Host "Service '$ServiceName' is already stopped."
}

if ($Remove) {
    Write-Host "Removing service '$ServiceName'..."
    & nssm remove $ServiceName confirm
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Failed to remove '$ServiceName' (nssm exit code $LASTEXITCODE)."
        exit 1
    }
    Write-Host "Done. Service '$ServiceName' has been stopped and removed."
} else {
    Write-Host "Done. Service '$ServiceName' has been stopped (still registered)."
}
