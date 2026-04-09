export interface OcrRectangle {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface OcrWord {
  text: string;
  bounds: OcrRectangle | null;
}

export interface OcrLine {
  text: string;
  bounds: OcrRectangle | null;
  words: OcrWord[];
}

export interface OcrResult {
  text: string;
  lineCount: number;
  wordCount: number;
  lines: OcrLine[];
}

const quotePsString = (value: string): string => value.replaceAll("'", "''");

export const buildWindowsOcrScript = (imagePath: string): string => `
Add-Type -AssemblyName System.Runtime.WindowsRuntime
[void][Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]
[void][Windows.Storage.FileAccessMode, Windows.Storage, ContentType = WindowsRuntime]
[void][Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics.Imaging, ContentType = WindowsRuntime]
[void][Windows.Graphics.Imaging.SoftwareBitmap, Windows.Graphics.Imaging, ContentType = WindowsRuntime]
[void][Windows.Media.Ocr.OcrEngine, Windows.Media.Ocr, ContentType = WindowsRuntime]

function Await([object]$operation, [type]$resultType) {
  $asTaskGeneric = [System.WindowsRuntimeSystemExtensions].GetMethods() |
    Where-Object { $_.Name -eq 'AsTask' -and $_.IsGenericMethod -and $_.GetParameters().Count -eq 1 } |
    Select-Object -First 1
  $asTask = $asTaskGeneric.MakeGenericMethod($resultType)
  $task = $asTask.Invoke($null, @($operation))
  $task.Wait()
  return $task.Result
}

function Convert-SpiraOcrNumber($value) {
  try {
    $number = [double]$value
  } catch {
    return $null
  }

  if ([double]::IsNaN($number) -or [double]::IsInfinity($number)) {
    return $null
  }

  return [Math]::Round($number, 2)
}

function Convert-SpiraOcrRect($rect) {
  if ($null -eq $rect) {
    return $null
  }

  $x = Convert-SpiraOcrNumber $rect.X
  $y = Convert-SpiraOcrNumber $rect.Y
  $width = Convert-SpiraOcrNumber $rect.Width
  $height = Convert-SpiraOcrNumber $rect.Height
  if ($null -eq $x -or $null -eq $y -or $null -eq $width -or $null -eq $height) {
    return $null
  }

  return [PSCustomObject]@{
    x = $x
    y = $y
    width = $width
    height = $height
  }
}

$file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync('${quotePsString(imagePath)}')) ([Windows.Storage.StorageFile])
$stream = Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
$decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
$bitmap = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
$engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()

if ($null -eq $engine) {
  throw "Windows OCR engine is unavailable on this system."
}

$ocr = Await ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
$lines = New-Object System.Collections.Generic.List[object]

foreach ($line in @($ocr.Lines)) {
  $words = New-Object System.Collections.Generic.List[object]
  foreach ($word in @($line.Words)) {
    $words.Add([PSCustomObject]@{
      text = [string]$word.Text
      bounds = Convert-SpiraOcrRect $word.BoundingRect
    }) | Out-Null
  }

  $lineText = [string](($words | ForEach-Object { $_.text } | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }) -join ' ')
  if ([string]::IsNullOrWhiteSpace($lineText)) {
    $lineText = [string]$line.Text
  }

  $lines.Add([PSCustomObject]@{
    text = $lineText.Trim()
    bounds = Convert-SpiraOcrRect $line.BoundingRect
    words = @($words)
  }) | Out-Null
}

$nonEmptyLines = @($lines | Where-Object { -not [string]::IsNullOrWhiteSpace($_.text) })
$text = (($nonEmptyLines | ForEach-Object { $_.text }) -join [Environment]::NewLine).Trim()
$wordCount = @($lines | ForEach-Object { $_.words.Count } | Measure-Object -Sum).Sum

[PSCustomObject]@{
  text = $text
  lineCount = $nonEmptyLines.Count
  wordCount = if ($null -eq $wordCount) { 0 } else { [int]$wordCount }
  lines = @($lines)
} | ConvertTo-Json -Depth 6 -Compress
`;
