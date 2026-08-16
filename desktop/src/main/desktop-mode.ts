/**
 * M5 desktop-mode runtimes for the DSH desktop shell:
 * - DesktopWallpaperRuntime: a dedicated frameless wallpaper window attached
 *   to the WorkerW desktop window behind the desktop icons.
 * - DesktopModeRuntime: embeds the main BrowserWindow into Explorer's desktop
 *   icon host (SHELLDLL_DefView) and controls desktop-icon visibility,
 *   software-interaction lock, pointer routing, and keyboard focus.
 *
 * The Win32 interop is an independent implementation for DSH: it sends the
 * standard Progman/WorkerW shell window messages, changes WS_CHILD/WS_POPUP
 * styles, and reparents windows with SetParent. It never patches Explorer and
 * always restores the original parent/style on disable.
 *
 * @module apps/desktop/src/main/desktop-mode
 */

import { execFile } from 'node:child_process'
import type { BrowserWindow, Screen } from 'electron'

function textOf(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

export interface DesktopBounds {
  x: number
  y: number
  width: number
  height: number
}

export interface DesktopWindowSnapshot {
  bounds: DesktopBounds
  maximized: boolean
  fullScreen: boolean
  minimized: boolean
  resizable: boolean
  movable: boolean
  focusable: boolean
  hasShadow: boolean
  minimumSize: [number, number] | null
  maximumSize: [number, number] | null
}

export interface WorkerWAttachment {
  targetWindowId: string
  parentWindowId: string
  parentClassName: string
  x: number
  y: number
  width: number
  height: number
}

export interface DesktopIconHostAck {
  targetWindowId: string
  parentWindowId: string
  parentClassName: string
  topLevelHostWindowId: string
  desktopViewWindowId: string
  desktopListWindowId: string
  child: boolean
  popup: boolean
}

interface NativeExecOptions {
  execFileImpl?: typeof execFile | undefined
  nativeTempPath?: string | undefined
}

/** The C# surface every generated PowerShell script shares. */
function desktopWin32Class(): string {
  return [
    'using System;',
    'using System.Diagnostics;',
    'using System.IO;',
    'using System.Runtime.InteropServices;',
    'using System.Text;',
    'public static class DshDesktopWin32 {',
    '  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);',
    '  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }',
    '  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }',
    '  [DllImport("user32.dll", CharSet=CharSet.Unicode, SetLastError=true)] public static extern IntPtr FindWindow(string className, string windowName);',
    '  [DllImport("user32.dll", CharSet=CharSet.Unicode, SetLastError=true)] public static extern IntPtr FindWindowEx(IntPtr parent, IntPtr after, string className, string windowName);',
    '  [DllImport("user32.dll", SetLastError=true)] [return: MarshalAs(UnmanagedType.Bool)] public static extern bool EnumWindows(EnumWindowsProc callback, IntPtr lParam);',
    '  [DllImport("user32.dll", SetLastError=true)] public static extern IntPtr SetParent(IntPtr child, IntPtr parent);',
    '  [DllImport("user32.dll", SetLastError=true)] public static extern IntPtr GetParent(IntPtr child);',
    '  [DllImport("user32.dll", SetLastError=true)] [return: MarshalAs(UnmanagedType.Bool)] public static extern bool IsWindow(IntPtr hWnd);',
    '  [DllImport("user32.dll", SetLastError=true)] [return: MarshalAs(UnmanagedType.Bool)] public static extern bool IsWindowVisible(IntPtr hWnd);',
    '  [DllImport("user32.dll", SetLastError=true)] [return: MarshalAs(UnmanagedType.Bool)] public static extern bool ShowWindow(IntPtr hWnd, int command);',
    '  [DllImport("user32.dll", SetLastError=true)] [return: MarshalAs(UnmanagedType.Bool)] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr insertAfter, int x, int y, int width, int height, uint flags);',
    '  [DllImport("user32.dll", SetLastError=true)] [return: MarshalAs(UnmanagedType.Bool)] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);',
    '  [DllImport("user32.dll", SetLastError=true)] [return: MarshalAs(UnmanagedType.Bool)] public static extern bool ScreenToClient(IntPtr hWnd, ref POINT point);',
    '  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr hWnd, StringBuilder value, int maxCount);',
    '  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder value, int maxCount);',
    '  [DllImport("user32.dll", SetLastError=true)] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);',
    '  [DllImport("user32.dll")] public static extern int GetSystemMetrics(int index);',
    '  [DllImport("user32.dll", SetLastError=true)] public static extern IntPtr SendMessageTimeout(IntPtr hWnd, uint message, IntPtr wParam, IntPtr lParam, uint flags, uint timeout, out IntPtr result);',
    '  [DllImport("user32.dll", EntryPoint="GetWindowLongPtrW", SetLastError=true)] private static extern IntPtr GetWindowLongPtr64(IntPtr hWnd, int index);',
    '  [DllImport("user32.dll", EntryPoint="GetWindowLongW", SetLastError=true)] private static extern IntPtr GetWindowLong32(IntPtr hWnd, int index);',
    '  [DllImport("user32.dll", EntryPoint="SetWindowLongPtrW", SetLastError=true)] private static extern IntPtr SetWindowLongPtr64(IntPtr hWnd, int index, IntPtr value);',
    '  [DllImport("user32.dll", EntryPoint="SetWindowLongW", SetLastError=true)] private static extern IntPtr SetWindowLong32(IntPtr hWnd, int index, IntPtr value);',
    '  [DllImport("user32.dll")] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);',
    '  public static IntPtr GetWindowLongPtr(IntPtr hWnd, int index) { return IntPtr.Size == 8 ? GetWindowLongPtr64(hWnd, index) : GetWindowLong32(hWnd, index); }',
    '  public static IntPtr SetWindowLongPtr(IntPtr hWnd, int index, IntPtr value) { return IntPtr.Size == 8 ? SetWindowLongPtr64(hWnd, index, value) : SetWindowLong32(hWnd, index, value); }',
    '  public static string WindowTitle(IntPtr hWnd) {',
    '    StringBuilder text = new StringBuilder(1024);',
    '    GetWindowText(hWnd, text, text.Capacity);',
    '    return text.ToString();',
    '  }',
    '  public static uint WindowProcessId(IntPtr hWnd) {',
    '    uint processId;',
    '    GetWindowThreadProcessId(hWnd, out processId);',
    '    return processId;',
    '  }',
    '  public static string ProcessExecutable(uint processId) {',
    '    if (processId == 0) return "";',
    '    try {',
    '      using (Process process = Process.GetProcessById((int)processId)) {',
    '        try { return Path.GetFullPath(process.MainModule.FileName); } catch { return ""; }',
    '      }',
    '    } catch { return ""; }',
    '  }',
    '  public static IntPtr ParseWindowHandle(string sourceId) {',
    '    string[] parts = (sourceId ?? "").Split(\':\');',
    '    if (parts.Length != 3 || !String.Equals(parts[0], "window", StringComparison.Ordinal)) return IntPtr.Zero;',
    '    ulong raw;',
    '    if (!UInt64.TryParse(parts[1], out raw) || raw == 0) return IntPtr.Zero;',
    '    return IntPtr.Size == 8 ? new IntPtr(unchecked((long)raw)) : new IntPtr(unchecked((int)raw));',
    '  }',
    '}',
  ].join('\n')
}

/** Generate one self-contained PowerShell script around a body string. */
export function desktopPowerShellScript(body: string): string {
  return [
    '$ErrorActionPreference = "Stop"',
    'if (-not ("DshDesktopWin32" -as [type])) { Add-Type -TypeDefinition @"',
    desktopWin32Class(),
    '"@ }',
    '$previousDpiContext = [IntPtr]::Zero',
    'try {',
    '  try { $previousDpiContext = [DshDesktopWin32]::SetThreadDpiAwarenessContext([IntPtr]::new([Int64]-4)) } catch { }',
    '  ' + body.replace(/\n/g, '\n  '),
    '} finally {',
    '  if ($previousDpiContext -ne [IntPtr]::Zero) {',
    '    try { [DshDesktopWin32]::SetThreadDpiAwarenessContext($previousDpiContext) | Out-Null } catch { }',
    '  }',
    '}',
  ].join('\n')
}

function normalizeBounds(value: DesktopBounds | undefined, fallback: DesktopBounds): DesktopBounds {
  const source = value ?? fallback
  return {
    x: Math.round(source.x || 0),
    y: Math.round(source.y || 0),
    width: Math.max(1, Math.round(source.width || 1)),
    height: Math.max(1, Math.round(source.height || 1)),
  }
}

function nativeWindowHandleDecimal(win: BrowserWindow): string {
  const handle = win.getNativeWindowHandle()
  if (!Buffer.isBuffer(handle) || handle.length < 4) throw new Error('DSH_DESKTOP_NATIVE_HANDLE_INVALID')
  if (handle.length >= 8) return handle.readBigUInt64LE(0).toString()
  return String(handle.readUInt32LE(0))
}

/** WorkerW attach: Progman -> WorkerW behind SHELLDLL_DefView -> child-style reparent. */
export function workerWAttachScript(input: { hwnd: string } & DesktopBounds): string {
  const hwnd = input.hwnd
  if (!/^\d+$/.test(hwnd)) throw new Error('DSH_DESKTOP_NATIVE_HANDLE_INVALID')
  const bounds = normalizeBounds(input, { x: 0, y: 0, width: 1, height: 1 })
  const body = [
    '$target = [IntPtr]::new([Int64]' + hwnd + ')',
    'if (-not [DshDesktopWin32]::IsWindow($target)) { throw "DSH_DESKTOP_TARGET_NOT_FOUND" }',
    '$progman = [DshDesktopWin32]::FindWindow("Progman", $null)',
    'if ($progman -eq [IntPtr]::Zero) { throw "DSH_DESKTOP_PROGMAN_NOT_FOUND" }',
    '$sendResult = [IntPtr]::Zero',
    '[DshDesktopWin32]::SendMessageTimeout($progman, 0x052C, [IntPtr]::Zero, [IntPtr]::Zero, 0, 1000, [ref]$sendResult) | Out-Null',
    '$script:workerw = [IntPtr]::Zero',
    '$callback = [DshDesktopWin32+EnumWindowsProc]{ param([IntPtr]$top, [IntPtr]$state)',
    '  $shellView = [DshDesktopWin32]::FindWindowEx($top, [IntPtr]::Zero, "SHELLDLL_DefView", $null)',
    '  if ($shellView -ne [IntPtr]::Zero) {',
    '    $candidate = [DshDesktopWin32]::FindWindowEx([IntPtr]::Zero, $top, "WorkerW", $null)',
    '    if ($candidate -ne [IntPtr]::Zero) { $script:workerw = $candidate }',
    '  }',
    '  return $true',
    '}',
    '[DshDesktopWin32]::EnumWindows($callback, [IntPtr]::Zero) | Out-Null',
    'if ($script:workerw -eq [IntPtr]::Zero) { throw "DSH_DESKTOP_WORKERW_NOT_FOUND" }',
    '$GWL_STYLE = -16',
    '$WS_POPUP = [Int64]0x80000000',
    '$WS_CHILD = [Int64]0x40000000',
    '$style = [DshDesktopWin32]::GetWindowLongPtr($target, $GWL_STYLE).ToInt64()',
    '$childStyle = ($style -band (-bnot $WS_POPUP)) -bor $WS_CHILD',
    '[DshDesktopWin32]::SetWindowLongPtr($target, $GWL_STYLE, [IntPtr]::new([Int64]$childStyle)) | Out-Null',
    '[DshDesktopWin32]::SetParent($target, $script:workerw) | Out-Null',
    'if ([DshDesktopWin32]::GetParent($target) -ne $script:workerw) { throw "DSH_DESKTOP_WORKERW_ATTACH_FAILED" }',
    '$origin = New-Object DshDesktopWin32+POINT',
    '$origin.X = ' + String(bounds.x),
    '$origin.Y = ' + String(bounds.y),
    'if (-not [DshDesktopWin32]::ScreenToClient($script:workerw, [ref]$origin)) { throw "DSH_DESKTOP_WORKERW_BOUNDS_FAILED" }',
    'if (-not [DshDesktopWin32]::SetWindowPos($target, [IntPtr]::new([Int64]1), $origin.X, $origin.Y, ' + String(bounds.width) + ', ' + String(bounds.height) + ', 0x0030)) { throw "DSH_DESKTOP_WORKERW_POSITION_FAILED" }',
    '$className = New-Object System.Text.StringBuilder 128',
    '[DshDesktopWin32]::GetClassName($script:workerw, $className, $className.Capacity) | Out-Null',
    '[pscustomobject]@{ ok = $true; targetWindowId = $target.ToInt64().ToString(); parentWindowId = $script:workerw.ToInt64().ToString(); parentClassName = $className.ToString(); x = ' + String(bounds.x) + '; y = ' + String(bounds.y) + '; width = ' + String(bounds.width) + '; height = ' + String(bounds.height) + ' } | ConvertTo-Json -Compress',
  ].join('\n')
  return desktopPowerShellScript(body)
}

/** Detach a WorkerW-attached window back to a top-level popup. */
export function workerWDetachScript(input: { hwnd: string } & DesktopBounds): string {
  const hwnd = input.hwnd
  if (!/^\d+$/.test(hwnd)) throw new Error('DSH_DESKTOP_NATIVE_HANDLE_INVALID')
  const bounds = normalizeBounds(input, { x: 0, y: 0, width: 1280, height: 720 })
  const body = [
    '$target = [IntPtr]::new([Int64]' + hwnd + ')',
    'if (-not [DshDesktopWin32]::IsWindow($target)) { throw "DSH_DESKTOP_TARGET_NOT_FOUND" }',
    '[DshDesktopWin32]::SetParent($target, [IntPtr]::Zero) | Out-Null',
    '$GWL_STYLE = -16',
    '$WS_POPUP = [Int64]0x80000000',
    '$WS_CHILD = [Int64]0x40000000',
    '$style = [DshDesktopWin32]::GetWindowLongPtr($target, $GWL_STYLE).ToInt64()',
    '$topStyle = ($style -band (-bnot $WS_CHILD)) -bor $WS_POPUP',
    '[DshDesktopWin32]::SetWindowLongPtr($target, $GWL_STYLE, [IntPtr]::new([Int64]$topStyle)) | Out-Null',
    'if (-not [DshDesktopWin32]::SetWindowPos($target, [IntPtr]::Zero, ' + String(bounds.x) + ', ' + String(bounds.y) + ', ' + String(bounds.width) + ', ' + String(bounds.height) + ', 0x0030)) { throw "DSH_DESKTOP_DETACH_POSITION_FAILED" }',
    '[pscustomobject]@{ ok = $true; targetWindowId = $target.ToInt64().ToString(); parentWindowId = "0"; parentClassName = ""; child = $false; popup = $true; x = ' + String(bounds.x) + '; y = ' + String(bounds.y) + '; width = ' + String(bounds.width) + '; height = ' + String(bounds.height) + ' } | ConvertTo-Json -Compress',
  ].join('\n')
  return desktopPowerShellScript(body)
}

/**
 * Park a Wallpaper Engine playback window off the virtual screen. The window
 * keeps rendering (the renderer still captures it through desktopCapturer)
 * but is moved to the 1px strip past the virtual desktop's bottom-right
 * corner, so it never covers the user's work. The expected title and
 * executable are validated before any move so a stray window with the same
 * handle cannot be relocated.
 */
export function windowParkScript(input: { sourceId: string; title: string; executable: string }): string {
  const sourceId = textOf(input.sourceId)
  const title = textOf(input.title)
  const executable = textOf(input.executable)
  if (!/^window:\d+:\d+$/.test(sourceId)) throw new Error('DSH_DESKTOP_WINDOW_SOURCE_INVALID')
  if (title === '') throw new Error('DSH_DESKTOP_WINDOW_TITLE_INVALID')
  if (executable === '') throw new Error('DSH_DESKTOP_WINDOW_EXECUTABLE_INVALID')
  const body = [
    '$target = [DshDesktopWin32]::ParseWindowHandle("' + sourceId.replace(/"/g, '') + '")',
    'if ($target -eq [IntPtr]::Zero) { throw "DSH_DESKTOP_WINDOW_SOURCE_INVALID" }',
    'if (-not [DshDesktopWin32]::IsWindow($target)) { throw "DSH_DESKTOP_WINDOW_MISSING" }',
    'if (-not [string]::Equals([DshDesktopWin32]::WindowTitle($target), "' + title.replace(/"/g, '""') + '", [StringComparison]::Ordinal)) { throw "DSH_DESKTOP_WINDOW_TITLE_MISMATCH" }',
    '$processId = [DshDesktopWin32]::WindowProcessId($target)',
    'if ($processId -eq 0) { throw "DSH_DESKTOP_WINDOW_PROCESS_UNAVAILABLE" }',
    '$actualExe = [DshDesktopWin32]::ProcessExecutable($processId)',
    'if ([string]::IsNullOrWhiteSpace($actualExe)) { throw "DSH_DESKTOP_WINDOW_PROCESS_UNAVAILABLE" }',
    'if (-not [string]::Equals($actualExe, "' + executable.replace(/"/g, '""') + '", [StringComparison]::OrdinalIgnoreCase)) { throw "DSH_DESKTOP_WINDOW_PROCESS_MISMATCH" }',
    '$rect = New-Object DshDesktopWin32+RECT',
    'if (-not [DshDesktopWin32]::GetWindowRect($target, [ref]$rect)) { throw "DSH_DESKTOP_WINDOW_BOUNDS_FAILED" }',
    '$width = [Math]::Max(1, $rect.Right - $rect.Left)',
    '$height = [Math]::Max(1, $rect.Bottom - $rect.Top)',
    '$virtualLeft = [DshDesktopWin32]::GetSystemMetrics(76)',
    '$virtualTop = [DshDesktopWin32]::GetSystemMetrics(77)',
    '$virtualWidth = [DshDesktopWin32]::GetSystemMetrics(78)',
    '$virtualHeight = [DshDesktopWin32]::GetSystemMetrics(79)',
    '$parkX = $virtualLeft + $virtualWidth - 1',
    '$parkY = $virtualTop + $virtualHeight - 1',
    'if (-not [DshDesktopWin32]::SetWindowPos($target, [IntPtr]::Zero, $parkX, $parkY, $width, $height, 0x0414)) { throw "DSH_DESKTOP_WINDOW_PARK_FAILED" }',
    '$after = New-Object DshDesktopWin32+RECT',
    '[DshDesktopWin32]::GetWindowRect($target, [ref]$after) | Out-Null',
    '$visibleWidth = [Math]::Max(0, [Math]::Min($after.Right, $virtualLeft + $virtualWidth) - [Math]::Max($after.Left, $virtualLeft))',
    '$visibleHeight = [Math]::Max(0, [Math]::Min($after.Bottom, $virtualTop + $virtualHeight) - [Math]::Max($after.Top, $virtualTop))',
    '$parked = ($visibleWidth -le 1 -and $visibleHeight -le 1)',
    'if (-not $parked) { throw "DSH_DESKTOP_WINDOW_PARK_UNVERIFIED" }',
    '[pscustomobject]@{ ok = $true; parked = $true; sourceId = "' + sourceId + '"; targetWindowId = $target.ToInt64().ToString(); x = $after.Left; y = $after.Top; width = $width; height = $height } | ConvertTo-Json -Compress',
  ].join('\n')
  return desktopPowerShellScript(body)
}

