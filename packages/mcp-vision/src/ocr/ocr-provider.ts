import { quotePsString, runPs } from "../util/powershell.js";

export interface OcrResult {
  text: string;
  lineCount: number;
  wordCount: number;
}

export interface IOcrProvider {
  recognize(imagePath: string): Promise<OcrResult>;
}

type RawOcrResult = {
  text: string;
  lineCount: number;
  wordCount: number;
};

const OCR_SCRIPT = (imagePath: string): string => `
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

$file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync('${quotePsString(imagePath)}')) ([Windows.Storage.StorageFile])
$stream = Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
$decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
$bitmap = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
$engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()

if ($null -eq $engine) {
  throw "Windows OCR engine is unavailable on this system."
}

$ocr = Await ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
$lines = @($ocr.Lines | ForEach-Object { $_.Text } | Where-Object { $_ -and $_.Trim().Length -gt 0 })
$text = ($lines -join [Environment]::NewLine).Trim()
$wordCount = if ([string]::IsNullOrWhiteSpace($text)) { 0 } else { ($text -split '\\s+' | Where-Object { $_ }).Count }

[PSCustomObject]@{
  text = $text
  lineCount = $lines.Count
  wordCount = $wordCount
} | ConvertTo-Json -Compress
`;

export class WindowsOcrProvider implements IOcrProvider {
  async recognize(imagePath: string): Promise<OcrResult> {
    const { stdout } = await runPs(OCR_SCRIPT(imagePath), 20_000);
    return JSON.parse(stdout) as RawOcrResult;
  }
}
