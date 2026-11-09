import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { readdir, stat } from './raw-fs';
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
interface DiscoveryOptions {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  query?: (script: string) => Promise<string>;
  report?: (message: string) => void;
}

// Keep each source independent: Store cmdlets can be unavailable or blocked by policy.
const storeQuery = `@(Get-AppxPackage | Where-Object { $_.Name -match 'Codex|ChatGPT' } | Select-Object Name,InstallLocation) | ConvertTo-Json -Compress`;
const registryQuery = String.raw`
$found = @();
foreach ($base in @('HKCU:\Software', 'HKLM:\Software', 'HKLM:\Software\WOW6432Node')) {
  $found += @(Get-ItemProperty -Path "$base\Microsoft\Windows\CurrentVersion\Uninstall\*" -ErrorAction SilentlyContinue |
    Where-Object { $_.DisplayName -match 'Codex|ChatGPT' -and $_.InstallLocation } |
    Select-Object @{Name='Name';Expression={$_.DisplayName}},InstallLocation);
  foreach ($exe in @('Codex.exe', 'ChatGPT.exe')) {
    $key = Get-Item -LiteralPath "$base\Microsoft\Windows\CurrentVersion\App Paths\$exe" -ErrorAction SilentlyContinue;
    if ($key) { $found += [PSCustomObject]@{Name=$exe;InstallLocation=$key.GetValue('')} }
  }
}
ConvertTo-Json -InputObject @($found) -Compress`;

export async function discover(options: DiscoveryOptions = {}): Promise<Candidate[]> {
  if ((options.platform ?? process.platform) !== 'win32') return [];
  options.report?.('开始查找 Codex / ChatGPT 安装（原始文件系统检测）…');
  const env = options.env ?? process.env;
  const runQuery = options.query ?? query;
  const candidates: Candidate[] = [];
  const sources = await Promise.allSettled([runQuery(storeQuery), runQuery(registryQuery)]);
  for (const [index, result] of sources.entries()) {
    const source = index === 0 ? 'Microsoft Store' : '注册表';
    try {
      if (result.status === 'rejected') throw result.reason;
      const parsed: unknown = result.value ? JSON.parse(result.value.replace(/^\uFEFF/, '')) : [];
      let count = 0;
      for (const item of Array.isArray(parsed) ? parsed : [parsed]) {
        if (item && typeof item.InstallLocation === 'string' && item.InstallLocation.trim()) {
          candidates.push({ path: item.InstallLocation.trim().replace(/^"(.*)"$/, '$1'), label: `${typeof item.Name === 'string' ? item.Name : 'Codex / ChatGPT'} · ${source}` });
          count++;
        }
      }
      options.report?.(`${source} 返回 ${count} 条安装位置。`);
    } catch (error) {
      options.report?.(`${source} 安装查询失败，将继续检查本地目录：${error instanceof Error ? error.message : String(error)}`);
    }
  }
  for (const base of [env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, 'Programs'), env.LOCALAPPDATA, env.ProgramFiles, env['ProgramFiles(x86)']]) {
    if (base) for (const name of ['Codex', 'ChatGPT']) candidates.push({ path: path.join(base, name), label: `${name} · 本地安装` });
  }
  // Best-effort fallback when Get-AppxPackage fails. Never change WindowsApps permissions.
  if (env.ProgramFiles) {
    const store = path.join(env.ProgramFiles, 'WindowsApps');
    for (const entry of await readdir(store, { withFileTypes: true }).catch(() => [])) {
      if (entry.isDirectory() && /codex|chatgpt/i.test(entry.name)) candidates.push({ path: path.join(store, entry.name), label: `${entry.name} · Microsoft Store` });
    }
  }
  const found: Candidate[] = [];
  const visited = new Set<string>();
  for (const candidate of candidates) {
    let root = candidate.path;
    try { if ((await stat(root)).isFile()) root = path.dirname(root); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') options.report?.(`无法读取安装位置 ${root}：${error instanceof Error ? error.message : String(error)}`);
      continue;
    }
    const key = path.normalize(root).toLowerCase();
    if (visited.has(key)) continue;
    visited.add(key);
    const versions = (await readdir(root, { withFileTypes: true }).catch(() => []))
      .filter(entry => entry.isDirectory() && /^app-\d[\w.-]*$/i.test(entry.name))
      .sort((a, b) => b.name.localeCompare(a.name, 'en', { numeric: true }))
      .map(entry => path.join(root, entry.name));
    let matched = false;
    for (const folder of [root, path.join(root, 'app'), path.join(root, 'bin'), ...versions]) {
      try {
        if (!(await stat(path.join(folder, 'resources', 'app.asar'))).isFile()) continue;
        const names = await readdir(folder);
        if (!names.some(name => /^(codex|chatgpt)\.exe$/i.test(name))) continue;
        found.push({ ...candidate, path: folder });
        options.report?.(`找到安装：${folder}`);
        matched = true;
        break;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') options.report?.(`无法检查安装资源 ${folder}：${error instanceof Error ? error.message : String(error)}`);
      }
    }
    if (!matched) options.report?.(`跳过安装位置 ${root}：未找到同时包含 resources/app.asar 和 Codex.exe / ChatGPT.exe 的目录。`);
  }
  const unique = found.filter((item, i) => found.findIndex(other => other.path.toLowerCase() === item.path.toLowerCase()) === i);
  options.report?.(`自动查找完成，找到 ${unique.length} 个安装。`);
  return unique;
}
