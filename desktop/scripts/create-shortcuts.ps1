$ErrorActionPreference = 'Stop'

$desktopDir = Split-Path -Parent $PSScriptRoot
$releaseDir = Join-Path $desktopDir 'release'
$appName = 'DeepSeek Harness桌面版'
$exe = Join-Path $releaseDir "$appName-win32-x64\$appName.exe"

if (-not (Test-Path $exe)) {
  Write-Error "Packaged exe not found: $exe"
  exit 1
}

$shell = New-Object -ComObject WScript.Shell

$desktopShortcut = Join-Path ([Environment]::GetFolderPath('Desktop')) "$appName.lnk"
$desktopLink = $shell.CreateShortcut($desktopShortcut)
$desktopLink.TargetPath = $exe
$desktopLink.WorkingDirectory = Split-Path -Parent $exe
$desktopLink.IconLocation = "$exe,0"
$desktopLink.Description = $appName
$desktopLink.Save()

$startMenuDir = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'
$startShortcut = Join-Path $startMenuDir "$appName.lnk"
$startLink = $shell.CreateShortcut($startShortcut)
$startLink.TargetPath = $exe
$startLink.WorkingDirectory = Split-Path -Parent $exe
$startLink.IconLocation = "$exe,0"
$startLink.Description = $appName
$startLink.Save()

Write-Host "Desktop shortcut: $desktopShortcut"
Write-Host "Start-menu shortcut: $startShortcut"
Write-Host 'Tip: right-click the desktop shortcut and choose Pin to taskbar.'
