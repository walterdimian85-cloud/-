$ErrorActionPreference = "Stop"
$agentRoot = Split-Path -Parent $PSScriptRoot
$errorLog = Join-Path $agentRoot "agent-startup-error.log"
$agentUrl = "http://127.0.0.1:8765"
$expectedBuild = "20260830-safe-reselect-v1"

function Get-AgentServerStatus {
  try {
    return Invoke-RestMethod -Uri "$agentUrl/api/status" -TimeoutSec 2
  } catch {
    return $null
  }
}

try {
  Set-Location -LiteralPath $agentRoot

  $existingStatus = Get-AgentServerStatus
  if ($existingStatus) {
    if ($existingStatus.serverBuild -eq $expectedBuild) {
      Write-Host "Judicial Auction Agent is already running." -ForegroundColor Green
      Write-Host "Opening the existing page at $agentUrl" -ForegroundColor Green
      Start-Process $agentUrl
      exit 0
    }
    $listener = Get-NetTCPConnection -LocalPort 8765 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($listener) {
      $processInfo = Get-CimInstance Win32_Process -Filter "ProcessId=$($listener.OwningProcess)" -ErrorAction SilentlyContinue
      if ($processInfo -and $processInfo.CommandLine -match 'bin[\\/]agent-cli\.mjs\s+serve') {
        Write-Host "An older Agent backend is running. Restarting it with the current version..." -ForegroundColor Yellow
        Stop-Process -Id $listener.OwningProcess -Force
        Start-Sleep -Milliseconds 800
      } else {
        throw "Port 8765 is occupied by a different program and cannot be restarted automatically."
      }
    }
  }

  $portInUse = Get-NetTCPConnection -LocalPort 8765 -State Listen -ErrorAction SilentlyContinue
  if ($portInUse) {
    throw "Port 8765 is used by another program. Close that program or check the existing Agent process before retrying."
  }

  $node = Get-Command node -ErrorAction Stop
  $nodeVersion = (& $node.Source --version).Trim()
  $major = [int]($nodeVersion.TrimStart("v").Split(".")[0])
  if ($major -lt 20) { throw "Node.js 20 or newer is required. Current version: $nodeVersion" }

  $excelJsPackage = Join-Path $agentRoot "node_modules\exceljs\package.json"
  if (-not (Test-Path -LiteralPath $excelJsPackage)) {
    Write-Host "Installing local dependencies for the first run..." -ForegroundColor Cyan
    & npm.cmd ci
    if ($LASTEXITCODE -ne 0) { throw "Dependency installation failed with exit code $LASTEXITCODE." }
  }

  Write-Host "Starting Judicial Auction Agent. Keep this window open." -ForegroundColor Green
  Write-Host "The local page will open at $agentUrl" -ForegroundColor Green
  & $node.Source "bin\agent-cli.mjs" serve
  if ($LASTEXITCODE -ne 0) { throw "Agent server exited with code $LASTEXITCODE." }
  exit 0
} catch {
  $message = "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] $($_.Exception.Message)`r`n$($_.ScriptStackTrace)"
  $message | Out-File -LiteralPath $errorLog -Encoding utf8 -Append
  Write-Host "`nAgent startup failed: $($_.Exception.Message)" -ForegroundColor Red
  Write-Host "Error log: $errorLog" -ForegroundColor Yellow
  exit 1
}