/** Find Explorer's desktop icon host (top-level window -> SHELLDLL_DefView -> SysListView32). */
export function desktopIconHostScript(): string {
  const body = [
    '$iconHost = [IntPtr]::Zero',
    '$defView = [IntPtr]::Zero',
    '$listView = [IntPtr]::Zero',
    '$hostClass = ""',
    '$callback = [DshDesktopWin32+EnumWindowsProc]{ param([IntPtr]$top, [IntPtr]$state)',
    '  $view = [DshDesktopWin32]::FindWindowEx($top, [IntPtr]::Zero, "SHELLDLL_DefView", $null)',
    '  if ($view -eq [IntPtr]::Zero) { return $true }',
    '  $list = [DshDesktopWin32]::FindWindowEx($view, [IntPtr]::Zero, "SysListView32", $null)',
    '  if ($list -eq [IntPtr]::Zero) { return $true }',
    '  $className = New-Object System.Text.StringBuilder 128',
    '  [DshDesktopWin32]::GetClassName($top, $className, $className.Capacity) | Out-Null',
    '  $script:iconHost = $top; $script:defView = $view; $script:listView = $list; $script:hostClass = $className.ToString()',
    '  return $false',
    '}',
    '[DshDesktopWin32]::EnumWindows($callback, [IntPtr]::Zero) | Out-Null',
    'if ($script:defView -eq [IntPtr]::Zero -or $script:listView -eq [IntPtr]::Zero) { throw "DSH_DESKTOP_ICON_HOST_NOT_FOUND" }',
    '[pscustomobject]@{ ok = $true; topLevelHostWindowId = $script:iconHost.ToInt64().ToString(); desktopViewWindowId = $script:defView.ToInt64().ToString(); desktopListWindowId = $script:listView.ToInt64().ToString(); hostClassName = $script:hostClass; listVisible = [DshDesktopWin32]::IsWindowVisible($script:listView) } | ConvertTo-Json -Compress',
  ].join('\n')
  return desktopPowerShellScript(body)
}

