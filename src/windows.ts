import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { access } from 'node:fs/promises';
import type { Candidate } from './shared';
const exec = promisify(execFile);
const powershell = () => path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
async function query(script: string): Promise<string> {
  const { stdout } = await exec(powershell(), ['-NoProfile', '-NonInteractive', '-Command', `$ErrorActionPreference='Stop'; [Console]::OutputEncoding=[System.Text.Encoding]::UTF8; ${script}`], { windowsHide: true, timeout: 30000, maxBuffer: 1024 * 1024 });
  return stdout.replace(/^\uFEFF/, '').trim();
}
export function assertWindows(): void {
  if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('修复和启动仅支持 Windows x64。当前系统可以预览界面。');
}
export async function assertCodexStopped(): Promise<void> {
  assertWindows();
  const output = await query(`@(Get-CimInstance Win32_Process -Filter "Name='Codex.exe' OR Name='ChatGPT.exe'") | Select-Object Name,ProcessId | ConvertTo-Json -Compress`);
  if (output && output !== '[]') throw new Error('请先完全退出 Codex / ChatGPT（包括托盘和命令行进程），再继续操作。不会自动结束你的任务。');
}
export async function discover(): Promise<Candidate[]> {
  if (process.platform !== 'win32') return [];
  const candidates: Candidate[] = [];
  try {
    const output = await query(`@(Get-AppxPackage | Where-Object { $_.Name -match '^OpenAI\..*(Codex|ChatGPT)' } | Select-Object Name,InstallLocation) | ConvertTo-Json -Compress`);
    const parsed = output ? JSON.parse(output) : [];
    for (const item of Array.isArray(parsed) ? parsed : [parsed]) if (item.InstallLocation) candidates.push({ path: path.join(item.InstallLocation, 'app'), label: `${item.Name} · Microsoft Store` });
  } catch { /* Store discovery is optional; directory selection always remains available. */ }
  for (const base of [process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs'), process.env.ProgramFiles]) {
    if (base) for (const name of ['Codex', 'ChatGPT']) candidates.push({ path: path.join(base, name), label: `${name} · 本地安装` });
  }
  const found: Candidate[] = [];
  for (const candidate of candidates) {
    try { await access(path.join(candidate.path, 'resources', 'app.asar')); found.push(candidate); } catch { /* absent */ }
  }
  return found.filter((item, i) => found.findIndex(other => other.path.toLowerCase() === item.path.toLowerCase()) === i);
}
