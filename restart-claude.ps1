# restart-claude.ps1 - kill the current Claude Code CLI session and relaunch it
# in the SAME terminal by typing the resume command into the parent shell's
# console input buffer (WriteConsoleInput). Falls back to opening a new window.
# Spawned detached (via Win32_Process.Create) by bin/lib/proc/restart.cjs so it
# survives the kill it is about to perform.
param(
  [Parameter(Mandatory = $true)][int]$ClaudePid,
  [string]$ClaudeExe = '',
  [string]$Cwd = '',
  [string]$ResumeCommand = 'claude -c',
  [int]$DelayMs = 1200,
  [int]$ShellPid = 0,
  [switch]$NoKill
)

$ErrorActionPreference = 'Stop'
$LogPath = Join-Path (Split-Path -Parent $PSScriptRoot) 'restart.log'

function Write-Log([string]$Message) {
  try {
    $line = ('[{0}] {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Message)
    Add-Content -LiteralPath $LogPath -Value $line -Encoding UTF8
  } catch {}
}

try {
  $item = Get-Item -LiteralPath $LogPath -ErrorAction SilentlyContinue
  if ($item -and $item.Length -gt 200KB) {
    Get-Content -LiteralPath $LogPath -Tail 100 | Set-Content -LiteralPath $LogPath -Encoding UTF8
  }
} catch {}

$InjectorSource = @'
using System;
using System.Runtime.InteropServices;

namespace ClaudeRestart {
  public static class ConsoleInjector {
    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern bool FreeConsole();

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern bool AttachConsole(uint dwProcessId);

    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    public static extern IntPtr CreateFileW(string lpFileName, uint dwDesiredAccess, uint dwShareMode, IntPtr lpSecurityAttributes, uint dwCreationDisposition, uint dwFlagsAndAttributes, IntPtr hTemplateFile);

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern bool CloseHandle(IntPtr hObject);

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public struct KEY_EVENT_RECORD {
      public int bKeyDown;
      public ushort wRepeatCount;
      public ushort wVirtualKeyCode;
      public ushort wVirtualScanCode;
      public char UnicodeChar;
      public uint dwControlKeyState;
    }

    [StructLayout(LayoutKind.Explicit, CharSet = CharSet.Unicode)]
    public struct INPUT_RECORD {
      [FieldOffset(0)] public ushort EventType;
      [FieldOffset(4)] public KEY_EVENT_RECORD KeyEvent;
    }

    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    public static extern bool WriteConsoleInputW(IntPtr hConsoleInput, INPUT_RECORD[] lpBuffer, uint nLength, out uint lpNumberOfEventsWritten);

    // Returns number of events written on success, or -(Win32 error) on failure.
    public static int InjectCommand(uint shellPid, string command) {
      FreeConsole();
      if (!AttachConsole(shellPid)) {
        return -Marshal.GetLastWin32Error();
      }
      IntPtr handle = CreateFileW("CONIN$", 0xC0000000, 0x00000003, IntPtr.Zero, 3, 0, IntPtr.Zero);
      if (handle == (IntPtr)(-1)) {
        int openError = Marshal.GetLastWin32Error();
        FreeConsole();
        return -openError;
      }
      string full = command + "\r";
      INPUT_RECORD[] records = new INPUT_RECORD[full.Length * 2];
      int index = 0;
      foreach (char c in full) {
        ushort vk = 0;
        if (c == '\r') { vk = 0x0D; }
        INPUT_RECORD down = new INPUT_RECORD();
        down.EventType = 1;
        down.KeyEvent.bKeyDown = 1;
        down.KeyEvent.wRepeatCount = 1;
        down.KeyEvent.wVirtualKeyCode = vk;
        down.KeyEvent.wVirtualScanCode = 0;
        down.KeyEvent.UnicodeChar = c;
        down.KeyEvent.dwControlKeyState = 0;
        records[index++] = down;
        INPUT_RECORD up = down;
        up.KeyEvent.bKeyDown = 0;
        records[index++] = up;
      }
      uint written;
      bool ok = WriteConsoleInputW(handle, records, (uint)records.Length, out written);
      int writeError = ok ? 0 : Marshal.GetLastWin32Error();
      CloseHandle(handle);
      FreeConsole();
      if (ok) { return (int)written; }
      return -writeError;
    }
  }
}
'@

function Start-FallbackWindow {
  try {
    $cmd = $ResumeCommand
    if ($Cwd) { $cmd = "Set-Location -LiteralPath '$Cwd'; $ResumeCommand" }
    Start-Process -FilePath 'powershell.exe' -ArgumentList @('-NoExit', '-NoProfile', '-Command', $cmd) | Out-Null
    Write-Log "Fallback: opened a new PowerShell window running: $ResumeCommand"
    return $true
  } catch {
    Write-Log "Fallback window failed: $($_.Exception.Message)"
    return $false
  }
}

try {
  Write-Log "Invoked: ClaudePid=$ClaudePid ShellPid=$ShellPid NoKill=$NoKill Resume='$ResumeCommand' Cwd='$Cwd'"

  $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$ClaudePid" -ErrorAction SilentlyContinue
  if (-not $proc) {
    Write-Log "Target process $ClaudePid not found; aborting."
    exit 1
  }
  if ($ClaudeExe -and $proc.ExecutablePath -and ($proc.ExecutablePath -ne $ClaudeExe)) {
    Write-Log "Refusing to kill PID ${ClaudePid}: ExecutablePath '$($proc.ExecutablePath)' does not match expected '$ClaudeExe'."
    exit 1
  }
  if ($ShellPid -le 0) { $ShellPid = [int]$proc.ParentProcessId }
  $shell = Get-CimInstance Win32_Process -Filter "ProcessId=$ShellPid" -ErrorAction SilentlyContinue
  if (-not $shell) { Write-Log "Parent shell $ShellPid not found; will use fallback window." }

  if ($DelayMs -gt 0) { Start-Sleep -Milliseconds $DelayMs }

  if (-not $NoKill) {
    # Hard kill on purpose: a graceful shutdown would let the old Claude Code
    # flush its in-memory (pre-switch) credentials back to disk.
    Stop-Process -Id $ClaudePid -Force
    $deadline = (Get-Date).AddSeconds(10)
    while ((Get-Date) -lt $deadline -and (Get-Process -Id $ClaudePid -ErrorAction SilentlyContinue)) {
      Start-Sleep -Milliseconds 100
    }
    Write-Log "Killed Claude Code PID $ClaudePid."
    Start-Sleep -Milliseconds 700
  }

  $injected = $false
  if ($shell) {
    Add-Type -TypeDefinition $InjectorSource -Language CSharp
    $result = [ClaudeRestart.ConsoleInjector]::InjectCommand([uint32]$ShellPid, $ResumeCommand)
    if ($result -gt 0) {
      Write-Log "Injected '$ResumeCommand' into console of shell PID $ShellPid ($result events)."
      $injected = $true
    } else {
      Write-Log "Console injection failed (Win32 error $(-$result))."
    }
  }
  if (-not $injected) { Start-FallbackWindow | Out-Null }
  exit 0
} catch {
  Write-Log "Error: $($_.Exception.Message)"
  Start-FallbackWindow | Out-Null
  exit 1
}
