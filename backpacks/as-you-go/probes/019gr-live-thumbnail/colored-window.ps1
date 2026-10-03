param(
  [Parameter(Mandatory = $true)][string]$MarkerPath,
  [Parameter(Mandatory = $true)][string]$ControlPath,
  [string]$Color = '#D92D2D',
  [int]$X = 100,
  [int]$Y = 100
)

# One exact, disposable native surface for the 019GR integration proof. The
# harness changes only ControlPath; the fixture's own UI thread applies the
# requested color. No cursor, keyboard, foreground, or foreign HWND is used.
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$form = New-Object System.Windows.Forms.Form
$form.Text = "AYG-019GR-$PID-" + ([Guid]::NewGuid().ToString('N').Substring(0, 8))
$form.StartPosition = [System.Windows.Forms.FormStartPosition]::Manual
$form.Location = New-Object System.Drawing.Point($X, $Y)
$form.Size = New-Object System.Drawing.Size(400, 300)
$form.ShowInTaskbar = $true
$form.MinimizeBox = $true
$form.MaximizeBox = $false
$form.BackColor = [System.Drawing.ColorTranslator]::FromHtml($Color)

$script:lastControl = ''
$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 60
$timer.add_Tick({
  try {
    if (-not (Test-Path -LiteralPath $ControlPath)) { return }
    $raw = [IO.File]::ReadAllText($ControlPath)
    if ([string]::IsNullOrWhiteSpace($raw) -or $raw -eq $script:lastControl) { return }
    $next = $raw | ConvertFrom-Json
    if ($next.color -is [string]) {
      $form.BackColor = [System.Drawing.ColorTranslator]::FromHtml([string]$next.color)
      $form.Invalidate()
      $form.Update()
      $script:lastControl = $raw
    }
  } catch { }
})
$timer.Start()

@{ pid = $PID; title = $form.Text; x = $X; y = $Y; color = $Color }
  | ConvertTo-Json -Compress
  | Set-Content -LiteralPath $MarkerPath -Encoding UTF8

[System.Windows.Forms.Application]::Run($form)
$timer.Dispose()
