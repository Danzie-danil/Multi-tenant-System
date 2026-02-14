$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$outDir = Join-Path $root 'icons'
# Ensure output directory exists (it should, since source is there)
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

$src = Join-Path $root 'bms-logo.jpeg'
if (-not (Test-Path -LiteralPath $src)) { throw ('Source icon not found: ' + $src) }

$img = [System.Drawing.Image]::FromFile($src)

# Renamed to standard verb to avoid warning
function Optimize-TransparentMargins([System.Drawing.Image]$image, [int]$alphaThreshold = 10) {
  $bmp = New-Object System.Drawing.Bitmap $image
  $w = $bmp.Width; $h = $bmp.Height
  $top = 0; $left = 0; $right = $w - 1; $bottom = $h - 1

  # Find top
  $found = $false
  for ($y = 0; $y -lt $h -and -not $found; $y++) {
    for ($x = 0; $x -lt $w; $x++) {
      if ($bmp.GetPixel($x, $y).A -gt $alphaThreshold) { $top = $y; $found = $true; break }
    }
  }
  # Find bottom
  $found = $false
  for ($y = $h - 1; $y -ge 0 -and -not $found; $y--) {
    for ($x = 0; $x -lt $w; $x++) {
      if ($bmp.GetPixel($x, $y).A -gt $alphaThreshold) { $bottom = $y; $found = $true; break }
    }
  }
  # Find left
  $found = $false
  for ($x = 0; $x -lt $w -and -not $found; $x++) {
    for ($y = $top; $y -le $bottom; $y++) {
      if ($bmp.GetPixel($x, $y).A -gt $alphaThreshold) { $left = $x; $found = $true; break }
    }
  }
  # Find right
  $found = $false
  for ($x = $w - 1; $x -ge 0 -and -not $found; $x--) {
    for ($y = $top; $y -le $bottom; $y++) {
      if ($bmp.GetPixel($x, $y).A -gt $alphaThreshold) { $right = $x; $found = $true; break }
    }
  }

  $cropW = [Math]::Max(1, $right - $left + 1)
  $cropH = [Math]::Max(1, $bottom - $top + 1)

  if ($cropW -ge $w -and $cropH -ge $h) {
    return $image
  }

  $rect = New-Object System.Drawing.Rectangle $left, $top, $cropW, $cropH
  $cropped = $bmp.Clone($rect, $bmp.PixelFormat)
  $bmp.Dispose()
  return $cropped
}

# Auto-crop transparent margins to maximize the drawn area while keeping transparency
try { $img = Optimize-TransparentMargins $img 5 } catch { }

function New-Color([string]$hex) {
  if ([string]::IsNullOrWhiteSpace($hex)) { return $null }
  $h = $hex.Trim().TrimStart('#')
  if ($h.Length -eq 6) {
    $r = [Convert]::ToInt32($h.Substring(0, 2), 16)
    $g = [Convert]::ToInt32($h.Substring(2, 2), 16)
    $b = [Convert]::ToInt32($h.Substring(4, 2), 16)
    return [System.Drawing.Color]::FromArgb(255, $r, $g, $b)
  }
  if ($h.Length -eq 8) {
    $a = [Convert]::ToInt32($h.Substring(0, 2), 16)
    $r = [Convert]::ToInt32($h.Substring(2, 2), 16)
    $g = [Convert]::ToInt32($h.Substring(4, 2), 16)
    $b = [Convert]::ToInt32($h.Substring(6, 2), 16)
    return [System.Drawing.Color]::FromArgb($a, $r, $g, $b)
  }
  throw ('Invalid color hex: ' + $hex)
}

function Save-SquareIcon([int]$size, [string]$outName, [string]$bgHex, [double]$contentScale) {
  $outPath = Join-Path $outDir $outName

  $bmp = New-Object System.Drawing.Bitmap $size, $size, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality

  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  # Use full canvas for clip to ensure it's a circle
  $path.AddEllipse(0, 0, $size, $size)
  $g.SetClip($path)

  $g.Clear([System.Drawing.Color]::Transparent)
  $bg = New-Color $bgHex
  if ($null -ne $bg) {
    $brush = New-Object System.Drawing.SolidBrush $bg
    # Fill the entire clipped area (which is the circle)
    $g.FillRectangle($brush, 0, 0, $size, $size)
    $brush.Dispose()
  }

  $target = [Math]::Max(1, [int][Math]::Round($size * $contentScale))
  # Maintain aspect ratio
  $ratio = [Math]::Min($target / $img.Width, $target / $img.Height)
  $dw = [Math]::Max(1, [int][Math]::Round($img.Width * $ratio))
  $dh = [Math]::Max(1, [int][Math]::Round($img.Height * $ratio))
  $dx = [int][Math]::Round(($size - $dw) / 2.0)
  $dy = [int][Math]::Round(($size - $dh) / 2.0)

  $rect = New-Object System.Drawing.Rectangle $dx, $dy, $dw, $dh
  $g.DrawImage($img, $rect)

  $g.Dispose()
  $bmp.Save($outPath, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
}

# Configured for BMS Manifest Requirements
# Default background is transparent, or change $null to '#ffffff' if desired
$jobs = @(
  @{ size = 72; name = 'bms-logo-72.png'; bg = '#ffffff'; scale = 0.85 }
  @{ size = 96; name = 'bms-logo-96.png'; bg = '#ffffff'; scale = 0.85 }
  @{ size = 128; name = 'bms-logo-128.png'; bg = '#ffffff'; scale = 0.85 }
  @{ size = 144; name = 'bms-logo-144.png'; bg = '#ffffff'; scale = 0.85 }
  @{ size = 152; name = 'bms-logo-152.png'; bg = '#ffffff'; scale = 0.85 }
  @{ size = 192; name = 'bms-logo-192.png'; bg = '#ffffff'; scale = 0.85 }
  @{ size = 384; name = 'bms-logo-384.png'; bg = '#ffffff'; scale = 0.85 }
  @{ size = 512; name = 'bms-logo-512.png'; bg = '#ffffff'; scale = 0.85 }
)

Write-Host "Generating icons from $src..."

foreach ($j in $jobs) {
  Save-SquareIcon -size $j.size -outName $j.name -bgHex $j.bg -contentScale $j.scale
  Write-Host "  -> Generated $($j.name)"
}

$img.Dispose()
Write-Host "Done!"