/** Reparent a window into Explorer's SHELLDLL_DefView and position it over the desktop. */
export function desktopIconHostAttachScript(input: { hwnd: string } & DesktopBounds): string {
  const hwnd = input.hwnd
  if (!/^\d+$/.test(hwnd)) throw new Error('DSH_DESKTOP_NATIVE_HANDLE_INVALID')
  const bounds = normalizeBounds(input, { x: 0, y: 0, width: 1, height: 1 })
  const body = [
    '$target = [IntPtr]::new([Int64]' + hwnd + ')',
    'if (-not [DshDesktopWin32]::IsWindow($target)) { throw "DSH_DESKTOP_TARGET_NOT_FOUND" }',
    '$iconHost = [IntPtr]::Zero',
    '$defView = [IntPtr]::Zero',
    '$listView = [IntPtr]::Zero',
    '$callback = [DshDesktopWin32+EnumWindowsProc]{ param([IntPtr]$top, [IntPtr]$state)',
    '  $view = [DshDesktopWin32]::FindWindowEx($top, [IntPtr]::Zero, "SHELLDLL_DefView", $null)',
    '  if ($view -eq [IntPtr]::Zero) { return $true }',
    '  $list = [DshDesktopWin32]::FindWindowEx($view, [IntPtr]::Zero, "SysListView32", $null)',
    '  if ($list -eq [IntPtr]::Zero) { return $true }',
    '  $script:iconHost = $top; $script:defView = $view; $script:listView = $list',
    '  return $false',
    '}',
    '[DshDesktopWin32]::EnumWindows($callback, [IntPtr]::Zero) | Out-Null',
    'if ($script:defView -eq [IntPtr]::Zero -or $script:listView -eq [IntPtr]::Zero) { throw "DSH_DESKTOP_ICON_HOST_NOT_FOUND" }',
    '$parentRect = New-Object DshDesktopWin32+RECT',
    'if (-not [DshDesktopWin32]::GetWindowRect($script:defView, [ref]$parentRect)) { throw "DSH_DESKTOP_ICON_HOST_BOUNDS_FAILED" }',
    '$GWL_STYLE = -16',
    '$WS_POPUP = [Int64]0x80000000',
    '$WS_CHILD = [Int64]0x40000000',
    '$style = [DshDesktopWin32]::GetWindowLongPtr($target, $GWL_STYLE).ToInt64()',
    '$childStyle = ($style -band (-bnot $WS_POPUP)) -bor $WS_CHILD',
    '[DshDesktopWin32]::SetWindowLongPtr($target, $GWL_STYLE, [IntPtr]::new([Int64]$childStyle)) | Out-Null',
    '[DshDesktopWin32]::SetParent($target, $script:defView) | Out-Null',
    'if ([DshDesktopWin32]::GetParent($target) -ne $script:defView) { throw "DSH_DESKTOP_ICON_HOST_ATTACH_FAILED" }',
    '$localX = ' + String(bounds.x) + ' - $parentRect.Left',
    '$localY = ' + String(bounds.y) + ' - $parentRect.Top',
    'if (-not [DshDesktopWin32]::SetWindowPos($target, [IntPtr]::new([Int64]1), $localX, $localY, ' + String(bounds.width) + ', ' + String(bounds.height) + ', 0x0030)) { throw "DSH_DESKTOP_ICON_HOST_POSITION_FAILED" }',
    '[pscustomobject]@{ ok = $true; targetWindowId = $target.ToInt64().ToString(); parentWindowId = $script:defView.ToInt64().ToString(); parentClassName = "SHELLDLL_DefView"; topLevelHostWindowId = $script:iconHost.ToInt64().ToString(); desktopViewWindowId = $script:defView.ToInt64().ToString(); desktopListWindowId = $script:listView.ToInt64().ToString(); child = $true; popup = $false } | ConvertTo-Json -Compress',
  ].join('\n')
  return desktopPowerShellScript(body)
}

