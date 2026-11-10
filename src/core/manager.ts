import { cp, copyFile, mkdir, readFile, readdir, realpath, rename, rm, stat, lstat, writeFile, statfs } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { planArchive, readArchive, writeArchivePatch } from './asar';
import { hashFile, sha256 } from './hash';
import { integrityResource, patchExecutable } from './pe';
import { addComputerUsePatches, planComputerUse } from './computer-use-gates';
import { addBrowserUsePatches, planBrowserUse } from './browser-use-gates';
import { ComputerUseRuntime } from './computer-use-runtime';
import os from 'node:os';
import type { Inspection, Installation, RepairOptions, ComputerUseSupport } from '../shared';

const asar = (root: string) => path.join(root, 'resources', 'app.asar');
export type Report = (message: string) => void;
const silent: Report = () => {};

export async function resolveRoot(input: string): Promise<string> {
  let root = await realpath(input);
  if ((await stat(root)).isFile()) root = path.dirname(root);
  for (const candidate of [root, path.join(root, 'app')]) {
    try { if ((await stat(asar(candidate))).isFile()) return candidate; } catch { /* try Store app subdirectory */ }
  }
  throw new Error('未找到 resources/app.asar。请选择 Codex 安装目录或 EXE 文件。');
}
export async function inspect(input: string, report: Report = silent): Promise<Inspection> {
  const root = await resolveRoot(input);
  const files = (await readdir(root, { withFileTypes: true })).filter(entry => entry.isFile() && /\.exe$/i.test(entry.name)).map(entry => entry.name);
  const names = files.filter(name => /^(?:codex|chatgpt)\.exe$/i.test(name));
  report(`安装目录中的 EXE：${files.join('、') || '无'}。`);
  if (!names.length) throw new Error(`未找到 Codex.exe / ChatGPT.exe。目录中的 EXE：${files.join('、') || '无'}。`);
  report('读取应用包并定位翻译加载器…');
  const plan = await planArchive(asar(root));
  let computerUse: ComputerUseSupport;
  try { computerUse = (await planComputerUse(plan)).support; }
  catch (error) { computerUse = { supported: false, reason: error instanceof Error ? error.message : String(error), files: [], patches: 0 }; }
  report(computerUse.reason);
  let browserUse: ComputerUseSupport;
  try { browserUse = (await planBrowserUse(plan)).support; }
  catch (error) { browserUse = { supported: false, reason: error instanceof Error ? error.message : String(error), files: [], patches: 0 }; }
  report(browserUse.reason);
  const headerHash = sha256(plan.archive.raw);
  // Store packages may ship both a launcher and the Electron host. Match their
  // embedded ASAR hash rather than requiring a single recognized filename.
  const matches: { executable: string; executableHash: string }[] = [];
  const failures: string[] = [];
  for (const executable of names) {
    try {
      const exe = await readFile(path.join(root, executable));
      if (integrityResource(exe).hash !== headerHash) throw new Error('原始 EXE 与应用包哈希不一致');
      matches.push({ executable, executableHash: sha256(exe) });
      report(`${executable}：EXE 与 ASAR 完整性匹配。`);
    } catch (error) {
      const reason = `${executable}：${error instanceof Error ? error.message : String(error)}`;
      failures.push(reason);
      report(`跳过 ${reason}`);
    }
  }
  if (!matches.length) throw new Error(`未找到与 resources/app.asar 完整性匹配的 EXE，停止修复。${failures.join('；')}`);
  if (matches.length > 1) throw new Error(`找到多个与 resources/app.asar 完整性匹配的 EXE，无法确定启动程序，停止修复：${matches.map(match => match.executable).join('、')}。`);
  const { executable, executableHash } = matches[0];
  report(`选定应用程序：${executable}。`);
  report('核对原始文件指纹…');
  return { root, executable, headerHash, sourceHash: await hashFile(asar(root)), executableHash, version: plan.version, packageName: plan.packageName, translationFiles: plan.translationFiles, gateFile: plan.file, gateOffset: plan.patch.start, store: /(?:^|[\\/])WindowsApps(?:[\\/]|$)/i.test(root), computerUse, browserUse };
}

