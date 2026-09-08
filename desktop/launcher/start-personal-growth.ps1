[CmdletBinding()]
param(
  [switch]$ValidateOnly,
  [switch]$ForceRebuild,
  [switch]$NoBrowser,
  [ValidateRange(5, 180)]
  [int]$StartupTimeoutSeconds = 60
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)

function Resolve-FullPath([string]$Path) {
  return [System.IO.Path]::GetFullPath($Path).TrimEnd("\")
}

function Get-Manifest {
  $manifestPath = Join-Path $PSScriptRoot "launch-manifest.json"
  if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
    throw "Desktop launcher manifest is missing: $manifestPath"
  }

  $value = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
  if ($value.host -ne "127.0.0.1" -or [int]$value.port -lt 1024 -or [int]$value.port -gt 65535) {
    throw "The desktop launcher host or port is invalid."
  }
  return $value
}

function Get-ProjectRoot {
  return (Resolve-FullPath (Join-Path $PSScriptRoot "..\.."))
}

function Get-NodeExecutable {
  $command = Get-Command node.exe -ErrorAction SilentlyContinue
  if (-not $command) {
    throw "Node.js was not found. The source launcher requires Node.js 24 or newer."
  }

  $majorText = & $command.Source -p "process.versions.node.split('.')[0]"
  if ($LASTEXITCODE -ne 0 -or [int]$majorText -lt 24) {
    throw "Node.js 24 or newer is required."
  }
  return (Resolve-FullPath $command.Source)
}

function Get-DataRoot([object]$Manifest) {
  $overrideName = [string]$Manifest.dataRootEnvironmentVariable
  $override = [Environment]::GetEnvironmentVariable($overrideName)
  if ($override) {
    if (-not [System.IO.Path]::IsPathRooted($override)) {
      throw "$overrideName must be an absolute path."
    }
    return (Resolve-FullPath $override)
  }

  if (-not $env:LOCALAPPDATA -or -not [System.IO.Path]::IsPathRooted($env:LOCALAPPDATA)) {
    throw "The Windows LocalAppData directory could not be resolved."
  }
  return (Resolve-FullPath (Join-Path $env:LOCALAPPDATA "LifePivot"))
}

function Get-ControlRoot([object]$Manifest) {
  $overrideName = [string]$Manifest.controlRootEnvironmentVariable
  $override = [Environment]::GetEnvironmentVariable($overrideName)
  if ($override) {
    if (-not [System.IO.Path]::IsPathRooted($override)) {
      throw "$overrideName must be an absolute path."
    }
    return (Resolve-FullPath $override)
  }
  if (-not $env:LOCALAPPDATA -or -not [System.IO.Path]::IsPathRooted($env:LOCALAPPDATA)) {
    throw "The Windows LocalAppData directory could not be resolved."
  }
  return (Resolve-FullPath (Join-Path $env:LOCALAPPDATA "LifePivot"))
}

function Stop-OwnedProcessObject([System.Diagnostics.Process]$Process, [long]$ExpectedStartTicks) {
  try {
    $Process.Refresh()
    if (-not $Process.HasExited -and [long]$Process.StartTime.Ticks -eq $ExpectedStartTicks) {
      $Process.Kill()
      [void]$Process.WaitForExit(8000)
    }
  } catch {
    # Never fall back to killing a bare PID that Windows may have reused.
  }
}

