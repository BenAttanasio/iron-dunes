# Imports the handful of textures we actually use out of the downloaded texture
# packs in ~/Downloads, downscaling each one on the way in.
#
# Everything imported here is CC0 or CC BY, because everything in public/assets/
# ships in a public repo. Do not add a purchased pack to these manifests - a
# purchase licenses you, not everyone who clones the repo. Paint it instead
# (see genGlass in public/js/textures.js, which replaced exactly such an import).
#
# The packs are 135 MB and 54 MB; we ship well under 2 MB. Re-run this after
# dropping a new pack in Downloads and adding entries to the manifests below.
#
#   powershell -ExecutionPolicy Bypass -File scripts/import-assets.ps1
#
# Sources:
#   Particle Effect Texture Essentials - Reactorcore, CC BY 4.0

Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.IO.Compression.FileSystem

$ErrorActionPreference = 'Stop'

$repo      = Split-Path -Parent $PSScriptRoot
$downloads = Join-Path $env:USERPROFILE 'Downloads'
$particleZip = Join-Path $downloads 'Particle Effect Texture Essentials.zip'

# white_on_transparent: RGB = white, alpha = shape. Tints cleanly in-engine, so one
# sprite serves fire, EMP, dust and smoke depending on the tint we hand it.
$P = 'Particle Effect Texture Essentials/white_on_transparent/'

# source entry -> @(destination file, output size)
$particles = [ordered]@{
  "${P}muzzle_flash_12.png"            = @('muzzle_flash.png',    128)
  "${P}soft_glow_03_hot_core.png"      = @('glow_hot.png',        128)
  "${P}soft_glow_01_soft.png"          = @('glow_soft.png',       128)
  "${P}light_rays_24_6ray.png"         = @('rays_6.png',          256)
  "${P}light_rays_28_32ray.png"        = @('rays_32.png',         256)

  "${P}explosion_04_heavy.png"         = @('explosion_a.png',     256)
  "${P}explosion_05_heavy.png"         = @('explosion_b.png',     256)
  "${P}explosion_06_heavy.png"         = @('explosion_c.png',     256)
  "${P}explosion_01_light.png"         = @('burst_a.png',         128)
  "${P}explosion_02_light.png"         = @('burst_b.png',         128)
  "${P}impact_ring_03.png"             = @('impact_ring.png',     128)

  "${P}debris_chunk_09.png"            = @('debris_a.png',        128)
  "${P}debris_chunk_37.png"            = @('debris_b.png',        128)
  "${P}debris_scatter_19_big.png"      = @('debris_scatter.png',  256)

  "${P}sparks_01.png"                  = @('sparks_a.png',        128)
  "${P}sparks_02_dense.png"            = @('sparks_b.png',        128)
  "${P}star_point_15_5pt.png"          = @('star_5pt.png',        128)

  "${P}smoke_puff_03.png"              = @('smoke_a.png',         128)
  "${P}smoke_puff_08.png"              = @('smoke_b.png',         128)
  "${P}cloud_01_light.png"             = @('cloud.png',           256)
  "${P}fog_01_light.png"               = @('fog.png',             256)
  "${P}dust_motes_20_big.png"          = @('dust_motes.png',      256)

  "${P}fire_tongue_01.png"             = @('fire_tongue.png',     128)
  "${P}fire_wave_18_wisp.png"          = @('fire_wisp.png',       128)
  "${P}fire_wave_21_broad.png"         = @('fire_broad.png',      256)
  "${P}embers_03.png"                  = @('embers.png',          128)
  "${P}embers_17_big.png"              = @('embers_big.png',      256)

  "${P}shockwave_04_bright.png"        = @('shockwave.png',       256)
  "${P}shockwave_ring_01.png"          = @('shockwave_ring.png',  256)
  "${P}shockwave_07_thick_wide.png"    = @('shockwave_wide.png',  256)
  "${P}sunburst_09.png"                = @('sunburst.png',        256)
  "${P}sparkle_burst_25_big.png"       = @('sparkle_burst.png',   256)

  "${P}lightning_plus_through_a.png"   = @('arc.png',             128)
  "${P}energy_tendril_05.png"          = @('tendril.png',         128)

  "${P}cracked_ground_01.png"          = @('cracked_ground.png',  256)
  "${P}impact_fracture_03.png"         = @('impact_fracture.png', 256)
  "${P}splatter_28_big.png"            = @('splatter.png',        256)
  "${P}scratch_marks_10_wide.png"      = @('scratch.png',         128)

  "${P}force_field_06.png"             = @('force_field.png',     256)
  "${P}halo_ring_05.png"               = @('halo_ring.png',       128)
  "${P}sonar_pulse_08.png"             = @('sonar_pulse.png',     256)

  # tiling_* are the only entries built to repeat seamlessly. 512 -> 256 is an
  # exact halving, which preserves the seam; do not resize these to non-powers of 2.
  "${P}tiling_scanlines_10_fine.png"   = @('scanlines.png',       256)
  "${P}tiling_haze_layer_21_light.png" = @('haze.png',            256)
}

