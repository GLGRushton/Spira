import { quotePsString, runPs } from "@spira/mcp-util/powershell";
import { createCapturePath, pruneStaleCaptureFiles } from "../util/capture-store.js";

export interface ScreenCaptureResult {
  imagePath: string;
  width: number;
  height: number;
  capturedAt: string;
}

export interface ActiveWindowCaptureResult extends ScreenCaptureResult {
  windowTitle: string;
  processName: string;
  bounds: { x: number; y: number; width: number; height: number };
}

export interface FullscreenCaptureResult extends ScreenCaptureResult {
  monitorIndex: number;
  bounds: { x: number; y: number; width: number; height: number };
}

type RawActiveWindowCapture = {
  imagePath: string;
  width: number;
  height: number;
  windowTitle: string;
  processName: string;
  bounds: { x: number; y: number; width: number; height: number };
};

type RawFullscreenCapture = {
  imagePath: string;
  width: number;
  height: number;
  monitorIndex: number;
  bounds: { x: number; y: number; width: number; height: number };
};

const pruneStaleCaptureFilesSafely = async (captureTarget: "active window" | "fullscreen"): Promise<void> => {
  try {
    await pruneStaleCaptureFiles();
  } catch (error) {
    console.warn(`[spira-vision] Failed to prune stale capture files before ${captureTarget} capture`, error);
  }
};

const ACTIVE_WINDOW_CAPTURE_SCRIPT = (destinationPath: string): string => `
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;

public static class SpiraWin32 {
  [DllImport("user32.dll")]
  public static extern IntPtr GetForegroundWindow();

  [DllImport("user32.dll")]
  public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);

  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);

  [DllImport("user32.dll")]
  public static extern int GetWindowThreadProcessId(IntPtr hWnd, out int processId);

  [DllImport("user32.dll")]
  public static extern bool SetProcessDPIAware();
}

public struct RECT {
  public int Left;
  public int Top;
  public int Right;
  public int Bottom;
}
"@

[SpiraWin32]::SetProcessDPIAware() | Out-Null
$handle = [SpiraWin32]::GetForegroundWindow()
if ($handle -eq [IntPtr]::Zero) {
  throw "No active window is available to capture."
}

$rect = New-Object RECT
[SpiraWin32]::GetWindowRect($handle, [ref]$rect) | Out-Null
$width = $rect.Right - $rect.Left
$height = $rect.Bottom - $rect.Top
if ($width -le 0 -or $height -le 0) {
  throw "Active window has invalid dimensions."
}

$titleBuilder = New-Object System.Text.StringBuilder 512
[SpiraWin32]::GetWindowText($handle, $titleBuilder, $titleBuilder.Capacity) | Out-Null

$processId = 0
[SpiraWin32]::GetWindowThreadProcessId($handle, [ref]$processId) | Out-Null
$process = Get-Process -Id $processId -ErrorAction Stop

$bitmap = New-Object System.Drawing.Bitmap $width, $height
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.CopyFromScreen($rect.Left, $rect.Top, 0, 0, [System.Drawing.Size]::new($width, $height))
$graphics.Dispose()
$bitmap.Save('${quotePsString(destinationPath)}', [System.Drawing.Imaging.ImageFormat]::Png)
$bitmap.Dispose()

[PSCustomObject]@{
  imagePath = '${quotePsString(destinationPath)}'
  width = $width
  height = $height
  windowTitle = $titleBuilder.ToString()
  processName = $process.ProcessName
  bounds = @{
    x = $rect.Left
    y = $rect.Top
    width = $width
    height = $height
  }
} | ConvertTo-Json -Depth 4 -Compress
`;

const FULLSCREEN_CAPTURE_SCRIPT = (destinationPath: string, monitorIndex: number): string => `
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms
Add-Type @"
using System;
using System.Runtime.InteropServices;

public static class SpiraWin32 {
  [DllImport("user32.dll")]
  public static extern bool SetProcessDPIAware();
}
"@

[SpiraWin32]::SetProcessDPIAware() | Out-Null
$screens = [System.Windows.Forms.Screen]::AllScreens
if (${monitorIndex} -lt 0 -or ${monitorIndex} -ge $screens.Length) {
  throw "Requested monitor index is unavailable."
}

$bounds = $screens[${monitorIndex}].Bounds
$bitmap = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.CopyFromScreen($bounds.X, $bounds.Y, 0, 0, [System.Drawing.Size]::new($bounds.Width, $bounds.Height))
$graphics.Dispose()
$bitmap.Save('${quotePsString(destinationPath)}', [System.Drawing.Imaging.ImageFormat]::Png)
$bitmap.Dispose()

[PSCustomObject]@{
  imagePath = '${quotePsString(destinationPath)}'
  width = $bounds.Width
  height = $bounds.Height
  monitorIndex = ${monitorIndex}
  bounds = @{
    x = $bounds.X
    y = $bounds.Y
    width = $bounds.Width
    height = $bounds.Height
  }
} | ConvertTo-Json -Depth 4 -Compress
`;

export async function captureActiveWindow(): Promise<ActiveWindowCaptureResult> {
  await pruneStaleCaptureFilesSafely("active window");
  const imagePath = await createCapturePath("active-window");
  const { stdout } = await runPs(ACTIVE_WINDOW_CAPTURE_SCRIPT(imagePath), 15_000);
  const result = JSON.parse(stdout) as RawActiveWindowCapture;

  return {
    ...result,
    capturedAt: new Date().toISOString(),
  };
}

export async function captureFullscreen(monitorIndex = 0): Promise<FullscreenCaptureResult> {
  await pruneStaleCaptureFilesSafely("fullscreen");
  const imagePath = await createCapturePath(`screen-${monitorIndex}`);
  const { stdout } = await runPs(FULLSCREEN_CAPTURE_SCRIPT(imagePath, monitorIndex), 15_000);
  const result = JSON.parse(stdout) as RawFullscreenCapture;

  return {
    ...result,
    capturedAt: new Date().toISOString(),
  };
}
