param(
  [Parameter(Mandatory = $true)][string]$MarkerPath,
  [int]$X = 300,
  [int]$Y = 200
)

# 029 P3 gate: ONE disposable, uniquely titled WinForms window painted with a
# distinctive TWO-COLOUR pattern (solid blue background + a red diagonal band).
# This makes the captured frame provably non-uniform: a real capture shows both
# blue and red pixels; a blank/uniform result does not. Writes { pid, title }
# to the marker and runs the message loop until closed (WM_CLOSE exits).
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$form = New-Object System.Windows.Forms.Form
$form.Text = "AYG-029PAT-$PID-" + ([System.Guid]::NewGuid().ToString('N').Substring(0, 8))
$form.StartPosition = [System.Windows.Forms.FormStartPosition]::Manual
$form.Location = New-Object System.Drawing.Point($X, $Y)
$form.Size = New-Object System.Drawing.Size(520, 360)
$form.MinimizeBox = $true
$form.MaximizeBox = $true
$form.ShowInTaskbar = $true

$form.add_Paint({ param($sender, $e)
  $g = $e.Graphics
  $g.Clear([System.Drawing.Color]::DodgerBlue)
  $band = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::Crimson)
  $points = @(
    (New-Object System.Drawing.Point(0, 80)),
    (New-Object System.Drawing.Point(120, 0)),
    (New-Object System.Drawing.Point(200, 0)),
    (New-Object System.Drawing.Point(80, 80))
  )
  $g.FillPolygon($band, $points)
  $band.Dispose()
})

@{ pid = $PID; title = $form.Text; x = $X; y = $Y }
  | ConvertTo-Json -Compress
  | Set-Content -LiteralPath $MarkerPath -Encoding UTF8

[System.Windows.Forms.Application]::Run($form)