# CC0 photographic detail, downloaded on first run and cached. These are NOT the base
# art - they get composited as low-opacity soft-light grain over the painted procedural
# textures, which keeps the reference's hand-painted read while killing the flat look.
# Greyscaled on import so they add tooth without shifting hue.
$cc0 = [ordered]@{
  'sand_grain.png' = @{
    url  = 'https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/sand_01/sand_01_diff_1k.jpg'
    size = 512   # seamless; 1024 -> 512 is an exact halving so the seam survives
    note = 'Poly Haven "Sand 01" by Rob Tuytel (CC0)'
  }
  'rock_grain.png' = @{
    url  = 'https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/rock_face_03/rock_face_03_diff_1k.jpg'
    size = 256
    note = 'Poly Haven "Rock Face 03" (CC0)'
  }
}

# Kenney "Impact Sounds" (CC0, no attribution required). Copied through as-is —
# these are layered *over* the synthesized SFX, not replacing them. The synth
# engine loop follows player speed and stutters on empty fuel, which a sample
# can't do; one-shot impacts are the opposite, and sound far better recorded.
$kenneyUrl = 'https://kenney.nl/media/pages/assets/impact-sounds/87b4ddecda-1677589768/kenney_impact-sounds.zip'
$kenney = [ordered]@{
  'Audio/impactMining_000.ogg'       = 'dig_0.ogg'
  'Audio/impactMining_001.ogg'       = 'dig_1.ogg'
  'Audio/impactMining_002.ogg'       = 'dig_2.ogg'
  'Audio/impactMining_003.ogg'       = 'dig_3.ogg'
  'Audio/impactMetal_heavy_000.ogg'  = 'armour_0.ogg'
  'Audio/impactMetal_heavy_001.ogg'  = 'armour_1.ogg'
  'Audio/impactMetal_heavy_002.ogg'  = 'armour_2.ogg'
  'Audio/impactMetal_light_000.ogg'  = 'ping_0.ogg'
  'Audio/impactMetal_light_001.ogg'  = 'ping_1.ogg'
  'Audio/impactMetal_light_002.ogg'  = 'ping_2.ogg'
  'Audio/impactSoft_heavy_000.ogg'   = 'thud_0.ogg'
  'Audio/impactSoft_heavy_001.ogg'   = 'thud_1.ogg'
  'Audio/impactPlate_heavy_000.ogg'  = 'wreck_0.ogg'
  'Audio/impactPlate_heavy_001.ogg'  = 'wreck_1.ogg'
  'Audio/impactGeneric_light_000.ogg' = 'pickup_0.ogg'
  'Audio/impactGeneric_light_001.ogg' = 'pickup_1.ogg'
}

function Import-Audio {
  param([string]$Url, [System.Collections.Specialized.OrderedDictionary]$Manifest,
        [string]$OutDir, [string]$CacheDir)

  if (-not (Test-Path $OutDir))   { New-Item -ItemType Directory -Path $OutDir   -Force | Out-Null }
  if (-not (Test-Path $CacheDir)) { New-Item -ItemType Directory -Path $CacheDir -Force | Out-Null }
  $cached = Join-Path $CacheDir 'kenney_impact-sounds.zip'
  if (-not (Test-Path $cached)) {
    Write-Host '  downloading Kenney Impact Sounds (CC0)'
    try { Invoke-WebRequest -Uri $Url -OutFile $cached -UseBasicParsing }
    catch { Write-Warning "  download failed: $_ - sampled SFX will be skipped, synth still works."; return }
  }
  $zip = [System.IO.Compression.ZipFile]::OpenRead($cached)
  try {
    foreach ($src in $Manifest.Keys) {
      $entry = $zip.GetEntry($src)
      if (-not $entry) { Write-Warning "  entry not found: $src"; continue }
      $out = Join-Path $OutDir $Manifest[$src]
      [System.IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $out, $true)
    }
    $n = (Get-ChildItem $OutDir -File).Count
    $kb = [math]::Round((Get-ChildItem $OutDir -File | Measure-Object Length -Sum).Sum / 1KB, 1)
    Write-Host ("  {0} clips, {1} KB" -f $n, $kb)
  } finally { $zip.Dispose() }
}

