import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, writeFile, rename, lstat, rm } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { hashFile, sha256 } from './hash';
import type { ComputerUseStatus, RuntimeCheck } from '../shared';

const exec = promisify(execFile);
export type CliRunner = (file: string, args: string[], env: NodeJS.ProcessEnv) => Promise<string>;
const runCli: CliRunner = async (file, args, env) => {
  try { return (await exec(file, args, { env, windowsHide: true, timeout: 45000, maxBuffer: 4 * 1024 * 1024 })).stdout; }
  catch { throw new Error('Codex CLI 插件命令执行失败，请确认 Codex 已退出且运行时完整。'); }
};
interface Snapshot { id: string; existed: boolean; beforeHash: string; afterHash?: string; afterExisted?: boolean; configPath: string }
const selector = 'computer-use@openai-bundled';
const required = [
  'codex.exe', 'cua_node/bin/node.exe', 'cua_node/bin/node_repl.exe',
  'cua_node/bin/node_modules/@oai/cua-repl/bin/cua-repl.mjs',
  'cua_node/bin/node_modules/@oai/sky/package.json',
  'cua_node/bin/node_modules/@oai/sky/bin/windows/codex-computer-use.exe',
  'plugins/openai-bundled/.agents/plugins/marketplace.json',
  'plugins/openai-bundled/plugins/computer-use/.codex-plugin/plugin.json',
];

