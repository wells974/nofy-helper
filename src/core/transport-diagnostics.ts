import { open, readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import type { RuntimeCheck } from '../shared';

import { queryPowerShell } from '../powershell';
const hostName = 'com.openai.codexextension';
export type RegistryProbe = () => Promise<string | undefined>;
const readChromeRegistration: RegistryProbe = async () => {
  if (process.platform !== 'win32') return;
  // Read the unnamed value through the API, avoiding localized '(Default)' output.
  const stdout = await queryPowerShell(
    `$keyPath='HKCU:\\Software\\Google\\Chrome\\NativeMessagingHosts\\${hostName}'; if (Test-Path -LiteralPath $keyPath) { (Get-Item -LiteralPath $keyPath).GetValue('') }`,
    { timeout: 10000, maxBuffer: 8192 });
  return stdout.trim() || undefined;
};
async function jsonFile(file: string): Promise<any> {
  if ((await stat(file)).size > 4 * 1024 * 1024) throw new Error('diagnostic JSON too large');
  return JSON.parse((await readFile(file, 'utf8')).replace(/^\uFEFF/, ''));
}
async function isFile(file: unknown): Promise<boolean> {
  try { return typeof file === 'string' && path.isAbsolute(file) && (await stat(file)).isFile(); }
  catch { return false; }
}
function diagnostic(name: string, ok: boolean, detail: string): RuntimeCheck {
  return { name, ok, ...(!ok ? { warning: true } : {}), detail };
}

/** Static upstream prerequisites only; none of these checks claims a live connection. */
export async function browserTransportChecks(codexHome: string, localAppData: string | undefined,
  registry: RegistryProbe = readChromeRegistration): Promise<RuntimeCheck[]> {
  const checks: RuntimeCheck[] = [];
  if (!localAppData) return [diagnostic('Chrome Native Messaging', false, '当前平台无法检查 Windows 浏览器注册信息。')];
  let manifestPath: string | undefined;
  try {
    manifestPath = await registry();
    checks.push(diagnostic('Chrome 注册表', !!manifestPath, manifestPath ? '找到当前用户 Native Messaging 注册；继续检查所指向的清单。' : '未找到当前用户 Chrome 注册；其他注册位置或 Edge 未核验。请在 Codex 中完成浏览器扩展设置。'));
  } catch { checks.push(diagnostic('Chrome 注册表', false, '无法读取 Native Messaging 注册，未判定为缺失。')); }
  const file = manifestPath || path.join(localAppData, 'OpenAI/extension', `${hostName}.json`);
  try {
    if (!path.isAbsolute(file)) throw new Error('non-absolute manifest path');
    const manifest = await jsonFile(file);
    const valid = manifest.name === hostName && manifest.type === 'stdio' && typeof manifest.path === 'string' && manifest.path.length > 0;
    const executable = valid ? path.resolve(path.dirname(file), manifest.path) : '';
    const exists = valid && await isFile(executable);
    checks.push(diagnostic('Chrome Native Messaging', exists, exists ? '清单所指向的主机程序存在；尚未验证扩展启用状态或实际连接。' : '清单格式不受支持或主机程序不存在；Chrome 可能出现独立的连接失败。'));
  } catch { checks.push(diagnostic('Chrome Native Messaging', false, '主机清单缺失、不可读或格式不受支持；这与 Any App native pipe 是不同的检查项。')); }

  try {
    const state = await jsonFile(path.join(codexHome, 'chrome-native-hosts.json'));
    if (state.schemaVersion !== 2 || !Array.isArray(state.entries) || !state.entries.length) throw new Error('unknown host state');
    let missing = 0, unknown = 0;
    const fields = ['extensionHostPath', 'codexCliPath', 'nodePath', 'browserClientPath', 'browserServicePath', 'nodeReplPath'];
    for (const entry of state.entries) {
      if (!entry?.paths || entry.schemaVersion !== 2) { unknown++; continue; }
      for (const field of fields) {
        if (entry.paths[field] === undefined && ['browserClientPath', 'browserServicePath', 'nodeReplPath'].includes(field)) continue;
        if (!await isFile(entry.paths[field])) missing++;
      }
    }
    checks.push(diagnostic('Chrome 主机路径记录', missing === 0 && unknown === 0,
      missing || unknown ? `发现 ${missing} 个缺失或无效的文件路径、${unknown} 个无法识别的记录；可能包含历史安装，未删除或改写。` : '已记录的主机／客户端文件存在；记录归属和实际连接仍需在 Codex 内验证。'));
  } catch { checks.push(diagnostic('Chrome 主机路径记录', false, '没有可检查的 schema 2 主机记录，可能尚未完成浏览器设置或使用其他布局。')); }
  return checks;
}

export function transportLogSummary(text: string): { native?: string; browser?: string } {
  const result: { native?: string; browser?: string } = {};
  for (const line of text.split(/\r?\n/)) {
    if (/computer-use native pipe startup ready/i.test(line)) result.native = 'startup ready（历史启动成功，不代表当前 pipe 仍存活）';
    if (/computer-use native pipe startup failed/i.test(line)) result.native = /missing-helper-path/i.test(line) ? 'startup failed / missing-helper-path：原生 helper 路径缺失，请检查运行时与缓存。' : 'startup failed：桌面原生服务启动失败，需查看对应日志。';
    if (/browser_use_availability_resolved/.test(line)) {
      // Whitelist status tokens instead of exporting entire log lines or credentials.
      const reason = line.match(/(?:statsig-disabled|config-requirement-disabled|browser-pane-disabled|wsl-disabled|window-type-disabled|local-patched)/)?.[0];
      result.browser = reason ? `${reason}（桌面可用性事件，不代表扩展或页面操作已连通）` : '找到可用性事件，原因未识别；不能据此判定浏览器正常。';
    }
  }
  return result;
}

/** Read bounded recent log tails; no log content or configuration is modified. */
export async function desktopTransportChecks(localAppData: string | undefined, appData?: string): Promise<RuntimeCheck[]> {
  if (!localAppData) return [diagnostic('桌面连接日志', false, '当前平台无法读取 Windows 桌面日志。')];
  const roots = [path.join(localAppData, 'Codex/Logs'), path.join(localAppData, 'Packages/OpenAI.Codex_2p2nqsd0c76g0/LocalCache/Local/Codex/Logs'),
    ...(appData ? [path.join(appData, 'Codex/logs'), path.join(appData, 'ChatGPT/logs')] : [])];
  const files: { file: string; modified: number }[] = [];
  let budget = 3000;
  async function collect(dir: string, depth: number): Promise<void> {
    if (depth > 4 || budget-- <= 0) return;
    try {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        if (budget-- <= 0) break;
        const file = path.join(dir, entry.name);
        if (entry.isDirectory()) await collect(file, depth + 1);
        else if (entry.isFile() && /\.log$/i.test(entry.name)) {
          const info = await stat(file);
          if (info.size) files.push({ file, modified: info.mtimeMs });
        }
      }
    } catch { /* missing/inaccessible roots leave the result explicitly unknown */ }
  }
  for (const root of roots) await collect(root, 0);
  const found: Record<string, RuntimeCheck> = {};
  for (const item of files.sort((a, b) => b.modified - a.modified).slice(0, 12)) {
    try {
      const handle = await open(item.file, 'r');
      let text: string;
      try {
        const size = (await handle.stat()).size, buffer = Buffer.alloc(Math.min(size, 256 * 1024));
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, Math.max(0, size - buffer.length));
        text = buffer.subarray(0, bytesRead).toString('utf8');
      } finally { await handle.close(); }
      for (const [kind, summary] of Object.entries(transportLogSummary(text))) {
        if (!found[kind]) found[kind] = diagnostic(kind === 'native' ? 'Native pipe 最近日志' : 'Browser Use 最近日志', false,
          `${summary} 文件修改时间：${new Date(item.modified).toISOString()}；来源：${item.file}。请核对是否来自本次副本。`);
      }
    } catch { /* logs may rotate during inspection */ }
  }
  return ['native', 'browser'].map(kind => found[kind] ?? diagnostic(kind === 'native' ? 'Native pipe 最近日志' : 'Browser Use 最近日志', false,
    `最近日志中未找到对应事件；不是通过结论。发现 ${files.length} 个非空日志，读取最新 ${Math.min(files.length, 12)} 个的尾部。检查目录：${roots.join('；')}。重现后正常退出 Codex，再检查。`));
}