# Shared resize core. $Grey applies a luminance ColorMatrix on the way through.
function Convert-Texture {
  param([System.IO.Stream]$Stream, [string]$OutPath, [int]$Size, [switch]$Grey)

  $img = [System.Drawing.Image]::FromStream($Stream)
  $bmp = New-Object System.Drawing.Bitmap $Size, $Size, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceCopy
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality

  $rect = New-Object System.Drawing.Rectangle 0, 0, $Size, $Size
  if ($Grey) {
    $cm = New-Object System.Drawing.Imaging.ColorMatrix
    foreach ($row in 0..2) {
      $cm.Item($row, 0) = 0.299; $cm.Item($row, 1) = 0.587; $cm.Item($row, 2) = 0.114
    }
    $attr = New-Object System.Drawing.Imaging.ImageAttributes
    $attr.SetColorMatrix($cm)
    $g.DrawImage($img, $rect, 0, 0, $img.Width, $img.Height, [System.Drawing.GraphicsUnit]::Pixel, $attr)
    $attr.Dispose()
  } else {
    $g.DrawImage($img, $rect)
  }
  $g.Dispose()

  $bmp.Save($OutPath, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose(); $img.Dispose()
}

function Import-Cc0 {
  param([System.Collections.Specialized.OrderedDictionary]$Manifest, [string]$OutDir, [string]$CacheDir)

  if (-not (Test-Path $OutDir))   { New-Item -ItemType Directory -Path $OutDir   -Force | Out-Null }
  if (-not (Test-Path $CacheDir)) { New-Item -ItemType Directory -Path $CacheDir -Force | Out-Null }

  foreach ($destName in $Manifest.Keys) {
    $spec = $Manifest[$destName]
    $cached = Join-Path $CacheDir ([System.IO.Path]::GetFileName($spec.url))
    if (-not (Test-Path $cached)) {
      Write-Host "  downloading $($spec.note)"
      try {
        Invoke-WebRequest -Uri $spec.url -OutFile $cached -UseBasicParsing
      } catch {
        Write-Warning "  download failed ($destName): $_ - falling back to pure procedural."
        continue
      }
    }
    $fs = [System.IO.File]::OpenRead($cached)
    try {
      $out = Join-Path $OutDir $destName
      Convert-Texture -Stream $fs -OutPath $out -Size $spec.size -Grey
      $kb = [math]::Round((Get-Item $out).Length / 1KB, 1)
      Write-Host ("  {0,-22} {1}x{1}  {2} KB  grey" -f $destName, $spec.size, $kb)
    } finally { $fs.Dispose() }
  }
}

function Import-Pack {
  param([string]$ZipPath, [System.Collections.Specialized.OrderedDictionary]$Manifest, [string]$OutDir)

  if (-not (Test-Path $ZipPath)) {
    Write-Warning "Missing pack: $ZipPath - skipping. Textures fall back to procedural generators."
    return
  }
  if (-not (Test-Path $OutDir)) { New-Item -ItemType Directory -Path $OutDir -Force | Out-Null }

  $zip = [System.IO.Compression.ZipFile]::OpenRead($ZipPath)
  try {
    foreach ($src in $Manifest.Keys) {
      $destName, $size = $Manifest[$src]
      $entry = $zip.GetEntry($src)
      if (-not $entry) { Write-Warning "  entry not found: $src"; continue }

      # Copy to memory first: Image.FromStream needs a seekable stream.
      $ms = New-Object System.IO.MemoryStream
      $es = $entry.Open()
      $es.CopyTo($ms); $es.Dispose()
      $ms.Position = 0

      $out = Join-Path $OutDir $destName
      Convert-Texture -Stream $ms -OutPath $out -Size $size
      $ms.Dispose()

      $kb = [math]::Round((Get-Item $out).Length / 1KB, 1)
      Write-Host ("  {0,-22} {1}x{1}  {2} KB" -f $destName, $size, $kb)
    }
  } finally { $zip.Dispose() }
}

Write-Host "`nParticle Effect Texture Essentials -> public/assets/fx/"
Import-Pack -ZipPath $particleZip -Manifest $particles -OutDir (Join-Path $repo 'public\assets\fx')

$cache = Join-Path $env:TEMP 'tankwars-cc0-cache'

Write-Host "`nCC0 detail textures -> public/assets/detail/"
Import-Cc0 -Manifest $cc0 -OutDir (Join-Path $repo 'public\assets\detail') -CacheDir $cache

Write-Host "`nKenney Impact Sounds (CC0) -> public/assets/sfx/"
Import-Audio -Url $kenneyUrl -Manifest $kenney -OutDir (Join-Path $repo 'public\assets\sfx') -CacheDir $cache

$total = (Get-ChildItem (Join-Path $repo 'public\assets') -Recurse -File | Measure-Object Length -Sum).Sum
Write-Host ("`nDone. public/assets total: {0} KB" -f [math]::Round($total / 1KB))
