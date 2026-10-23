import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

// Run in the interactive Windows session, not WSL's unrelated login session.
// The command is constant: no task data, paths or user text enter PowerShell.
const HOST_IDLE_SCRIPT = `
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
Add-Type -TypeDefinition '
using System;
using System.Runtime.InteropServices;
public static class SuperProductivityHostIdle {
  [StructLayout(LayoutKind.Sequential)]
  struct LASTINPUTINFO { public uint cbSize; public uint dwTime; }
  [DllImport("user32.dll")]
  static extern bool GetLastInputInfo(ref LASTINPUTINFO info);
  [DllImport("kernel32.dll")]
  static extern uint GetTickCount();
  public static uint ReadMilliseconds() {
    var info = new LASTINPUTINFO();
    info.cbSize = (uint)Marshal.SizeOf(info);
    if (!GetLastInputInfo(ref info))
      throw new InvalidOperationException("GetLastInputInfo failed");
    return unchecked(GetTickCount() - info.dwTime);
  }
}'
[Console]::Out.Write([SuperProductivityHostIdle]::ReadMilliseconds())
`;

const HOST_IDLE_ARGS = [
  '-NoLogo',
  '-NoProfile',
  '-NonInteractive',
  '-WindowStyle',
  'Hidden',
  '-EncodedCommand',
  Buffer.from(HOST_IDLE_SCRIPT, 'utf16le').toString('base64'),
];

export const readWindowsHostIdleTime = async (): Promise<number> => {
  const { stdout } = await execFileAsync('powershell.exe', HOST_IDLE_ARGS, {
    timeout: 5000,
    windowsHide: true,
    maxBuffer: 1024,
    encoding: 'utf8',
  });
  const value = stdout.trim();
  const milliseconds = Number(value);
  if (
    !/^\d+$/.test(value) ||
    !Number.isSafeInteger(milliseconds) ||
    milliseconds > 0xffffffff
  ) {
    throw new Error('Invalid Windows host idle duration');
  }
  return milliseconds;
};