export class RepairManager {
  private busy = false;
  constructor(readonly storage: string, private readonly report: Report = silent, private readonly assertStopped: () => Promise<void> = async () => {}) {}
  private folder(id: string) {
    if (!/^[a-f\d]{8}-[a-f\d-]{27}$/.test(id)) throw new Error('无效的修复记录。');
    return path.join(this.storage, id);
  }
  private async exclusive<T>(fn: () => Promise<T>): Promise<T> {
    if (this.busy) throw new Error('另一个操作正在进行，请等待完成。');
    this.busy = true;
    try { return await fn(); } finally { this.busy = false; }
  }
  private async manifest(id: string): Promise<Installation> {
    const folder = this.folder(id);
    await this.noLinks(folder, ['', 'manifest.json']);
    const value = JSON.parse(await readFile(path.join(folder, 'manifest.json'), 'utf8')) as Installation;
    if (value.features !== undefined && (typeof value.features !== 'object' || value.features === null || typeof value.features.computerUse !== 'boolean')) throw new Error('修复功能记录损坏。');
    if (value.features?.browserUse !== undefined && (typeof value.features.browserUse !== 'boolean' || value.features.browserUse && !value.features.computerUse)) throw new Error('浏览器修复功能记录损坏。');
    if (value.id !== id || !['ready', 'restoring', 'restored'].includes(value.status) || !/^(?:codex|chatgpt)\.exe$/i.test(value.source?.executable) || typeof value.source?.root !== 'string' || !path.isAbsolute(value.source.root) || typeof value.source.version !== 'string' || typeof value.createdAt !== 'string' || ![value.source.sourceHash, value.source.executableHash, value.source.headerHash, value.patchedAsarHash, value.patchedExeHash, value.patchedHeaderHash].every(hash => typeof hash === 'string' && /^[a-f\d]{64}$/.test(hash))) throw new Error('修复记录损坏。');
    return value;
  }
  private async noLinks(folder: string, relativePaths: string[]) {
    for (const item of relativePaths) if ((await lstat(path.join(folder, item))).isSymbolicLink()) throw new Error('修复目录包含符号链接或目录联接，停止操作。');
  }
  private async save(folder: string, value: Installation) {
    const temp = path.join(folder, `manifest-${randomUUID()}.tmp`);
    await writeFile(temp, JSON.stringify(value, null, 2), { flag: 'wx' });
    await rename(temp, path.join(folder, 'manifest.json'));
  }
  async list(): Promise<Installation[]> {
    await mkdir(this.storage, { recursive: true });
    const result: Installation[] = [];
    for (const name of await readdir(this.storage)) {
      if (!/^[a-f\d]{8}-[a-f\d-]{27}$/.test(name)) continue;
      try { result.push(await this.manifest(name)); } catch { this.report(`无法读取修复记录 ${name}，已跳过。`); }
    }
    return result.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  async install(expected: Inspection, options: RepairOptions = {}): Promise<Installation> {
    return this.exclusive(async () => {
      await this.assertStopped();
      if (options.browserUse && !options.computerUse) throw new Error('浏览器组合修复需要同时启用 Computer Use。');
      await mkdir(this.storage, { recursive: true });
      const source = await inspect(expected.root, this.report);
      if (options.computerUse && !source.computerUse?.supported) throw new Error(source.computerUse?.reason || '当前版本不支持 Computer Use 修复。');
      if (options.browserUse && !source.browserUse?.supported) throw new Error(source.browserUse?.reason || '当前版本不支持浏览器修复。');
      if (source.sourceHash !== expected.sourceHash || source.executableHash !== expected.executableHash || source.root !== expected.root) throw new Error('安装文件在检测后发生变化，请重新检测。');
      const storageReal = await realpath(this.storage);
      const relative = path.relative(source.root, storageReal);
      if (relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))) throw new Error('副本存储目录不能位于原安装目录内。');
      if (path.relative(storageReal, source.root).split(path.sep)[0] !== '..' && !path.isAbsolute(path.relative(storageReal, source.root))) throw new Error('不能再次修补已经托管的应用副本。');
      const total = await this.treeSize(source.root);
      const free = await statfs(this.storage);
      if (free.bavail * free.bsize < total * 2 + 256 * 1024 * 1024) throw new Error('磁盘空间不足，需要容纳应用副本和原文件备份。');
      const id = randomUUID(), stage = path.join(this.storage, `.staging-${id}`), folder = this.folder(id);
      await mkdir(stage);
      try {
        this.report('创建独立应用副本，官方安装保持不变…');
        await cp(source.root, path.join(stage, 'app'), { recursive: true, errorOnExist: true, force: false, filter: async (src) => {
          const info = await lstat(src);
          if (info.isSymbolicLink()) throw new Error('安装目录含符号链接或目录联接，第一版不支持。');
          if (!info.isDirectory() && !info.isFile()) throw new Error('安装目录包含不支持的特殊文件。');
          return true;
        } });
        const app = path.join(stage, 'app'), backup = path.join(stage, 'originals');
        await mkdir(backup);
        await copyFile(asar(app), path.join(backup, 'app.asar'));
        await copyFile(path.join(app, source.executable), path.join(backup, source.executable));
        if (await hashFile(asar(app)) !== source.sourceHash || await hashFile(path.join(app, source.executable)) !== source.executableHash) throw new Error('复制过程中源文件发生变化，请重新检测。');
        let plan = await planArchive(asar(app));
        if (options.computerUse) plan = await addComputerUsePatches(plan);
        if (options.browserUse) plan = await addBrowserUsePatches(plan);
        this.report(options.browserUse ? '在副本中应用中文、Computer Use、Chrome 和内置 Browser Use 适配，并更新完整性校验…' : options.computerUse ? '在副本中启用中文与 Computer Use 开关，并更新完整性校验…' : '在副本中启用翻译加载器，并更新完整性校验…');
        const patchedHeaderHash = await writeArchivePatch(asar(app), plan);
        const patchedExe = patchExecutable(await readFile(path.join(app, source.executable)), source.headerHash, patchedHeaderHash);
        await writeFile(path.join(app, source.executable), patchedExe);
        const installation: Installation = { id, createdAt: new Date().toISOString(), source, status: 'ready', patchedAsarHash: await hashFile(asar(app)), patchedExeHash: sha256(patchedExe), patchedHeaderHash, features: { computerUse: options.computerUse === true, browserUse: options.browserUse === true } };
        await this.assertStopped();
        // Detect updater races before publishing the copy.
        if (await hashFile(asar(source.root)) !== source.sourceHash || await hashFile(path.join(source.root, source.executable)) !== source.executableHash) throw new Error('官方应用正在更新，请更新完成后重试。');
        await this.save(stage, installation);
        await rename(stage, folder);
        this.report(options.computerUse ? '组合修复副本已创建。请先准备 Computer Use，再从本工具启动验证。' : '修复副本已就绪。请从本工具启动，并在应用中选择简体中文。');
        return installation;
      } catch (error) { await rm(stage, { recursive: true, force: true }).catch(() => {}); throw error; }
    });
  }
  private async treeSize(root: string): Promise<number> {
    let total = 0;
    for (const entry of await readdir(root, { withFileTypes: true })) {
      const item = path.join(root, entry.name);
      if (entry.isSymbolicLink()) throw new Error('第一版不处理符号链接或目录联接。');
      if (entry.isDirectory()) total += await this.treeSize(item);
      else if (entry.isFile()) total += (await stat(item)).size;
      else throw new Error('安装目录包含不支持的特殊文件。');
    }
    return total;
  }
  private async computerUseRuntime(id: string, configOnly = false) {
    const record = await this.manifest(id);
    if ((!configOnly && record.status !== 'ready') || !record.features?.computerUse) throw new Error('请先创建包含 Computer Use 的修复副本。');
    const app = path.join(this.folder(id), 'app');
    await this.noLinks(this.folder(id), ['app', 'app/resources', 'app/resources/app.asar', `app/${record.source.executable}`]);
    if (!configOnly && (await hashFile(asar(record.source.root)) !== record.source.sourceHash || await hashFile(path.join(record.source.root, record.source.executable)) !== record.source.executableHash)) throw new Error('官方应用已更新，请重新检测并创建修复副本。');
    if (!configOnly && (await hashFile(asar(app)) !== record.patchedAsarHash || await hashFile(path.join(app, record.source.executable)) !== record.patchedExeHash)) throw new Error('修复副本已变化，请重新创建。');
    return new ComputerUseRuntime(app, record.source.root, this.folder(id), process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), this.report, undefined, undefined, record.features?.browserUse === true);
  }
  computerUseStatus(id: string) { return this.exclusive(async () => (await this.computerUseRuntime(id)).status()); }
  prepareComputerUse(id: string) { return this.exclusive(async () => { await this.assertStopped(); return (await this.computerUseRuntime(id)).prepare(); }); }
  restoreComputerUseConfig(id: string) { return this.exclusive(async () => { await this.assertStopped(); return (await this.computerUseRuntime(id, true)).restoreConfig(); }); }
  async launchSpec(id: string) {
    const executable = await this.launchPath(id);
    const record = await this.manifest(id);
    return { executable, computerUse: record.features?.computerUse === true, browserUse: record.features?.browserUse === true };
  }
  async launchPath(id: string): Promise<string> {
    return this.exclusive(async () => {
      await this.assertStopped();
      const record = await this.manifest(id);
      if (record.status !== 'ready') throw new Error('该副本已恢复或恢复尚未完成，请使用官方应用。');
      await this.noLinks(this.folder(id), ['app', 'app/resources', 'app/resources/app.asar', `app/${record.source.executable}`]);
      if (await hashFile(asar(record.source.root)) !== record.source.sourceHash || await hashFile(path.join(record.source.root, record.source.executable)) !== record.source.executableHash) throw new Error('官方应用已更新，请重新检测并创建修复副本。');
      const app = path.join(this.folder(id), 'app');
      if (await hashFile(asar(app)) !== record.patchedAsarHash || await hashFile(path.join(app, record.source.executable)) !== record.patchedExeHash) throw new Error('修复副本被修改或更新，请重新创建。');
      if (sha256((await readArchive(asar(app))).raw) !== integrityResource(await readFile(path.join(app, record.source.executable))).hash) throw new Error('副本完整性信息不匹配。');
      return path.join(app, record.source.executable);
    });
  }
  async restore(id: string): Promise<Installation> {
    return this.exclusive(async () => {
      await this.assertStopped();
      const folder = this.folder(id), record = await this.manifest(id), backup = path.join(folder, 'originals');
      if (record.status === 'restored') return record;
      await this.noLinks(folder, ['app', 'app/resources', 'app/resources/app.asar', `app/${record.source.executable}`, 'originals', 'originals/app.asar', `originals/${record.source.executable}`]);
      if (await hashFile(path.join(backup, 'app.asar')) !== record.source.sourceHash || await hashFile(path.join(backup, record.source.executable)) !== record.source.executableHash) throw new Error('原始备份校验失败，停止恢复。');
      // Persist intent before writing. Interrupted restores remain non-launchable and retryable.
      record.status = 'restoring'; await this.save(folder, record);
      this.report('从备份恢复副本中的原始文件…');
      const app = path.join(folder, 'app');
      for (const [from, to] of [[path.join(backup, 'app.asar'), asar(app)], [path.join(backup, record.source.executable), path.join(app, record.source.executable)]]) {
        const temp = `${to}.restore-${randomUUID()}`;
        await copyFile(from, temp); await rename(temp, to);
      }
      if (await hashFile(asar(app)) !== record.source.sourceHash || await hashFile(path.join(app, record.source.executable)) !== record.source.executableHash) throw new Error('恢复后的文件校验失败，可重新点击恢复。');
      record.status = 'restored'; await this.save(folder, record);
      this.report('副本已恢复原始文件。官方安装和个人配置未修改。');
      return record;
    });
  }
}