/** Show or hide Explorer's desktop icon list (SysListView32). */
export function desktopIconsVisibleScript(visible: boolean): string {
  const command = visible ? '5' : '0'
  const body = [
    '$iconHost = [IntPtr]::Zero',
    '$defView = [IntPtr]::Zero',
    '$listView = [IntPtr]::Zero',
    '$callback = [DshDesktopWin32+EnumWindowsProc]{ param([IntPtr]$top, [IntPtr]$state)',
    '  $view = [DshDesktopWin32]::FindWindowEx($top, [IntPtr]::Zero, "SHELLDLL_DefView", $null)',
    '  if ($view -eq [IntPtr]::Zero) { return $true }',
    '  $list = [DshDesktopWin32]::FindWindowEx($view, [IntPtr]::Zero, "SysListView32", $null)',
    '  if ($list -eq [IntPtr]::Zero) { return $true }',
    '  $script:iconHost = $top; $script:defView = $view; $script:listView = $list',
    '  return $false',
    '}',
    '[DshDesktopWin32]::EnumWindows($callback, [IntPtr]::Zero) | Out-Null',
    'if ($script:defView -eq [IntPtr]::Zero -or $script:listView -eq [IntPtr]::Zero) { throw "DSH_DESKTOP_ICON_HOST_NOT_FOUND" }',
    'if (-not [DshDesktopWin32]::ShowWindow($script:listView, ' + command + ')) { throw "DSH_DESKTOP_ICON_VISIBILITY_FAILED" }',
    '[pscustomobject]@{ ok = $true; desktopListWindowId = $script:listView.ToInt64().ToString(); visible = [DshDesktopWin32]::IsWindowVisible($script:listView) } | ConvertTo-Json -Compress',
  ].join('\n')
  return desktopPowerShellScript(body)
}

