param(
    [Parameter(Mandatory = $true)][string]$PapersExe,
    [string]$Launcher = '',
    [Parameter(Mandatory = $true)][string]$HelperDirectory
)
$ErrorActionPreference = 'Stop'
$papersPath = (Resolve-Path -LiteralPath $PapersExe).Path
if ($Launcher) { $Launcher = (Resolve-Path -LiteralPath $Launcher).Path }
$helperRoot = [IO.Path]::GetFullPath($HelperDirectory)
New-Item -ItemType Directory -Path $helperRoot -Force | Out-Null
$binary = Join-Path $helperRoot 'PapersLauncherHotkey.exe'
$log = Join-Path $helperRoot 'launcher-hotkey.log'
$source = Join-Path $PSScriptRoot '../../resources/native/bring-front-hotkey.cs'
& "$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\csc.exe" /nologo /target:winexe "/out:$binary" ([IO.Path]::GetFullPath($source))
if ($LASTEXITCODE -ne 0) { throw 'Could not build the Papers launcher hotkey.' }
# A separate resident process keeps Alt+A alive after Papers exits.
$arguments = '"' + $papersPath + '" "' + $Launcher + '" "' + $log + '"'
$shell = New-Object -ComObject WScript.Shell
$startup = [Environment]::GetFolderPath('Startup')
$shortcut = $shell.CreateShortcut((Join-Path $startup 'Papers Launcher Hotkey.lnk'))
$shortcut.TargetPath = $binary
$shortcut.Arguments = $arguments
$shortcut.WorkingDirectory = $helperRoot
$shortcut.WindowStyle = 7
$shortcut.Description = 'Alt+A opens Papers or brings its existing window forward.'
$shortcut.Save()
$helper = Start-Process -FilePath $binary -ArgumentList $arguments -WindowStyle Hidden -PassThru
if ($helper.WaitForExit(1000)) {
    throw "Papers launcher hotkey exited with code $($helper.ExitCode). Inspect $log."
}
Write-Output "Alt+A launcher installed and running (PID $($helper.Id))."