function Test-BuildRequired([string]$ProjectRoot, [switch]$Force) {
  if ($Force) {
    return $true
  }

  $buildId = Join-Path $ProjectRoot ".next\BUILD_ID"
  if (-not (Test-Path -LiteralPath $buildId -PathType Leaf)) {
    return $true
  }

  $buildTime = (Get-Item -LiteralPath $buildId).LastWriteTimeUtc
  $roots = @(
    (Join-Path $ProjectRoot "src"),
    (Join-Path $ProjectRoot "drizzle"),
    (Join-Path $ProjectRoot "public")
  )
  $topLevel = @(
    (Join-Path $ProjectRoot "package.json"),
    (Join-Path $ProjectRoot "package-lock.json"),
    (Join-Path $ProjectRoot "pnpm-lock.yaml"),
    (Join-Path $ProjectRoot "pnpm-workspace.yaml"),
    (Join-Path $ProjectRoot "next.config.ts"),
    (Join-Path $ProjectRoot "tsconfig.json")
  )

  foreach ($file in $topLevel) {
    if ((Test-Path -LiteralPath $file -PathType Leaf) -and
        (Get-Item -LiteralPath $file).LastWriteTimeUtc -gt $buildTime) {
      return $true
    }
  }
  foreach ($root in $roots) {
    if (-not (Test-Path -LiteralPath $root -PathType Container)) {
      continue
    }
    if (Get-ChildItem -LiteralPath $root -Recurse -File | Where-Object LastWriteTimeUtc -gt $buildTime | Select-Object -First 1) {
      return $true
    }
  }
  return $false
}

function Test-AppHealth([string]$Url) {
  try {
    $response = Invoke-RestMethod -Uri $Url -Method Get -TimeoutSec 3
    return $response.checks.database.status -eq "ok" -and
      $response.checks.schema.status -eq "ok" -and
      $response.checks.dataRoot.status -eq "ok"
  } catch {
    return $false
  }
}

function Get-ProcessRecord([int]$ProcessId) {
  return Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
}

function Test-OwnedProcess(
  [object]$ProcessRecord,
  [object]$PidRecord,
  [string]$NodeExecutable,
  [string]$ProjectRoot,
  [int]$Port
) {
  if (-not $ProcessRecord -or -not $PidRecord) {
    return $false
  }

  $storedNode = Resolve-FullPath ([string]$PidRecord.nodePath)
  $storedRoot = Resolve-FullPath ([string]$PidRecord.projectRoot)
  $actualNode = if ($ProcessRecord.Path) { Resolve-FullPath ([string]$ProcessRecord.Path) } else { "" }
  $storedStart = [long]$PidRecord.processStartTicks
  $actualStart = [long]$ProcessRecord.StartTime.Ticks

  return $storedNode -ieq $NodeExecutable -and
    $actualNode -ieq $NodeExecutable -and
    $storedRoot -ieq $ProjectRoot -and
    [int]$PidRecord.port -eq $Port -and
    $storedStart -eq $actualStart
}

$manifest = Get-Manifest
$projectRoot = Get-ProjectRoot
$nodeExecutable = Get-NodeExecutable
$nextCli = Resolve-FullPath (Join-Path $projectRoot "node_modules\next\dist\bin\next")
$packageFile = Join-Path $projectRoot "package.json"
$dataRoot = Get-DataRoot $manifest
$controlRoot = Get-ControlRoot $manifest
$runtimeRoot = Join-Path $controlRoot ([string]$manifest.runtimeDirectoryName)
$logRoot = Join-Path $runtimeRoot "logs"
$pidFile = Join-Path $runtimeRoot "server.json"
$stdoutLog = Join-Path $logRoot "server.log"
$stderrLog = Join-Path $logRoot "server-error.log"
$hostName = [string]$manifest.host
$port = [int]$manifest.port
$baseUrl = "http://${hostName}:$port"
$healthUrl = "$baseUrl$($manifest.healthPath)"

if (-not (Test-Path -LiteralPath $packageFile -PathType Leaf)) {
  throw "Project package.json was not found: $packageFile"
}
if (-not (Test-Path -LiteralPath $nextCli -PathType Leaf)) {
  throw "Next.js is missing. Install the project dependencies first."
}

if ($ValidateOnly) {
  Write-Output "VALIDATION_OK $baseUrl"
  Write-Output "PROJECT_ROOT $projectRoot"
  Write-Output "DATA_ROOT $dataRoot"
  Write-Output "CONTROL_ROOT $controlRoot"
  exit 0
}

