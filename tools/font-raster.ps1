# Rasterises ASCII 32..126 of a TTF into a high-resolution coverage grid for tools/make-font.mjs.
# Writes <out>.bin (8-bit coverage, COLS x ROWS cells of CELL px, row-major) and <out>.json (per-glyph advance and
# ink box in cell pixels). Uses GDI+ (System.Drawing), which Windows PowerShell has built in.
#   powershell -File tools/font-raster.ps1 <font.ttf> <out-prefix>
param([string]$FontPath, [string]$Out, [int]$Cell = 256, [float]$Em = 150)
Add-Type -AssemblyName System.Drawing
$pfc = New-Object System.Drawing.Text.PrivateFontCollection
$pfc.AddFontFile((Resolve-Path $FontPath).Path)
$family = $pfc.Families[0]
$font = New-Object System.Drawing.Font($family, $Em, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)
$cols = 16; $rows = 6
$bmp = New-Object System.Drawing.Bitmap(($cols * $Cell), ($rows * $Cell), [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.Clear([System.Drawing.Color]::Black)
$g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$fmt = [System.Drawing.StringFormat]::GenericTypographic
$fmt.FormatFlags = $fmt.FormatFlags -bor [System.Drawing.StringFormatFlags]::MeasureTrailingSpaces
$ascent = $family.GetCellAscent([System.Drawing.FontStyle]::Regular) * $Em / $family.GetEmHeight([System.Drawing.FontStyle]::Regular)
$base = $Cell * 0.72   # baseline, from the top of the cell
$meta = @()
for ($c = 32; $c -le 126; $c++) {
  $i = $c - 32; $cx = ($i % $cols) * $Cell; $cy = [math]::Floor($i / $cols) * $Cell
  $s = [string][char]$c
  $size = $g.MeasureString($s, $font, 10000, $fmt)
  $x0 = $Cell * 0.5 - $size.Width * 0.5
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $path.AddString($s, $family, [int][System.Drawing.FontStyle]::Regular, $Em, (New-Object System.Drawing.PointF(($cx + $x0), ($cy + $base - $ascent))), $fmt)
  $g.FillPath([System.Drawing.Brushes]::White, $path)
  $meta += [pscustomobject]@{ c = $c; adv = [math]::Round($size.Width, 2); x0 = [math]::Round($x0, 2) }
}
$g.Dispose()
$rect = New-Object System.Drawing.Rectangle(0, 0, $bmp.Width, $bmp.Height)
$data = $bmp.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::ReadOnly, $bmp.PixelFormat)
$bytes = New-Object byte[] ($data.Stride * $bmp.Height)
[System.Runtime.InteropServices.Marshal]::Copy($data.Scan0, $bytes, 0, $bytes.Length)
$bmp.UnlockBits($data)
$gray = New-Object byte[] ($bmp.Width * $bmp.Height)
for ($p = 0; $p -lt $gray.Length; $p++) { $gray[$p] = $bytes[$p * 4 + 1] }
[System.IO.File]::WriteAllBytes("$Out.bin", $gray)
@{ cell = $Cell; em = $Em; cols = $cols; rows = $rows; baseline = $base; glyphs = $meta } | ConvertTo-Json -Depth 4 | Set-Content -Encoding utf8 "$Out.json"
