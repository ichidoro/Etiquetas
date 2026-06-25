Add-Type -AssemblyName System.Drawing
$logoPath = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\src\public\tracelabel-logo.png"))
$icon192Path = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\src\public\icon-192.png"))
$icon512Path = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\src\public\icon-512.png"))

Write-Host "Logo path: $logoPath"
Write-Host "Icon 192 path: $icon192Path"
Write-Host "Icon 512 path: $icon512Path"

$img = [System.Drawing.Image]::FromFile($logoPath)

# 192x192
$bmp192 = New-Object System.Drawing.Bitmap(192, 192)
$g192 = [System.Drawing.Graphics]::FromImage($bmp192)
$g192.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g192.DrawImage($img, 0, 0, 192, 192)
$bmp192.Save($icon192Path, [System.Drawing.Imaging.ImageFormat]::Png)
$g192.Dispose()
$bmp192.Dispose()

# 512x512
$bmp512 = New-Object System.Drawing.Bitmap(512, 512)
$g512 = [System.Drawing.Graphics]::FromImage($bmp512)
$g512.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g512.DrawImage($img, 0, 0, 512, 512)
$bmp512.Save($icon512Path, [System.Drawing.Imaging.ImageFormat]::Png)
$g512.Dispose()
$bmp512.Dispose()

$img.Dispose()
Write-Host "Icons generated successfully!"