/** Parse the last JSON line of native PowerShell stdout. */
function parseJsonLine(stdout: string): Record<string, unknown> {
  const lines = (stdout || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean)
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      const value: unknown = JSON.parse(lines[index] ?? '')
      if (value !== null && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>
    } catch {
      // keep scanning backwards
    }
  }
  throw new Error('DSH_DESKTOP_NATIVE_ACK_INVALID')
}

function nativeErrorCode(error: Error | null, stderr: string, fallback: string): string {
  const detail = stderr || error?.message || fallback
  const match = /DSH_DESKTOP_[A-Z0-9_]+/.exec(detail)
  if (match?.[0] !== undefined) return match[0]
  return fallback
}

/** Run one generated PowerShell script and resolve its JSON ack. */
export function runDesktopNativeScript(
  script: string,
  options: NativeExecOptions & { timeoutMs?: number } = {},
): Promise<Record<string, unknown>> {
  const execFileImpl = options.execFileImpl ?? execFile
  const timeoutMs = Math.max(1000, Math.min(20_000, Number(options.timeoutMs) || 8000))
  return new Promise((resolvePromise, reject) => {
    execFileImpl('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: timeoutMs,
      maxBuffer: 256 * 1024,
      env: options.nativeTempPath !== undefined
        ? { ...process.env, TEMP: options.nativeTempPath, TMP: options.nativeTempPath }
        : process.env,
    }, (error, stdout, stderr) => {
      if (error !== null) {
        const code = nativeErrorCode(error, stderr || '', 'DSH_DESKTOP_NATIVE_SCRIPT_FAILED')
        reject(new Error(code))
        return
      }
      try {
        resolvePromise(parseJsonLine(stdout || ''))
      } catch (parseError) {
        reject(parseError instanceof Error ? parseError : new Error('DSH_DESKTOP_NATIVE_ACK_INVALID'))
      }
    })
  })
}

