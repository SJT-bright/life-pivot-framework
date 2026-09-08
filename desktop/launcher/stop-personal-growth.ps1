[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)

function Resolve-FullPath([string]$Path) {
  return [System.IO.Path]::GetFullPath($Path).TrimEnd("\")
}

$manifestPath = Join-Path $PSScriptRoot "launch-manifest.json"
$manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
$projectRoot = Resolve-FullPath (Join-Path $PSScriptRoot "..\..")
$controlOverride = [Environment]::GetEnvironmentVariable([string]$manifest.controlRootEnvironmentVariable)
$controlRoot = if ($controlOverride) {
  if (-not [System.IO.Path]::IsPathRooted($controlOverride)) { throw "The control root must be an absolute path." }
  Resolve-FullPath $controlOverride
} else {
  if (-not $env:LOCALAPPDATA -or -not [System.IO.Path]::IsPathRooted($env:LOCALAPPDATA)) {
    throw "The Windows LocalAppData directory could not be resolved."
  }
  Resolve-FullPath (Join-Path $env:LOCALAPPDATA "LifePivot")
}
$runtimeRoot = Join-Path $controlRoot ([string]$manifest.runtimeDirectoryName)
$pidFile = Join-Path $runtimeRoot "server.json"

if (-not (Test-Path -LiteralPath $pidFile -PathType Leaf)) {
  Write-Host "$($manifest.appName) is not running through the desktop launcher."
  exit 0
}

$pidRecord = Get-Content -LiteralPath $pidFile -Raw -Encoding UTF8 | ConvertFrom-Json
$processId = [int]$pidRecord.pid
$processRecord = Get-Process -Id $processId -ErrorAction SilentlyContinue

if (-not $processRecord) {
  Remove-Item -LiteralPath $pidFile -Force
  Write-Host "Removed a stale launcher record."
  exit 0
}

$actualNode = if ($processRecord.Path) { Resolve-FullPath ([string]$processRecord.Path) } else { "" }
$storedNode = Resolve-FullPath ([string]$pidRecord.nodePath)
$storedRoot = Resolve-FullPath ([string]$pidRecord.projectRoot)
$storedStart = [long]$pidRecord.processStartTicks
$actualStart = [long]$processRecord.StartTime.Ticks
$owned = $actualNode -ieq $storedNode -and
  $storedRoot -ieq $projectRoot -and
  [int]$pidRecord.port -eq [int]$manifest.port -and
  $storedStart -eq $actualStart

if (-not $owned) {
  Remove-Item -LiteralPath $pidFile -Force
  throw "The recorded PID belongs to another program. It was not stopped; only the stale launcher record was removed."
}

try {
  $processRecord.Refresh()
  if (-not $processRecord.HasExited -and [long]$processRecord.StartTime.Ticks -eq $storedStart) {
    $processRecord.Kill()
    [void]$processRecord.WaitForExit(8000)
  }
} catch {
  if (-not $processRecord.HasExited) { throw }
}

Remove-Item -LiteralPath $pidFile -Force
Write-Host "$($manifest.appName) stopped. The database and backups were preserved." -ForegroundColor Green
