param([string]$OutputDirectory=(Join-Path $env:TEMP 'papers-native-split-next'))
$ErrorActionPreference='Stop'
$repo=Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$native=Join-Path $repo 'resources\native'
$output=[IO.Path]::GetFullPath($OutputDirectory)
New-Item -ItemType Directory -Path $output -Force | Out-Null
$csc=Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
$sources=@('chrome-window-session.cs','pane-group.cs','pane-layout.cs','pane-presentation.cs','pane-coordinator.cs','pane-mount.cs','pane-region-contract.cs','pane-host-region.cs') | ForEach-Object {Join-Path $native $_}
& $csc /nologo /target:winexe "/out:$output\native-split-next.exe" /r:System.Windows.Forms.dll /r:System.Drawing.dll /r:System.Web.Extensions.dll $sources (Join-Path $PSScriptRoot 'Program.cs') (Join-Path $PSScriptRoot 'SplitHarness.cs')
if($LASTEXITCODE -ne 0){throw 'Harness compilation failed.'}
& $csc /nologo /target:library "/out:$output\pane-next.dll" /r:System.Windows.Forms.dll /r:System.Drawing.dll /r:System.Web.Extensions.dll $sources
if($LASTEXITCODE -ne 0){throw 'Verification library compilation failed.'}
Write-Output "Built NEXT experiment: $output\native-split-next.exe"