/** Uses the selected copy's official CLI and packaged plugins; no downloaded scripts. */
export class ComputerUseRuntime {
  constructor(readonly root: string, readonly source: string, readonly folder: string, readonly codexHome: string,
    private readonly report: (message: string) => void = () => {}, private readonly runner: CliRunner = runCli) {}
  private get configPath() { return path.join(this.codexHome, 'config.toml'); }
  private get snapshots() { return path.join(this.folder, 'cua-config'); }
  private get env(): NodeJS.ProcessEnv { return { ...process.env, CODEX_HOME: this.codexHome, CODEX_ELECTRON_ENABLE_WINDOWS_COMPUTER_USE: '1' }; }
  private args(...args: string[]) {
    const marketplace = path.join(this.root, 'resources', 'plugins', 'openai-bundled');
    return ['-c', `marketplaces.openai-bundled.source=${JSON.stringify(marketplace)}`, '-c', 'marketplaces.openai-bundled.source_type="local"', ...args];
  }
  private async readConfig(): Promise<{ existed: boolean; bytes: Buffer }> {
    await this.checkLinks(this.codexHome);
    try {
      const info = await lstat(this.configPath);
      if (!info.isFile() || info.isSymbolicLink()) throw new Error('Codex 配置不是普通文件，停止修改。');
      return { existed: true, bytes: await readFile(this.configPath) };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { existed: false, bytes: Buffer.alloc(0) };
      throw error;
    }
  }
  private async checkLinks(file: string): Promise<void> {
    let current = path.resolve(file);
    while (true) {
      try { if ((await lstat(current)).isSymbolicLink()) throw new Error('Computer Use 路径包含符号链接或目录联接，停止操作。'); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      const parent = path.dirname(current); if (parent === current) break; current = parent;
    }
  }
  private async snapshot(): Promise<Snapshot | undefined> {
    try {
      await this.checkLinks(path.join(this.snapshots, 'active.json'));
      const value = JSON.parse(await readFile(path.join(this.snapshots, 'active.json'), 'utf8')) as Snapshot;
      if (!/^[a-f\d-]{36}$/.test(value.id) || value.configPath !== this.configPath || typeof value.existed !== 'boolean' || !/^[a-f\d]{64}$/.test(value.beforeHash) || (value.afterHash !== undefined && (!/^[a-f\d]{64}$/.test(value.afterHash) || typeof value.afterExisted !== 'boolean'))) throw new Error('Computer Use 配置备份记录损坏。');
      return value;
    } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
  }
  private async save(snapshot: Snapshot) {
    await this.checkLinks(this.snapshots);
    await mkdir(this.snapshots, { recursive: true });
    const temp = path.join(this.snapshots, `${randomUUID()}.tmp`);
    await writeFile(temp, JSON.stringify(snapshot), { flag: 'wx', mode: 0o600 });
    await rename(temp, path.join(this.snapshots, 'active.json'));
  }
  async status(): Promise<ComputerUseStatus> {
    const checks: RuntimeCheck[] = [];
    for (const relative of required) {
      const file = path.join(this.root, 'resources', relative);
      let ok = false;
      try {
        const original = path.join(this.source, 'resources', relative);
        await this.checkLinks(file); await this.checkLinks(original);
        ok = (await lstat(file)).isFile() && (await lstat(original)).isFile() && await hashFile(file) === await hashFile(original);
      } catch { /* report unverified files */ }
      checks.push({ name: relative, ok, detail: ok ? '与原始安装一致' : '文件缺失、已变化、不可读或含目录联接' });
    }
    let matchingCli = false;
    if (checks[0].ok) {
      try {
        const original = path.join(this.source, 'resources', 'codex.exe');
        await this.checkLinks(original);
        matchingCli = await hashFile(original) === await hashFile(path.join(this.root, 'resources', 'codex.exe'));
      } catch { /* unverified CLI must never be executed */ }
    }
    checks.push({ name: 'CLI 版本校验', ok: matchingCli, detail: matchingCli ? '与原始安装中的 CLI 一致' : '副本 CLI 与原始安装不一致或不可读' });
    let canPrepare = checks.every(check => check.ok);
    if (canPrepare) {
      try {
        await this.checkLinks(this.codexHome);
        const text = await this.runner(path.join(this.root, 'resources', 'codex.exe'), this.args('plugin', 'list', '--marketplace', 'openai-bundled', '--json'), this.env);
        const plugins = JSON.parse(text.replace(/^\uFEFF/, ''));
        if (!Array.isArray(plugins.installed)) throw new Error('插件列表格式不受支持。');
        const descriptor = JSON.parse(await readFile(path.join(this.root, 'resources/plugins/openai-bundled/plugins/computer-use/.codex-plugin/plugin.json'), 'utf8'));
        const installed = plugins.installed.filter((plugin: any) => plugin?.pluginId === selector);
        if (descriptor.name !== 'computer-use' || typeof descriptor.version !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(descriptor.version)) throw new Error('Computer Use 插件描述不受支持。');
        if (installed.length > 1) throw new Error('官方 CLI 返回重复的 Computer Use 插件记录。');
        const plugin = installed[0];
        const registered = plugin?.installed === true, enabled = plugin?.enabled === true;
        checks.push({ name: 'Computer Use 插件', ok: registered && enabled, detail: !registered ? '官方 CLI：插件尚未安装，请准备 Computer Use。' : !enabled ? '官方 CLI：插件已安装但未启用，请准备 Computer Use。' : `官方 CLI：已安装并启用，版本 ${typeof plugin.version === 'string' ? plugin.version : '未提供'}。` });
        if (registered && enabled) {
          const version = plugin.version;
          if (typeof version !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(version)) {
            checks.push({ name: '插件文件诊断', ok: false, warning: true, detail: 'CLI 未提供可识别的缓存版本；安装状态已确认，请启动后验证效果。' });
          } else {
            // CLI versions and local marketplace roots can differ from the packaged descriptor.
            // A fixed cache path or raw JSON formatting must not override official installation state.
            const candidates = [path.join(this.codexHome, 'plugins/cache/openai-bundled/computer-use', version)];
            if (plugin.source?.source === 'local' && typeof plugin.source.path === 'string' && path.isAbsolute(plugin.source.path)) candidates.push(plugin.source.path);
            let verified: string | undefined;
            const details: string[] = [];
            for (const root of new Set(candidates)) {
              const file = path.join(root, '.codex-plugin/plugin.json');
              try {
                await this.checkLinks(file);
                const cached = JSON.parse((await readFile(file, 'utf8')).replace(/^\uFEFF/, ''));
                if (cached.name !== 'computer-use' || cached.version !== version) { details.push(`${file}：名称或版本与 CLI 不一致`); continue; }
                verified = root; break;
              } catch { details.push(`${file}：描述文件缺失、不可读或含目录联接`); }
            }
            checks.push({ name: '插件文件诊断', ok: !!verified, warning: !verified, detail: verified ? `名称和版本匹配：${verified}` : `官方 CLI 已确认安装，文件布局未确认：${details.join('；')}。可启动副本后验证。` });
            if (version !== descriptor.version) checks.push({ name: '插件版本提示', ok: false, warning: true, detail: `已安装 ${version}，应用包内 ${descriptor.version}；保留已启用的插件，启动后确认兼容性。` });
          }
        }
      } catch (error) { canPrepare = false; checks.push({ name: 'Computer Use 插件', ok: false, detail: error instanceof Error ? error.message : String(error) }); }
    }
    const snapshot = await this.snapshot();
    for (const check of checks.filter(check => !check.ok)) this.report(`${check.warning ? 'Computer Use 提示' : 'Computer Use 检查未通过'}：${check.name}：${check.detail}`);
    return { ready: canPrepare && checks.every(check => check.ok || check.warning), canPrepare, checks, backup: snapshot ? path.join(this.snapshots, `${snapshot.id}.toml`) : undefined };
  }
  async prepare(): Promise<ComputerUseStatus> {
    const before = await this.status();
    if (before.ready) { this.report('官方 CLI 已确认 Computer Use 插件安装并启用，无需重复安装。'); return before; }
    if (!before.canPrepare) throw new Error('当前副本的 Computer Use 运行文件不完整或 CLI 校验失败；请查看检测结果，并从完整官方安装重新创建副本。');
    const config = await this.readConfig();
    let snapshot = await this.snapshot();
    await this.checkLinks(this.snapshots);
    await mkdir(this.snapshots, { recursive: true });
    if (snapshot) {
      const hash = sha256(config.bytes);
      if (!((hash === snapshot.beforeHash && config.existed === snapshot.existed) || (hash === snapshot.afterHash && config.existed === snapshot.afterExisted))) throw new Error('上次准备后 Codex 配置已被修改，请先处理原配置备份再重试。');
      const existingBackup = path.join(this.snapshots, `${snapshot.id}.toml`);
      await this.checkLinks(existingBackup);
      if (sha256(await readFile(existingBackup)) !== snapshot.beforeHash) throw new Error('Computer Use 配置备份校验失败。');
    } else {
      snapshot = { id: randomUUID(), configPath: this.configPath, existed: config.existed, beforeHash: sha256(config.bytes) };
      await writeFile(path.join(this.snapshots, `${snapshot.id}.toml`), config.bytes, { flag: 'wx', mode: 0o600 });
      await this.save(snapshot); // Persist recovery data before the CLI can change config.toml.
    }
    const backup = path.join(this.snapshots, `${snapshot.id}.toml`);
    const current = await this.readConfig();
    if (sha256(current.bytes) !== sha256(config.bytes) || current.existed !== config.existed) throw new Error('Codex 配置在准备过程中发生变化，已停止。');
    this.report('已备份 Codex 配置，使用副本自带 CLI 注册 Computer Use 插件…');
    try {
      await this.runner(path.join(this.root, 'resources/codex.exe'), this.args('plugin', 'add', selector, '--json'), this.env);
    } finally {
      const after = await this.readConfig();
      snapshot.afterHash = sha256(after.bytes); snapshot.afterExisted = after.existed;
      await this.save(snapshot);
    }
    const after = await this.status();
    if (!after.ready) throw new Error(`Computer Use 准备后核验未通过：${after.checks.filter(check => !check.ok && !check.warning).map(check => `${check.name}：${check.detail}`).join('；')}。原配置备份：${backup}`);
    this.report('Computer Use 运行文件与插件已就绪；启动副本后仍需在 Codex 内确认截图与操作效果。');
    return after;
  }
  async restoreConfig(): Promise<void> {
    const snapshot = await this.snapshot();
    if (!snapshot) throw new Error('此副本没有 Computer Use 配置备份。');
    const backup = path.join(this.snapshots, `${snapshot.id}.toml`);
    await this.checkLinks(backup);
    const bytes = await readFile(backup);
    if (sha256(bytes) !== snapshot.beforeHash) throw new Error('Computer Use 配置备份校验失败。');
    const current = await this.readConfig();
    const currentHash = sha256(current.bytes);
    if (currentHash !== snapshot.beforeHash || current.existed !== snapshot.existed) {
      if (!snapshot.afterHash || currentHash !== snapshot.afterHash || current.existed !== snapshot.afterExisted) throw new Error(`Codex 配置在准备后已被修改，未覆盖。原配置备份：${backup}`);
      if (snapshot.existed) {
        const temp = path.join(this.codexHome, `config-${randomUUID()}.tmp`);
        await writeFile(temp, bytes, { flag: 'wx', mode: 0o600 });
        await rename(temp, this.configPath);
      } else await rm(this.configPath, { force: true });
    }
    await rm(path.join(this.snapshots, 'active.json'));
    this.report('已恢复准备前的 Codex 配置；插件缓存和配置备份保留。');
  }
}