/** Bounds of the primary display in DIPs and physical pixels. */
function primaryDisplayBounds(screen: Screen): { bounds: DesktopBounds; physicalBounds: DesktopBounds } {
  const display = screen.getPrimaryDisplay()
  const bounds = normalizeBounds(display.bounds, { x: 0, y: 0, width: 1920, height: 1080 })
  let physicalBounds = bounds
  if (typeof screen.dipToScreenRect === 'function') {
    try {
      const converted = screen.dipToScreenRect(null, bounds) as DesktopBounds | null
      if (converted !== null) physicalBounds = normalizeBounds(converted, bounds)
    } catch {
      // keep DIP bounds
    }
  }
  return { bounds, physicalBounds }
}

/** Render the wallpaper window page for one media URL. */
function wallpaperDataUrl(url: string, kind: 'image' | 'video'): string {
  const html = [
    '<!doctype html><html><head><meta charset="utf-8"><style>',
    'html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#050608}',
    'img,video{position:absolute;inset:0;width:100%;height:100%}',
    'img{object-fit:cover}video{object-fit:cover}',
    '</style></head><body>',
    kind === 'video'
      ? '<video id="media" autoplay muted loop playsinline src="' + url + '"></video>'
      : '<img id="media" alt="" src="' + url + '">',
    '</body></html>',
  ].join('')
  return 'data:text/html;charset=utf-8,' + encodeURIComponent(html)
}

export interface DesktopWallpaperStatus {
  ok: boolean
  supported: boolean
  enabled: boolean
  active: boolean
  windowId: number | null
  nativeWindowId: string
  parentWindowId: string
  parentClassName: string
  bounds: DesktopBounds | null
  error: string
}

/** A frameless wallpaper window embedded into WorkerW behind desktop icons. */
export class DesktopWallpaperRuntime {
  private readonly BrowserWindowClass: typeof BrowserWindow
  private readonly screen: Screen
  private readonly nativeOptions: NativeExecOptions
  private window: BrowserWindow | null = null
  private attachment: WorkerWAttachment | null = null
  private enabled = false
  private error = ''

  constructor(options: { BrowserWindow: typeof BrowserWindow; screen: Screen } & NativeExecOptions) {
    this.BrowserWindowClass = options.BrowserWindow
    this.screen = options.screen
    this.nativeOptions = { execFileImpl: options.execFileImpl, nativeTempPath: options.nativeTempPath }
  }

  isSupported(): boolean {
    return process.platform === 'win32'
  }

  getStatus(): DesktopWallpaperStatus {
    return {
      ok: this.error === '',
      supported: this.isSupported(),
      enabled: this.enabled,
      active: this.enabled && this.window !== null && !this.window.isDestroyed() && this.attachment !== null,
      windowId: this.window !== null && !this.window.isDestroyed() ? this.window.id : null,
      nativeWindowId: this.attachment?.targetWindowId ?? '',
      parentWindowId: this.attachment?.parentWindowId ?? '',
      parentClassName: this.attachment?.parentClassName ?? '',
      bounds: this.attachment !== null
        ? { x: this.attachment.x, y: this.attachment.y, width: this.attachment.width, height: this.attachment.height }
        : null,
      error: this.error,
    }
  }

  private async attach(win: BrowserWindow): Promise<WorkerWAttachment> {
    const { physicalBounds } = primaryDisplayBounds(this.screen)
    const ack = await runDesktopNativeScript(workerWAttachScript({
      hwnd: nativeWindowHandleDecimal(win),
      ...physicalBounds,
    }), this.nativeOptions)
    if (ack.ok !== true || !/^\d+$/.test(textOf(ack.parentWindowId))) {
      throw new Error('DSH_DESKTOP_WORKERW_ACK_INVALID')
    }
    return {
      targetWindowId: textOf(ack.targetWindowId),
      parentWindowId: textOf(ack.parentWindowId),
      parentClassName: textOf(ack.parentClassName),
      x: Number(ack.x) || 0,
      y: Number(ack.y) || 0,
      width: Math.max(1, Number(ack.width) || 1),
      height: Math.max(1, Number(ack.height) || 1),
    }
  }

  async start(url: string, kind: 'image' | 'video'): Promise<DesktopWallpaperStatus> {
    if (!this.isSupported()) {
      this.error = 'DSH_DESKTOP_PLATFORM_UNSUPPORTED'
      return this.getStatus()
    }
    if (this.window !== null && !this.window.isDestroyed()) await this.stop()
    const { bounds } = primaryDisplayBounds(this.screen)
    const win = new this.BrowserWindowClass({
      ...bounds,
      frame: false,
      transparent: false,
      backgroundColor: '#050608',
      hasShadow: false,
      resizable: false,
      movable: false,
      focusable: false,
      skipTaskbar: true,
      show: false,
      title: 'DSH Desktop Wallpaper',
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false },
    })
    this.window = win
    win.setIgnoreMouseEvents(true)
    try {
      await win.loadURL(wallpaperDataUrl(url, kind))
      this.attachment = await this.attach(win)
      this.enabled = true
      this.error = ''
      win.showInactive()
      return this.getStatus()
    } catch (cause) {
      this.enabled = false
      this.attachment = null
      this.error = cause instanceof Error ? cause.message : 'DSH_DESKTOP_WALLPAPER_START_FAILED'
      if (!win.isDestroyed()) win.destroy()
      this.window = null
      return this.getStatus()
    }
  }

  async update(url: string, kind: 'image' | 'video'): Promise<DesktopWallpaperStatus> {
    const win = this.window
    if (win === null || win.isDestroyed()) return this.start(url, kind)
    try {
      await win.loadURL(wallpaperDataUrl(url, kind))
      this.error = ''
    } catch (cause) {
      this.error = cause instanceof Error ? cause.message : 'DSH_DESKTOP_WALLPAPER_UPDATE_FAILED'
    }
    return this.getStatus()
  }

  async stop(): Promise<DesktopWallpaperStatus> {
    const win = this.window
    this.enabled = false
    if (win !== null && !win.isDestroyed() && this.attachment !== null) {
      try {
        await runDesktopNativeScript(workerWDetachScript({
          hwnd: this.attachment.targetWindowId,
          x: this.attachment.x,
          y: this.attachment.y,
          width: this.attachment.width,
          height: this.attachment.height,
        }), this.nativeOptions)
      } catch {
        // The Explorer host may already be gone; destroying the window is enough.
      }
    }
    this.attachment = null
    if (win !== null && !win.isDestroyed()) win.destroy()
    this.window = null
    this.error = ''
    return this.getStatus()
  }

  async dispose(): Promise<void> {
    await this.stop()
  }
}

