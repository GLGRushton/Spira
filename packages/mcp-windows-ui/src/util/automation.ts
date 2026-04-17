import { quotePsString, runPs } from "@spira/mcp-util/powershell";
import { createCapturePath, pruneStaleCaptureFiles } from "./capture-store.js";

export interface WindowTarget {
  handle?: number;
  title?: string;
  processName?: string;
}

export interface Rectangle {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WindowInfo {
  handle: number;
  title: string;
  processName: string;
  pid: number;
  className: string;
  bounds: Rectangle;
}

export interface UiNode {
  path: number[];
  name: string;
  automationId: string;
  className: string;
  controlType: string | null;
  helpText: string;
  isEnabled: boolean;
  hasKeyboardFocus: boolean;
  isOffscreen: boolean;
  boundingRectangle: Rectangle | null;
  supportedActions: string[];
  childCount: number;
  runtimeId: string[];
  children?: UiNode[];
}

export interface WindowCaptureResult extends WindowInfo {
  imagePath: string;
  width: number;
  height: number;
  captureMethod: "print-window" | "copy-from-screen";
  capturedAt: string;
}

const pruneStaleCaptureFilesSafely = async (): Promise<void> => {
  try {
    await pruneStaleCaptureFiles();
  } catch (error) {
    console.warn("[spira-windows-ui] Failed to prune stale capture files before window capture", error);
  }
};

export interface VirtualListResult {
  window: WindowInfo;
  targetPath: number[];
  iterations: number;
  uniqueCount: number;
  scrollSupported: boolean;
  items: UiNode[];
}

export interface WindowActivationResult {
  window: WindowInfo;
  activated: boolean;
  restored: boolean;
}

export interface WindowClickResult extends WindowActivationResult {
  relativePoint: { x: number; y: number };
  absolutePoint: { x: number; y: number };
  button: "left" | "right";
  doubleClick: boolean;
}

export interface WindowSendKeysResult extends WindowActivationResult {
  mode: "text" | "keys";
  textLength?: number;
  keys?: string;
}

interface FindNodesArgs extends WindowTarget {
  path?: number[];
  name?: string;
  automationId?: string;
  className?: string;
  controlType?: string;
  maxDepth: number;
  limit: number;
}

interface TreeArgs extends WindowTarget {
  path?: number[];
  maxDepth: number;
}

interface ActionArgs extends WindowTarget {
  path: number[];
  action: string;
  text?: string;
}

interface ScrapeArgs extends WindowTarget {
  path?: number[];
  name?: string;
  automationId?: string;
  className?: string;
  controlType?: string;
  itemControlType?: string;
  itemMaxDepth: number;
  maxIterations: number;
  maxItems: number;
}

const encodePsJson = (value: unknown): string => Buffer.from(JSON.stringify(value), "utf8").toString("base64");

const COMMON_AUTOMATION_SCRIPT = `
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type @"
using System;
using System.Drawing;
using System.Runtime.InteropServices;
using System.Text;

public static class SpiraUiWin32 {
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

  [DllImport("user32.dll")]
  public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);

  [DllImport("user32.dll")]
  public static extern bool IsWindowVisible(IntPtr hWnd);

  [DllImport("user32.dll")]
  public static extern int GetWindowTextLength(IntPtr hWnd);

  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);

  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  public static extern int GetClassName(IntPtr hWnd, StringBuilder text, int count);

  [DllImport("user32.dll")]
  public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);

  [DllImport("user32.dll")]
  public static extern int GetWindowThreadProcessId(IntPtr hWnd, out int processId);

  [DllImport("user32.dll")]
  public static extern bool SetProcessDPIAware();

  [DllImport("user32.dll")]
  public static extern bool PrintWindow(IntPtr hwnd, IntPtr hDC, int flags);

  [DllImport("user32.dll")]
  public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);

  [DllImport("user32.dll")]
  public static extern bool SetForegroundWindow(IntPtr hWnd);

  [DllImport("user32.dll")]
  public static extern bool IsIconic(IntPtr hWnd);

  [DllImport("user32.dll")]
  public static extern bool SetCursorPos(int x, int y);

  [DllImport("user32.dll")]
  public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, UIntPtr dwExtraInfo);
}

public struct RECT {
  public int Left;
  public int Top;
  public int Right;
  public int Bottom;
}
"@

[SpiraUiWin32]::SetProcessDPIAware() | Out-Null

function Convert-SpiraWindowRect {
  param($Rect)

  return @{
    x = [long]$Rect.Left
    y = [long]$Rect.Top
    width = [long]($Rect.Right - $Rect.Left)
    height = [long]($Rect.Bottom - $Rect.Top)
  }
}

function Convert-SpiraFiniteNumber {
  param($Value)

  try {
    $number = [double]$Value
  } catch {
    return $null
  }

  if ([double]::IsNaN($number) -or [double]::IsInfinity($number)) {
    return $null
  }

  return [Math]::Round($number, 2)
}

function Convert-SpiraAutomationRect {
  param($Rect)

  if ($null -eq $Rect) {
    return $null
  }

  $x = Convert-SpiraFiniteNumber $Rect.Left
  $y = Convert-SpiraFiniteNumber $Rect.Top
  $width = Convert-SpiraFiniteNumber $Rect.Width
  $height = Convert-SpiraFiniteNumber $Rect.Height

  if ($null -eq $x -or $null -eq $y -or $null -eq $width -or $null -eq $height) {
    return $null
  }

  return @{
    x = $x
    y = $y
    width = $width
    height = $height
  }
}

function Convert-SpiraPath {
  param($Path)

  if ($null -eq $Path) {
    return @()
  }

  return @($Path | ForEach-Object { [int]$_ })
}

function Get-SpiraType {
  param([string]$TypeName)

  foreach ($assemblyName in @("UIAutomationClient", "UIAutomationTypes")) {
    $resolved = [type]::GetType("$TypeName, $assemblyName", $false)
    if ($null -ne $resolved) {
      return $resolved
    }
  }

  foreach ($assembly in [AppDomain]::CurrentDomain.GetAssemblies()) {
    $resolved = $assembly.GetType($TypeName, $false, $false)
    if ($null -ne $resolved) {
      return $resolved
    }
  }

  return $null
}

$script:SpiraLegacyPatternType = Get-SpiraType "System.Windows.Automation.LegacyIAccessiblePattern"
$script:SpiraLegacyPattern = if ($null -ne $script:SpiraLegacyPatternType) {
  $script:SpiraLegacyPatternType.GetField("Pattern").GetValue($null)
} else {
  $null
}

function Get-SpiraWindowList {
  $windows = New-Object System.Collections.Generic.List[object]
  $callback = [SpiraUiWin32+EnumWindowsProc]{
    param([IntPtr]$Handle, [IntPtr]$LParam)

    if (-not [SpiraUiWin32]::IsWindowVisible($Handle)) {
      return $true
    }

    $titleLength = [SpiraUiWin32]::GetWindowTextLength($Handle)
    if ($titleLength -le 0) {
      return $true
    }

    $titleBuilder = New-Object System.Text.StringBuilder ($titleLength + 1)
    [SpiraUiWin32]::GetWindowText($Handle, $titleBuilder, $titleBuilder.Capacity) | Out-Null
    $title = $titleBuilder.ToString()
    if ([string]::IsNullOrWhiteSpace($title)) {
      return $true
    }

    $classBuilder = New-Object System.Text.StringBuilder 256
    [SpiraUiWin32]::GetClassName($Handle, $classBuilder, $classBuilder.Capacity) | Out-Null

    $processId = 0
    [SpiraUiWin32]::GetWindowThreadProcessId($Handle, [ref]$processId) | Out-Null
    $process = Get-Process -Id $processId -ErrorAction SilentlyContinue

    $rect = New-Object RECT
    [SpiraUiWin32]::GetWindowRect($Handle, [ref]$rect) | Out-Null

    $windows.Add([PSCustomObject]@{
      handle = [int64]$Handle
      title = $title
      processName = if ($process) { $process.ProcessName } else { "" }
      pid = [int]$processId
      className = $classBuilder.ToString()
      bounds = Convert-SpiraWindowRect $rect
    }) | Out-Null

    return $true
  }

  [SpiraUiWin32]::EnumWindows($callback, [IntPtr]::Zero) | Out-Null
  return @($windows | Sort-Object title)
}

function Resolve-SpiraWindow {
  param($Target)

  $windows = Get-SpiraWindowList
  $match = $null

  if ($Target.PSObject.Properties.Name -contains 'handle' -and $null -ne $Target.handle) {
    $requestedHandle = [int64]$Target.handle
    $match = $windows | Where-Object { $_.handle -eq $requestedHandle } | Select-Object -First 1
  } else {
    $candidates = $windows

    if ($Target.PSObject.Properties.Name -contains 'title' -and -not [string]::IsNullOrWhiteSpace($Target.title)) {
      $titleTerm = [string]$Target.title
      $candidates = @($candidates | Where-Object { $_.title -like "*$titleTerm*" })
    }

    if ($Target.PSObject.Properties.Name -contains 'processName' -and -not [string]::IsNullOrWhiteSpace($Target.processName)) {
      $processTerm = [string]$Target.processName
      $candidates = @($candidates | Where-Object { $_.processName -ieq $processTerm })
    }

    $match = $candidates | Select-Object -First 1
  }

  if ($null -eq $match) {
    throw "No matching window found."
  }

  return $match
}

function Get-SpiraAutomationElement {
  param($WindowInfo)

  $element = [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]$WindowInfo.handle)
  if ($null -eq $element) {
    throw "Unable to access the automation tree for the selected window."
  }

  return $element
}

function Get-SpiraChildElements {
  param($Element)

  $children = $Element.FindAll(
    [System.Windows.Automation.TreeScope]::Children,
    [System.Windows.Automation.Condition]::TrueCondition
  )

  $result = @()
  for ($index = 0; $index -lt $children.Count; $index += 1) {
    $result += $children.Item($index)
  }

  return @($result)
}

function Get-SpiraRuntimeId {
  param($Element)

  try {
    return @($Element.GetRuntimeId() | ForEach-Object { [string]$_ })
  } catch {
    return @()
  }
}

function Get-SpiraControlTypeName {
  param($Element)

  try {
    $name = [string]$Element.Current.ControlType.ProgrammaticName
    if ([string]::IsNullOrWhiteSpace($name)) {
      return $null
    }

    return $name -replace '^ControlType\\.', ''
  } catch {
    return $null
  }
}

function Get-SpiraPattern {
  param($Element, $Pattern)

  $instance = $null
  if ($Element.TryGetCurrentPattern($Pattern, [ref]$instance)) {
    return $instance
  }

  return $null
}

function Get-SpiraSupportedActions {
  param($Element)

  $actions = New-Object System.Collections.Generic.List[string]
  if ($null -ne (Get-SpiraPattern $Element ([System.Windows.Automation.InvokePattern]::Pattern))) {
    $actions.Add("invoke") | Out-Null
  }

  if ($null -ne (Get-SpiraPattern $Element ([System.Windows.Automation.SelectionItemPattern]::Pattern))) {
    $actions.Add("select") | Out-Null
  }

  if ($null -ne (Get-SpiraPattern $Element ([System.Windows.Automation.ExpandCollapsePattern]::Pattern))) {
    $actions.Add("expand") | Out-Null
    $actions.Add("collapse") | Out-Null
  }

  if ($null -ne (Get-SpiraPattern $Element ([System.Windows.Automation.ScrollItemPattern]::Pattern))) {
    $actions.Add("scroll-into-view") | Out-Null
  }

  if ($null -ne (Get-SpiraPattern $Element ([System.Windows.Automation.TogglePattern]::Pattern))) {
    $actions.Add("toggle") | Out-Null
  }

  if (
    $null -ne (Get-SpiraPattern $Element ([System.Windows.Automation.ValuePattern]::Pattern)) -or
    ($null -ne $script:SpiraLegacyPattern -and $null -ne (Get-SpiraPattern $Element $script:SpiraLegacyPattern))
  ) {
    $actions.Add("set-value") | Out-Null
  }

  $actions.Add("focus") | Out-Null
  return @($actions | Select-Object -Unique)
}

function New-SpiraNodeSummary {
  param($Element, $Path, [int]$ChildCount)

  $name = ""
  $automationId = ""
  $className = ""
  $helpText = ""
  $isEnabled = $false
  $hasKeyboardFocus = $false
  $isOffscreen = $false
  $rect = $null

  try { $name = [string]$Element.Current.Name } catch {}
  try { $automationId = [string]$Element.Current.AutomationId } catch {}
  try { $className = [string]$Element.Current.ClassName } catch {}
  try { $helpText = [string]$Element.Current.HelpText } catch {}
  try { $isEnabled = [bool]$Element.Current.IsEnabled } catch {}
  try { $hasKeyboardFocus = [bool]$Element.Current.HasKeyboardFocus } catch {}
  try { $isOffscreen = [bool]$Element.Current.IsOffscreen } catch {}
  try { $rect = $Element.Current.BoundingRectangle } catch {}

  return [PSCustomObject][ordered]@{
    path = @(Convert-SpiraPath $Path)
    name = $name
    automationId = $automationId
    className = $className
    controlType = Get-SpiraControlTypeName $Element
    helpText = $helpText
    isEnabled = $isEnabled
    hasKeyboardFocus = $hasKeyboardFocus
    isOffscreen = $isOffscreen
    boundingRectangle = if ($null -ne $rect) { Convert-SpiraAutomationRect $rect } else { $null }
    supportedActions = @(Get-SpiraSupportedActions $Element)
    childCount = [int]$ChildCount
    runtimeId = @(Get-SpiraRuntimeId $Element)
  }
}

function Serialize-SpiraElement {
  param($Element, $Path, [int]$Depth, [int]$MaxDepth)

  $normalizedPath = Convert-SpiraPath $Path
  $children = Get-SpiraChildElements $Element
  $node = New-SpiraNodeSummary $Element $normalizedPath $children.Count

  if ($Depth -lt $MaxDepth) {
    $serializedChildren = @()
    for ($index = 0; $index -lt $children.Count; $index += 1) {
      $childPath = @($normalizedPath + $index)
      $serializedChildren += Serialize-SpiraElement -Element $children[$index] -Path $childPath -Depth ($Depth + 1) -MaxDepth $MaxDepth
    }

    Add-Member -InputObject $node -NotePropertyName children -NotePropertyValue @($serializedChildren)
  }

  return $node
}

function Get-SpiraElementByPath {
  param($Root, $Path)

  $normalizedPath = Convert-SpiraPath $Path
  $current = $Root
  foreach ($segment in $normalizedPath) {
    $children = Get-SpiraChildElements $current
    if ($segment -lt 0 -or $segment -ge $children.Count) {
      throw "Node path segment $segment is out of range."
    }

    $current = $children[$segment]
  }

  return $current
}

function Test-SpiraNodeMatch {
  param($Element, $Selector)

  $currentName = ""
  $currentAutomationId = ""
  $currentClassName = ""
  try { $currentName = [string]$Element.Current.Name } catch {}
  try { $currentAutomationId = [string]$Element.Current.AutomationId } catch {}
  try { $currentClassName = [string]$Element.Current.ClassName } catch {}
  $currentControlType = [string](Get-SpiraControlTypeName $Element)

  if ($Selector.PSObject.Properties.Name -contains 'name' -and -not [string]::IsNullOrWhiteSpace($Selector.name)) {
    if ($currentName -notlike "*$([string]$Selector.name)*") {
      return $false
    }
  }

  if ($Selector.PSObject.Properties.Name -contains 'automationId' -and -not [string]::IsNullOrWhiteSpace($Selector.automationId)) {
    if ($currentAutomationId -notlike "*$([string]$Selector.automationId)*") {
      return $false
    }
  }

  if ($Selector.PSObject.Properties.Name -contains 'className' -and -not [string]::IsNullOrWhiteSpace($Selector.className)) {
    if ($currentClassName -notlike "*$([string]$Selector.className)*") {
      return $false
    }
  }

  if ($Selector.PSObject.Properties.Name -contains 'controlType' -and -not [string]::IsNullOrWhiteSpace($Selector.controlType)) {
    if ($currentControlType.ToLowerInvariant() -ne ([string]$Selector.controlType).ToLowerInvariant()) {
      return $false
    }
  }

  return $true
}

function Find-SpiraElements {
  param($Element, $Selector, $Path, [int]$Depth, [int]$MaxDepth, [int]$Limit, $Results)

  $normalizedPath = Convert-SpiraPath $Path
  if ($Results.Count -ge $Limit) {
    return
  }

  if (Test-SpiraNodeMatch $Element $Selector) {
    $children = Get-SpiraChildElements $Element
    $Results.Add((New-SpiraNodeSummary $Element $normalizedPath $children.Count)) | Out-Null
    if ($Results.Count -ge $Limit) {
      return
    }
  }

  if ($Depth -ge $MaxDepth) {
    return
  }

  $children = Get-SpiraChildElements $Element
  for ($index = 0; $index -lt $children.Count; $index += 1) {
    Find-SpiraElements -Element $children[$index] -Selector $Selector -Path (@($normalizedPath + $index)) -Depth ($Depth + 1) -MaxDepth $MaxDepth -Limit $Limit -Results $Results
    if ($Results.Count -ge $Limit) {
      return
    }
  }
}

function Get-SpiraScrollableContext {
  param($Element)

  $current = $Element
  for ($depth = 0; $depth -lt 8 -and $null -ne $current; $depth += 1) {
    $pattern = Get-SpiraPattern $current ([System.Windows.Automation.ScrollPattern]::Pattern)
    if ($null -ne $pattern) {
      return [PSCustomObject]@{
        element = $current
        pattern = $pattern
      }
    }

    $current = [System.Windows.Automation.TreeWalker]::ControlViewWalker.GetParent($current)
  }

  return $null
}

function Activate-SpiraWindow {
  param($WindowInfo, [bool]$Restore)

  $restored = $false
  if ($Restore) {
    [SpiraUiWin32]::ShowWindowAsync([IntPtr]$WindowInfo.handle, 9) | Out-Null
    Start-Sleep -Milliseconds 125
    $restored = $true
  }

  $activated = [SpiraUiWin32]::SetForegroundWindow([IntPtr]$WindowInfo.handle)
  Start-Sleep -Milliseconds 100

  return [PSCustomObject]@{
    activated = [bool]$activated
    restored = [bool]$restored
  }
}

function Click-SpiraWindowPoint {
  param($WindowInfo, [int]$RelativeX, [int]$RelativeY, [string]$Button, [bool]$DoubleClick)

  $absoluteX = [int]($WindowInfo.bounds.x + $RelativeX)
  $absoluteY = [int]($WindowInfo.bounds.y + $RelativeY)
  [SpiraUiWin32]::SetCursorPos($absoluteX, $absoluteY) | Out-Null
  Start-Sleep -Milliseconds 50

  if ($Button -eq "right") {
    $down = 0x0008
    $up = 0x0010
  } else {
    $down = 0x0002
    $up = 0x0004
  }

  $clickCount = if ($DoubleClick) { 2 } else { 1 }
  for ($index = 0; $index -lt $clickCount; $index += 1) {
    [SpiraUiWin32]::mouse_event($down, 0, 0, 0, [UIntPtr]::Zero)
    [SpiraUiWin32]::mouse_event($up, 0, 0, 0, [UIntPtr]::Zero)
    Start-Sleep -Milliseconds 90
  }

  return [PSCustomObject]@{
    x = $absoluteX
    y = $absoluteY
  }
}

function Send-SpiraWindowInput {
  param($WindowInfo, [string]$Text, [string]$Keys)

  $shell = New-Object -ComObject WScript.Shell
  if (-not [string]::IsNullOrEmpty($Text)) {
    Set-Clipboard -Value $Text
    Start-Sleep -Milliseconds 60
    $shell.SendKeys("^v")
    return "text"
  }

  $shell.SendKeys($Keys)
  return "keys"
}

function Invoke-SpiraAction {
  param($Element, [string]$Action, [string]$Text)

  switch ($Action) {
    "focus" {
      $Element.SetFocus()
      return "Focused element."
    }
    "invoke" {
      $pattern = Get-SpiraPattern $Element ([System.Windows.Automation.InvokePattern]::Pattern)
      if ($null -ne $pattern) {
        $pattern.Invoke()
        return "Invoked element."
      }

      $legacy = if ($null -ne $script:SpiraLegacyPattern) { Get-SpiraPattern $Element $script:SpiraLegacyPattern } else { $null }
      if ($null -ne $legacy) {
        $legacy.DoDefaultAction()
        return "Invoked element via LegacyIAccessible."
      }

      throw "Element does not support invoke."
    }
    "select" {
      $pattern = Get-SpiraPattern $Element ([System.Windows.Automation.SelectionItemPattern]::Pattern)
      if ($null -eq $pattern) {
        throw "Element does not support selection."
      }

      $pattern.Select()
      return "Selected element."
    }
    "expand" {
      $pattern = Get-SpiraPattern $Element ([System.Windows.Automation.ExpandCollapsePattern]::Pattern)
      if ($null -eq $pattern) {
        throw "Element does not support expand."
      }

      $pattern.Expand()
      return "Expanded element."
    }
    "collapse" {
      $pattern = Get-SpiraPattern $Element ([System.Windows.Automation.ExpandCollapsePattern]::Pattern)
      if ($null -eq $pattern) {
        throw "Element does not support collapse."
      }

      $pattern.Collapse()
      return "Collapsed element."
    }
    "scroll-into-view" {
      $pattern = Get-SpiraPattern $Element ([System.Windows.Automation.ScrollItemPattern]::Pattern)
      if ($null -eq $pattern) {
        throw "Element does not support scroll-into-view."
      }

      $pattern.ScrollIntoView()
      return "Scrolled element into view."
    }
    "toggle" {
      $pattern = Get-SpiraPattern $Element ([System.Windows.Automation.TogglePattern]::Pattern)
      if ($null -eq $pattern) {
        throw "Element does not support toggle."
      }

      $pattern.Toggle()
      return "Toggled element."
    }
    "set-value" {
      if ([string]::IsNullOrEmpty($Text)) {
        throw "Text is required for set-value."
      }

      $valuePattern = Get-SpiraPattern $Element ([System.Windows.Automation.ValuePattern]::Pattern)
      if ($null -ne $valuePattern) {
        $valuePattern.SetValue($Text)
        return "Updated element value."
      }

      $legacy = if ($null -ne $script:SpiraLegacyPattern) { Get-SpiraPattern $Element $script:SpiraLegacyPattern } else { $null }
      if ($null -ne $legacy) {
        $legacy.SetValue($Text)
        return "Updated element value via LegacyIAccessible."
      }

      throw "Element does not support set-value."
    }
    default {
      throw "Unsupported action: $Action"
    }
  }
}

function Capture-SpiraWindow {
  param($WindowInfo, [string]$DestinationPath, [bool]$PreferPrintWindow)

  $rect = New-Object RECT
  [SpiraUiWin32]::GetWindowRect([IntPtr]$WindowInfo.handle, [ref]$rect) | Out-Null
  $width = [int]($rect.Right - $rect.Left)
  $height = [int]($rect.Bottom - $rect.Top)

  if ($width -le 0 -or $height -le 0) {
    throw "Selected window has invalid dimensions."
  }

  $bitmap = New-Object System.Drawing.Bitmap $width, $height
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $captureMethod = "copy-from-screen"
  $printed = $false

  if ($PreferPrintWindow) {
    $hDC = $graphics.GetHdc()
    try {
      $printed = [SpiraUiWin32]::PrintWindow([IntPtr]$WindowInfo.handle, $hDC, 0)
    } finally {
      $graphics.ReleaseHdc($hDC)
    }

    if ($printed) {
      $captureMethod = "print-window"
    }
  }

  if (-not $printed) {
    $graphics.CopyFromScreen($rect.Left, $rect.Top, 0, 0, [System.Drawing.Size]::new($width, $height))
  }

  $graphics.Dispose()
  $bitmap.Save($DestinationPath, [System.Drawing.Imaging.ImageFormat]::Png)
  $bitmap.Dispose()

  return [PSCustomObject]@{
    imagePath = $DestinationPath
    width = $width
    height = $height
    captureMethod = $captureMethod
  }
}
`;

const buildAutomationScript = (params: unknown, body: string): string => `
${COMMON_AUTOMATION_SCRIPT}
$params = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encodePsJson(params)}')) | ConvertFrom-Json
${body}
`;

const parseJson = <T>(stdout: string): T => JSON.parse(stdout) as T;

async function runAutomationScript<T>(params: unknown, body: string, timeoutMs = 20_000): Promise<T> {
  const { stdout } = await runPs(buildAutomationScript(params, body), timeoutMs);
  return parseJson<T>(stdout);
}

export async function listWindows(): Promise<WindowInfo[]> {
  return await runAutomationScript<WindowInfo[]>(
    {},
    `
@(
  Get-SpiraWindowList
) | ConvertTo-Json -Depth 6 -Compress
`,
  );
}

export async function captureWindow(target: WindowTarget, preferPrintWindow: boolean): Promise<WindowCaptureResult> {
  await pruneStaleCaptureFilesSafely();
  const imagePath = await createCapturePath("window");

  const result = await runAutomationScript<Omit<WindowCaptureResult, "capturedAt">>(
    {
      target,
      imagePath,
      preferPrintWindow,
    },
    `
$window = Resolve-SpiraWindow $params.target
$capture = Capture-SpiraWindow -WindowInfo $window -DestinationPath '${quotePsString(imagePath)}' -PreferPrintWindow ([bool]$params.preferPrintWindow)

[PSCustomObject]@{
  handle = $window.handle
  title = $window.title
  processName = $window.processName
  pid = $window.pid
  className = $window.className
  bounds = $window.bounds
  imagePath = $capture.imagePath
  width = $capture.width
  height = $capture.height
  captureMethod = $capture.captureMethod
} | ConvertTo-Json -Depth 6 -Compress
`,
    25_000,
  );

  return {
    ...result,
    capturedAt: new Date().toISOString(),
  };
}

export async function activateWindow(target: WindowTarget, restore: boolean): Promise<WindowActivationResult> {
  return await runAutomationScript<WindowActivationResult>(
    {
      target,
      restore,
    },
    `
$window = Resolve-SpiraWindow $params.target
$activation = Activate-SpiraWindow -WindowInfo $window -Restore ([bool]$params.restore)

[PSCustomObject]@{
  window = $window
  activated = $activation.activated
  restored = $activation.restored
} | ConvertTo-Json -Depth 6 -Compress
`,
    15_000,
  );
}

export async function clickWindowPoint(args: {
  target: WindowTarget;
  x: number;
  y: number;
  button: "left" | "right";
  doubleClick: boolean;
  restore: boolean;
}): Promise<WindowClickResult> {
  return await runAutomationScript<WindowClickResult>(
    args,
    `
$window = Resolve-SpiraWindow $params.target
$activation = Activate-SpiraWindow -WindowInfo $window -Restore ([bool]$params.restore)
$absolute = Click-SpiraWindowPoint -WindowInfo $window -RelativeX ([int]$params.x) -RelativeY ([int]$params.y) -Button ([string]$params.button) -DoubleClick ([bool]$params.doubleClick)

[PSCustomObject]@{
  window = $window
  activated = $activation.activated
  restored = $activation.restored
  relativePoint = @{
    x = [int]$params.x
    y = [int]$params.y
  }
  absolutePoint = $absolute
  button = [string]$params.button
  doubleClick = [bool]$params.doubleClick
} | ConvertTo-Json -Depth 6 -Compress
`,
    15_000,
  );
}

export async function sendKeysToWindow(args: {
  target: WindowTarget;
  text?: string;
  keys?: string;
  restore: boolean;
}): Promise<WindowSendKeysResult> {
  return await runAutomationScript<WindowSendKeysResult>(
    args,
    `
$window = Resolve-SpiraWindow $params.target
$activation = Activate-SpiraWindow -WindowInfo $window -Restore ([bool]$params.restore)
$mode = Send-SpiraWindowInput -WindowInfo $window -Text ([string]$params.text) -Keys ([string]$params.keys)

[PSCustomObject]@{
  window = $window
  activated = $activation.activated
  restored = $activation.restored
  mode = $mode
  textLength = if ($mode -eq "text") { ([string]$params.text).Length } else { $null }
  keys = if ($mode -eq "keys") { [string]$params.keys } else { $null }
} | ConvertTo-Json -Depth 6 -Compress
`,
    20_000,
  );
}

export async function getUiTree(args: TreeArgs): Promise<{ window: WindowInfo; root: UiNode }> {
  return await runAutomationScript<{ window: WindowInfo; root: UiNode }>(
    args,
    `
$window = Resolve-SpiraWindow $params
$root = Get-SpiraAutomationElement $window
$path = @()
if ($params.PSObject.Properties.Name -contains 'path' -and $null -ne $params.path) {
  $path = @($params.path)
  $root = Get-SpiraElementByPath -Root $root -Path $path
}

[PSCustomObject]@{
  window = $window
  root = Serialize-SpiraElement -Element $root -Path $path -Depth 0 -MaxDepth ([int]$params.maxDepth)
} | ConvertTo-Json -Depth 12 -Compress
`,
    25_000,
  );
}

export async function findUiNodes(args: FindNodesArgs): Promise<{ window: WindowInfo; matches: UiNode[] }> {
  return await runAutomationScript<{ window: WindowInfo; matches: UiNode[] }>(
    args,
    `
$window = Resolve-SpiraWindow $params
$root = Get-SpiraAutomationElement $window
$path = @()
if ($params.PSObject.Properties.Name -contains 'path' -and $null -ne $params.path) {
  $path = @($params.path)
  $root = Get-SpiraElementByPath -Root $root -Path $path
}

$results = New-Object System.Collections.Generic.List[object]
Find-SpiraElements -Element $root -Selector $params -Path $path -Depth 0 -MaxDepth ([int]$params.maxDepth) -Limit ([int]$params.limit) -Results $results

[PSCustomObject]@{
  window = $window
  matches = @($results | ForEach-Object { $_ })
} | ConvertTo-Json -Depth 8 -Compress
`,
    25_000,
  );
}

export async function actOnUiNode(
  args: ActionArgs,
): Promise<{ window: WindowInfo; node: UiNode; action: string; message: string }> {
  return await runAutomationScript<{ window: WindowInfo; node: UiNode; action: string; message: string }>(
    args,
    `
$window = Resolve-SpiraWindow $params
$root = Get-SpiraAutomationElement $window
$path = @($params.path)
$element = Get-SpiraElementByPath -Root $root -Path $path
$message = Invoke-SpiraAction -Element $element -Action ([string]$params.action) -Text ([string]$params.text)
$children = Get-SpiraChildElements $element

[PSCustomObject]@{
  window = $window
  action = [string]$params.action
  message = $message
  node = New-SpiraNodeSummary -Element $element -Path $path -ChildCount $children.Count
} | ConvertTo-Json -Depth 8 -Compress
`,
    20_000,
  );
}

export async function scrapeVirtualList(args: ScrapeArgs): Promise<VirtualListResult> {
  return await runAutomationScript<VirtualListResult>(
    args,
    `
$window = Resolve-SpiraWindow $params
$root = Get-SpiraAutomationElement $window
$targetPath = @()
$container = $root

if ($params.PSObject.Properties.Name -contains 'path' -and $null -ne $params.path) {
  $targetPath = @($params.path)
  $container = Get-SpiraElementByPath -Root $root -Path $targetPath
} else {
  $matches = New-Object System.Collections.Generic.List[object]
  Find-SpiraElements -Element $root -Selector $params -Path @() -Depth 0 -MaxDepth 6 -Limit 1 -Results $matches
  if ($matches.Count -eq 0) {
    throw "Unable to locate a list container that matches the selector."
  }

  $targetPath = @($matches[0].path)
  $container = Get-SpiraElementByPath -Root $root -Path $targetPath
}

$scrollContext = Get-SpiraScrollableContext $container
$items = New-Object System.Collections.Generic.List[object]
$seen = New-Object 'System.Collections.Generic.HashSet[string]'

function Add-SpiraVisibleItems {
  param($Element, $BasePath, [int]$ItemMaxDepth, $Seen, $Items, [string]$ItemControlType)

  $normalizedBasePath = Convert-SpiraPath $BasePath
  $matches = New-Object System.Collections.Generic.List[object]
  if ([string]::IsNullOrWhiteSpace($ItemControlType)) {
    $children = Get-SpiraChildElements $Element
    for ($index = 0; $index -lt $children.Count; $index += 1) {
      $summary = New-SpiraNodeSummary -Element $children[$index] -Path (@($normalizedBasePath + $index)) -ChildCount ((Get-SpiraChildElements $children[$index]).Count)
      $matches.Add($summary) | Out-Null
    }
  } else {
    $selector = [PSCustomObject]@{ controlType = $ItemControlType }
    Find-SpiraElements -Element $Element -Selector $selector -Path $normalizedBasePath -Depth 0 -MaxDepth $ItemMaxDepth -Limit 500 -Results $matches
  }

  foreach ($match in $matches) {
    $signature = if ($match.runtimeId.Count -gt 0) {
      ($match.runtimeId -join ":")
    } else {
      "{0}|{1}|{2}|{3}" -f $match.name, $match.automationId, $match.className, $match.controlType
    }

    if ($Seen.Add($signature)) {
      $Items.Add($match) | Out-Null
    }
  }
}

$iterations = 0
do {
  $iterations += 1
  Add-SpiraVisibleItems -Element $container -BasePath $targetPath -ItemMaxDepth ([int]$params.itemMaxDepth) -Seen $seen -Items $items -ItemControlType ([string]$params.itemControlType)

  if ($items.Count -ge [int]$params.maxItems -or $null -eq $scrollContext) {
    break
  }

  $pattern = $scrollContext.pattern
  if (-not $pattern.Current.VerticallyScrollable) {
    break
  }

  $before = $pattern.Current.VerticalScrollPercent
  $pattern.Scroll([System.Windows.Automation.ScrollAmount]::NoAmount, [System.Windows.Automation.ScrollAmount]::LargeIncrement)
  Start-Sleep -Milliseconds 125
  $after = $pattern.Current.VerticalScrollPercent

  if ($after -eq $before -or $after -ge 100) {
    Add-SpiraVisibleItems -Element $container -BasePath $targetPath -ItemMaxDepth ([int]$params.itemMaxDepth) -Seen $seen -Items $items -ItemControlType ([string]$params.itemControlType)
    break
  }
} while ($iterations -lt [int]$params.maxIterations)

[PSCustomObject]@{
  window = $window
  targetPath = @($targetPath)
  iterations = $iterations
  uniqueCount = $items.Count
  scrollSupported = ($null -ne $scrollContext)
  items = @($items | Select-Object -First ([int]$params.maxItems))
} | ConvertTo-Json -Depth 8 -Compress
`,
    45_000,
  );
}
