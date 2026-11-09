import { app, BrowserWindow, dialog, ipcMain, shell, nativeImage } from 'electron';
import { spawn } from 'node:child_process';
import { appendFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { RepairBackend } from './backend';
import { discover, assertWindows } from './windows';
import type { Inspection, Progress, Result } from './shared';

let window: BrowserWindow;
let latest: Inspection | null = null;
let operation = false;
let manager: RepairBackend;
let logFile: string;
const page = pathToFileURL(path.join(__dirname, 'index.html')).href;

function report(message: string) {
  const progress: Progress = { message, at: new Date().toISOString() };
  if (window && !window.isDestroyed()) window.webContents.send('progress', progress);
  void appendFile(logFile, `${progress.at} ${message}\n`).catch(() => {});
}
function handle<T>(name: string, fn: (...args: any[]) => Promise<T>, exclusive = false) {
  ipcMain.handle(name, async (event, ...args): Promise<Result<T>> => {
    if (event.sender !== window.webContents || event.senderFrame?.url !== page) throw new Error('不允许的请求来源。');
    if (exclusive && operation) return { ok: false, error: '操作正在进行，请稍候。' };
    if (exclusive) operation = true;
    try { return { ok: true, value: await fn(...args) }; }
    catch (error) {
      const message = error instanceof Error ? error.message : '操作失败。';
      report(`操作未完成：${message}`); return { ok: false, error: message };
    } finally { if (exclusive) operation = false; }
  });
}
async function setup() {
  const home = app.getPath('userData');
  await mkdir(home, { recursive: true });
  logFile = path.join(home, 'helper.log');
  manager = new RepairBackend(path.join(home, 'repairs'), report);
  handle('overview', async () => ({ platform: `${process.platform}-${process.arch}`, candidates: await discover({ report }), installations: await manager.list() }));
  handle('choose', async () => {
    assertWindows();
    const result = await dialog.showOpenDialog(window, { title: '选择 Codex 安装目录', properties: ['openDirectory'] });
    return result.canceled ? null : result.filePaths[0];
  });
  handle('inspect', async (input: unknown) => {
    assertWindows(); latest = null;
    if (typeof input !== 'string' || !input.trim() || input.length > 4096) throw new Error('请选择或填写有效安装路径。');
    latest = await manager.inspect(input.trim()); return latest;
  }, true);
  handle('repair', async () => {
    assertWindows();
    if (!latest) throw new Error('请先检测安装目录。');
    const result = await dialog.showMessageBox(window, {
      type: 'question', title: '创建修复副本', message: '在独立副本中启用 Codex 中文界面？',
      detail: `目标：${latest.root}\n\n将复制应用、备份原文件并修改副本的语言开关及 EXE 完整性信息。修改后的 EXE 不再具有有效的 OpenAI 原始签名，Windows 可能阻止其运行。官方安装、API 密钥和个人配置不会改动。\n\n请先退出 Codex，修复后从本工具启动副本。`,
      buttons: ['取消', '创建修复副本'], defaultId: 0, cancelId: 0, noLink: true
    });
    return result.response === 1 ? await manager.install(latest) : null;
  }, true);
  handle('restore', async (id: string) => {
    assertWindows();
    if (typeof id !== 'string') throw new Error('无效记录。');
    const result = await dialog.showMessageBox(window, { type: 'question', message: '恢复该副本的原始文件？', detail: '副本将恢复为修复前的应用文件，备份和个人数据保留。之后请使用官方应用入口启动。', buttons: ['取消', '恢复原始文件'], defaultId: 0, cancelId: 0, noLink: true });
    return result.response === 1 ? await manager.restore(id) : null;
  }, true);
  handle('launch', async (id: string) => {
    assertWindows();
    if (typeof id !== 'string') throw new Error('无效记录。');
    const executable = await manager.launchPath(id);
    await new Promise<void>((resolve, reject) => {
      const child = spawn(executable, [], { detached: true, stdio: 'ignore', cwd: path.dirname(executable), shell: false });
      child.once('error', reject);
      child.once('spawn', () => { child.unref(); resolve(); });
    });
    report('已发出启动请求。请在 Codex 中选择简体中文，并确认界面显示正常。');
  }, true);
  handle('logs', async () => { await appendFile(logFile, ''); shell.showItemInFolder(logFile); });
  const iconPath = path.join(__dirname, 'branding/nofy-helper-app.png');
  if (process.platform === 'darwin') app.dock?.setIcon(nativeImage.createFromPath(iconPath));
  window = new BrowserWindow({
    icon: iconPath,
    width: 1120, height: 820, minWidth: 850, minHeight: 680, title: 'nofy-helper', backgroundColor: '#faf9f7',
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true }
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  window.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  window.on('close', (event) => { if (operation) { event.preventDefault(); report('操作正在进行，请完成后再关闭窗口。'); } });
  await window.loadFile(path.join(__dirname, 'index.html'));
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (window) { if (window.isMinimized()) window.restore(); window.show(); window.focus(); } });
  app.whenReady().then(setup).catch((error) => { dialog.showErrorBox('nofy-helper 启动失败', String(error)); app.quit(); });
  app.on('window-all-closed', () => app.quit());
  app.on('will-quit', () => manager?.close());
}