export interface DesktopModeStatus {
  ok: boolean
  supported: boolean
  enabled: boolean
  interactive: boolean
  attached: boolean
  windowId: number | null
  nativeWindowId: string
  parentWindowId: string
  parentClassName: string
  topLevelHostWindowId: string
  desktopViewWindowId: string
  desktopListWindowId: string
  desktopIconsVisible: boolean
  softwareInteractionLocked: boolean
  ignoreMouseEvents: boolean
  pointerRoute: { overSoftwareUi: boolean; overDesktopControls: boolean }
  error: string
  reason: string
}

/** Embeds the main window into Explorer's desktop icon host and manages desktop-icon controls. */
export class DesktopModeRuntime {
  private readonly screen: Screen
  private readonly nativeOptions: NativeExecOptions
  private window: BrowserWindow | null = null
  private snapshot: DesktopWindowSnapshot | null = null
  private attachment: DesktopIconHostAck | null = null
  private enabled = false
  private interactive = true
  private softwareInteractionLocked = false
  private desktopIconsVisible = true
  private pointerRoute = { overSoftwareUi: false, overDesktopControls: false }
  private error = ''
  private reason = ''
  private listeners = new Set<(status: DesktopModeStatus) => void>()

  constructor(options: { screen: Screen } & NativeExecOptions) {
    this.screen = options.screen
    this.nativeOptions = { execFileImpl: options.execFileImpl, nativeTempPath: options.nativeTempPath }
  }

  isSupported(): boolean {
    return process.platform === 'win32'
  }

