# Draws public/og-card.png, the 1200x630 image link previews use.
#
# It is generated rather than hand-made for the same reason the game's art is:
# the palette lives in one place and a change to the title does not mean opening
# an image editor. Re-run after any rename.
#
#   powershell -ExecutionPolicy Bypass -File scripts/make-og-card.ps1

Add-Type -AssemblyName System.Drawing

$ErrorActionPreference = 'Stop'

$repo = Split-Path -Parent $PSScriptRoot
$out  = Join-Path $repo 'public\og-card.png'

$W = 1200; $H = 630

# Same values as COLORS/menu.js — keep these in step with the in-game title screen.
$bg        = [System.Drawing.Color]::FromArgb(10, 14, 8)
$gold      = [System.Drawing.Color]::FromArgb(204, 170, 68)
$goldDim   = [System.Drawing.Color]::FromArgb(138, 116, 51)
$phosphor  = [System.Drawing.Color]::FromArgb(77, 255, 136)
$sand      = [System.Drawing.Color]::FromArgb(64, 48, 22)
$sandLight = [System.Drawing.Color]::FromArgb(96, 72, 32)
$sandTop   = [System.Drawing.Color]::FromArgb(134, 102, 44)

$bmp = New-Object System.Drawing.Bitmap($W, $H)
$g   = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode     = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit

$g.Clear($bg)

# --- dune bands across the lower half, back to front, each a little lighter ---
$dunes = @(
  @{ y = 408; amp = 30; phase = 0.0; color = $sand },
  @{ y = 480; amp = 42; phase = 2.1; color = $sandLight },
  @{ y = 560; amp = 26; phase = 4.3; color = $sandTop }
)
foreach ($d in $dunes) {
  $pts = New-Object System.Collections.Generic.List[System.Drawing.PointF]
  for ($x = -20; $x -le $W + 20; $x += 20) {
    $t = $x / 260.0 + $d.phase
    $y = $d.y + [Math]::Sin($t) * $d.amp + [Math]::Sin($t * 2.3) * ($d.amp * 0.35)
    $pts.Add((New-Object System.Drawing.PointF($x, [float]$y)))
  }
  $pts.Add((New-Object System.Drawing.PointF(($W + 20), [float]$H)))
  $pts.Add((New-Object System.Drawing.PointF(-20, [float]$H)))
  $brush = New-Object System.Drawing.SolidBrush($d.color)
  $g.FillPolygon($brush, $pts.ToArray())
  $brush.Dispose()
}

# --- title ---
$titleFont = New-Object System.Drawing.Font('Consolas', 92, [System.Drawing.FontStyle]::Bold)
$markFont  = New-Object System.Drawing.Font('Consolas', 21, [System.Drawing.FontStyle]::Bold)
$subFont   = New-Object System.Drawing.Font('Consolas', 20)

$center = New-Object System.Drawing.StringFormat
$center.Alignment = [System.Drawing.StringAlignment]::Center

$goldBrush = New-Object System.Drawing.SolidBrush($gold)
$dimBrush  = New-Object System.Drawing.SolidBrush($goldDim)
$shadow    = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(200, 0, 0, 0))

$g.DrawString('IRON DUNES', $titleFont, $shadow,    ($W / 2 + 4), 152, $center)
$g.DrawString('IRON DUNES', $titleFont, $goldBrush, ($W / 2),     148, $center)
$g.DrawString('R O G U E   B A T T A L I O N S', $markFont, $dimBrush, ($W / 2), 286, $center)

# --- phosphor rule, the HUD's one green note ---
$pen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(150, $phosphor), 2)
$g.DrawLine($pen, ($W / 2 - 170), 336, ($W / 2 + 170), 336)
$pen.Dispose()

$dot = [char]0x00B7
$g.DrawString("DRILL  $dot  HAUL  $dot  OUTLIVE THREE RIVAL CLANS",
  $subFont, (New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(120, 160, 120))),
  ($W / 2), 360, $center)

$bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)

$g.Dispose(); $bmp.Dispose()
Write-Host "Wrote $out ($W x $H)"