New-Item -ItemType Directory -Path $logRoot -Force | Out-Null

if (Test-Path -LiteralPath $pidFile -PathType Leaf) {
  try {
    $pidRecord = Get-Content -LiteralPath $pidFile -Raw -Encoding UTF8 | ConvertFrom-Json
    $processRecord = Get-ProcessRecord ([int]$pidRecord.pid)
    if (Test-OwnedProcess $processRecord $pidRecord $nodeExecutable $projectRoot $port) {
      $ownedListener = Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue |
        Where-Object OwningProcess -eq ([int]$pidRecord.pid) |
        Select-Object -First 1
      if (-not $ownedListener) {
        throw "The app process exists but does not own its configured port. Run the stop launcher first."
      }
      if (Test-AppHealth $healthUrl) {
        Write-Host "$($manifest.appName) is already running: $baseUrl" -ForegroundColor Green
        if (-not $NoBrowser) { Start-Process $baseUrl }
        exit 0
      }
      throw "The app process exists but is unhealthy. Run the stop launcher first."
    }
  } catch {
    if ($_.Exception.Message -like "The app process exists*") {
      throw
    }
  }
  Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
}

$listener = Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue | Select-Object -First 1
if ($listener) {
  throw "Port $port is owned by process $($listener.OwningProcess). The launcher will not stop another application."
}

if (Test-BuildRequired $projectRoot -Force:$ForceRebuild) {
  $npm = Get-Command npm.cmd -ErrorAction SilentlyContinue
  if (-not $npm) {
    throw "A rebuild is required, but npm.cmd was not found."
  }
  Write-Host "Building the current production version. The first launch may take a few minutes..." -ForegroundColor Cyan
  Push-Location $projectRoot
  try {
    & $npm.Source run build
    if ($LASTEXITCODE -ne 0) {
      throw "The production build failed. Review the output above."
    }
  } finally {
    Pop-Location
  }
}

$quotedNextCli = '"' + $nextCli + '"'
$server = Start-Process -FilePath $nodeExecutable `
  -ArgumentList @($quotedNextCli, "start", "--hostname", $hostName, "--port", $port.ToString()) `
  -WorkingDirectory $projectRoot `
  -WindowStyle Hidden `
  -RedirectStandardOutput $stdoutLog `
  -RedirectStandardError $stderrLog `
  -PassThru

$processStartTicks = [long]$server.StartTime.Ticks
$temporaryPidFile = "$pidFile.$PID.tmp"
try {
  @{
    pid = $server.Id
    nodePath = $nodeExecutable
    projectRoot = $projectRoot
    dataRoot = $dataRoot
    port = $port
    startedAt = ([DateTime]::UtcNow.ToString("o"))
    processStartTicks = $processStartTicks
  } | ConvertTo-Json | Set-Content -LiteralPath $temporaryPidFile -Encoding UTF8
  Move-Item -LiteralPath $temporaryPidFile -Destination $pidFile -Force
} catch {
  Stop-OwnedProcessObject $server $processStartTicks
  Remove-Item -LiteralPath $temporaryPidFile -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
  throw
}

$deadline = [DateTime]::UtcNow.AddSeconds($StartupTimeoutSeconds)
while ([DateTime]::UtcNow -lt $deadline) {
  if ($server.HasExited) {
    Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
    throw "The local server exited early. Error log: $stderrLog"
  }
  if (Test-AppHealth $healthUrl) {
    Write-Host "$($manifest.appName) started: $baseUrl" -ForegroundColor Green
    Write-Host "Data root: $dataRoot"
    if (-not $NoBrowser) { Start-Process $baseUrl }
    exit 0
  }
  Start-Sleep -Milliseconds 500
}

Stop-OwnedProcessObject $server $processStartTicks
Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
throw "Timed out waiting for the local server. Error log: $stderrLog"
