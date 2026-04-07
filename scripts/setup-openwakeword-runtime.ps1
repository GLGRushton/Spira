param(
  [string]$Python = "python",
  [string]$RuntimeDir = "assets\wake-word\openwakeword-runtime"
)

$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$runtimePath = Join-Path $repoRoot $RuntimeDir
$workerDir = Join-Path $repoRoot "assets\wake-word\openwakeword"
$requirementsPath = Join-Path $workerDir "requirements.txt"
$venvPath = Join-Path $runtimePath "venv"
$pythonExe = Join-Path $venvPath "Scripts\python.exe"

New-Item -ItemType Directory -Force -Path $runtimePath | Out-Null

& $Python -m venv $venvPath
& $pythonExe -m pip install --upgrade pip
& $pythonExe -m pip install -r $requirementsPath

Write-Host "openWakeWord runtime provisioned at $venvPath"