  onStatus(listener: (status: DesktopModeStatus) => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  getStatus(reason = this.reason): DesktopModeStatus {
    const win = this.window
    const alive = win !== null && !win.isDestroyed()
    return {
      ok: this.error === '',
      supported: this.isSupported(),
      enabled: this.enabled,
      interactive: this.enabled && this.interactive,
      attached: this.enabled && alive && this.attachment !== null,
      windowId: alive ? win.id : null,
      nativeWindowId: this.attachment?.targetWindowId ?? '',
      parentWindowId: this.attachment?.parentWindowId ?? '',
      parentClassName: this.attachment?.parentClassName ?? '',
      topLevelHostWindowId: this.attachment?.topLevelHostWindowId ?? '',
      desktopViewWindowId: this.attachment?.desktopViewWindowId ?? '',
      desktopListWindowId: this.attachment?.desktopListWindowId ?? '',
      desktopIconsVisible: this.desktopIconsVisible,
      softwareInteractionLocked: this.softwareInteractionLocked,
      ignoreMouseEvents: this.softwareInteractionLocked
        || (this.enabled && this.pointerRoute.overDesktopControls && !this.pointerRoute.overSoftwareUi),
      pointerRoute: { ...this.pointerRoute },
      error: this.error,
      reason,
    }
  }

  private emitStatus(reason: string): DesktopModeStatus {
    const status = this.getStatus(reason)
    for (const listener of this.listeners) listener(status)
    return status
  }

  private capture(win: BrowserWindow): DesktopWindowSnapshot {
    const bounds = win.getBounds()
    const minimum = win.getMinimumSize()
    const maximum = win.getMaximumSize()
    const minimumWidth = minimum[0] ?? 0
    const minimumHeight = minimum[1] ?? 0
    const maximumWidth = maximum[0] ?? 0
    const maximumHeight = maximum[1] ?? 0
    return {
      bounds: normalizeBounds(bounds, { x: 0, y: 0, width: 1440, height: 900 }),
      maximized: win.isMaximized(),
      fullScreen: win.isFullScreen(),
      minimized: win.isMinimized(),
      resizable: win.isResizable(),
      movable: win.isMovable(),
      focusable: win.isFocusable(),
      hasShadow: win.hasShadow(),
      minimumSize: minimumWidth > 0 || minimumHeight > 0 ? [minimumWidth, minimumHeight] : null,
      maximumSize: maximumWidth > 0 || maximumHeight > 0 ? [maximumWidth, maximumHeight] : null,
    }
  }

  private restore(win: BrowserWindow, snapshot: DesktopWindowSnapshot): void {
    win.setResizable(snapshot.resizable)
    win.setMovable(snapshot.movable)
    win.setFocusable(snapshot.focusable)
    win.setHasShadow(snapshot.hasShadow)
    win.setMinimumSize(snapshot.minimumSize?.[0] ?? 0, snapshot.minimumSize?.[1] ?? 0)
    win.setMaximumSize(snapshot.maximumSize?.[0] ?? 0, snapshot.maximumSize?.[1] ?? 0)
    win.setBounds(snapshot.bounds)
    if (snapshot.maximized) win.maximize()
    if (snapshot.minimized) win.minimize()
  }

  async enable(win: BrowserWindow, options: { interactive?: boolean; reason?: string } = {}): Promise<DesktopModeStatus> {
    if (!this.isSupported()) {
      this.error = 'DSH_DESKTOP_PLATFORM_UNSUPPORTED'
      return this.emitStatus('enable-failed')
    }
    if (this.enabled && this.window === win) {
      this.interactive = options.interactive !== false
      this.error = ''
      return this.emitStatus('enabled')
    }
    if (this.enabled) await this.disable('replaced')
    this.window = win
    this.snapshot = this.capture(win)
    const { physicalBounds } = primaryDisplayBounds(this.screen)
    try {
      const ack = await runDesktopNativeScript(desktopIconHostAttachScript({
        hwnd: nativeWindowHandleDecimal(win),
        ...physicalBounds,
      }), this.nativeOptions)
      if (ack.ok !== true || !/^\d+$/.test(textOf(ack.parentWindowId))) throw new Error('DSH_DESKTOP_ICON_HOST_ACK_INVALID')
      this.attachment = {
        targetWindowId: textOf(ack.targetWindowId),
        parentWindowId: textOf(ack.parentWindowId),
        parentClassName: textOf(ack.parentClassName),
        topLevelHostWindowId: textOf(ack.topLevelHostWindowId),
        desktopViewWindowId: textOf(ack.desktopViewWindowId),
        desktopListWindowId: textOf(ack.desktopListWindowId),
        child: ack.child === true,
        popup: ack.popup === true,
      }
      this.enabled = true
      this.interactive = options.interactive !== false
      this.error = ''
      this.reason = options.reason ?? 'renderer-enabled'
      if (win.isMinimized()) win.restore()
      win.showInactive()
      return this.emitStatus('enabled')
    } catch (cause) {
      this.enabled = false
      this.attachment = null
      this.error = cause instanceof Error ? cause.message : 'DSH_DESKTOP_ICON_HOST_ATTACH_FAILED'
      this.emitStatus('enable-failed')
      return this.getStatus('enable-failed')
    }
  }

  async disable(reason = 'renderer-disabled'): Promise<DesktopModeStatus> {
    const win = this.window
    if (!this.enabled && this.attachment === null) return this.getStatus(reason)
    if (win !== null && !win.isDestroyed() && this.attachment !== null) {
      const snapshot = this.snapshot ?? {
        bounds: { x: 0, y: 0, width: 1440, height: 900 },
        maximized: false,
        fullScreen: false,
        minimized: false,
        resizable: true,
        movable: true,
        focusable: true,
        hasShadow: true,
        minimumSize: null,
        maximumSize: null,
      }
      try {
        await runDesktopNativeScript(workerWDetachScript({
          hwnd: this.attachment.targetWindowId,
          ...snapshot.bounds,
        }), this.nativeOptions)
      } catch {
        this.error = 'DSH_DESKTOP_DETACH_FAILED'
      }
      this.restore(win, snapshot)
    }
    this.enabled = false
    this.interactive = true
    this.attachment = null
    this.window = null
    this.reason = reason
    if (win !== null && !win.isDestroyed() && !win.isVisible()) win.show()
    return this.emitStatus(reason)
  }

  async setDesktopIconsVisible(visible: boolean): Promise<{ ok: boolean; visible: boolean; error: string }> {
    try {
      const ack = await runDesktopNativeScript(desktopIconsVisibleScript(visible), this.nativeOptions)
      this.desktopIconsVisible = ack.visible === true
      this.error = ''
      this.emitStatus('desktop-icons-visible')
      return { ok: true, visible: this.desktopIconsVisible, error: '' }
    } catch (cause) {
      this.error = cause instanceof Error ? cause.message : 'DSH_DESKTOP_ICON_VISIBILITY_FAILED'
      return { ok: false, visible: this.desktopIconsVisible, error: this.error }
    }
  }

  async probeDesktopIcons(): Promise<{ ok: boolean; found: boolean; visible: boolean; desktopListWindowId: string; error: string }> {
    try {
      const ack = await runDesktopNativeScript(desktopIconHostScript(), this.nativeOptions)
      const visible = ack.listVisible === true
      this.desktopIconsVisible = visible
      this.error = ''
      return { ok: true, found: true, visible, desktopListWindowId: textOf(ack.desktopListWindowId), error: '' }
    } catch (cause) {
      this.error = cause instanceof Error ? cause.message : 'DSH_DESKTOP_ICON_HOST_NOT_FOUND'
      return { ok: false, found: false, visible: this.desktopIconsVisible, desktopListWindowId: '', error: this.error }
    }
  }

  setSoftwareInteractionLocked(locked: boolean): DesktopModeStatus {
    this.softwareInteractionLocked = locked
    const win = this.window
    if (win !== null && !win.isDestroyed() && typeof win.setIgnoreMouseEvents === 'function') {
      win.setIgnoreMouseEvents(locked)
    }
    return this.emitStatus(locked ? 'software-locked' : 'software-unlocked')
  }

  updatePointerRoute(payload: { overSoftwareUi?: boolean; overDesktopControls?: boolean }): DesktopModeStatus {
    this.pointerRoute = {
      overSoftwareUi: payload.overSoftwareUi === true,
      overDesktopControls: payload.overDesktopControls === true,
    }
    const win = this.window
    if (this.enabled && win !== null && !win.isDestroyed() && typeof win.setIgnoreMouseEvents === 'function') {
      const ignoreMouse = this.softwareInteractionLocked
        || (this.pointerRoute.overDesktopControls && !this.pointerRoute.overSoftwareUi)
      win.setIgnoreMouseEvents(ignoreMouse)
    }
    return this.getStatus('pointer-route')
  }

  requestKeyboardFocus(): { ok: boolean; focused: boolean } {
    const win = this.window
    if (!this.enabled || win === null || win.isDestroyed()) return { ok: false, focused: false }
    win.focus()
    return { ok: true, focused: win.isFocused() }
  }

  async dispose(): Promise<void> {
    if (this.enabled) await this.disable('dispose')
    this.listeners.clear()
  }
}
