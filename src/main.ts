import { app, BrowserWindow, dialog, ipcMain, shell, nativeImage } from 'electron';
import { spawn } from 'node:child_process';
import { appendFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { RepairBackend } from './backend';
import { discover, assertWindows } from './windows';
import type { Inspection, Progress, Result, RepairOptions } from './shared';

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
    report(`检测安装路径：${input.trim()}`);
    latest = await manager.inspect(input.trim()); return latest;
  }, true);
  handle('repair', async (input: unknown = {}) => {
    assertWindows();
    if (!latest) throw new Error('请先检测安装目录。');
    if (!input || typeof input !== 'object' || Object.keys(input).some(key => key !== 'computerUse') || ('computerUse' in input && typeof input.computerUse !== 'boolean')) throw new Error('无效的修复选项。');
    const options = input as RepairOptions;
    if (options.computerUse && !latest.computerUse?.supported) throw new Error(latest.computerUse?.reason || '当前版本暂不支持 Computer Use 修复。');
    const result = await dialog.showMessageBox(window, {
      type: 'question', title: '创建修复副本', message: options.computerUse ? '在独立副本中启用中文和 Computer Use？' : '在独立副本中启用 Codex 中文界面？',
      detail: `目标：${latest.root}\n\n将复制应用、备份原文件并${options.computerUse ? "修改副本的中文、Computer Use 开关和运行时可信目录继承逻辑" : "修改副本的语言开关"}及 EXE 完整性信息。修改后的 EXE 不再具有有效的 OpenAI 原始签名，Windows 可能阻止其运行。官方安装不会改动。${options.computerUse ? "创建后还需单独准备 Computer Use：该操作会备份 Codex 配置，再调用官方 CLI 安装并启用插件，可通过“恢复 Computer Use 配置”回退。" : "API 密钥和个人配置不会改动。"}\n\n请先退出 Codex，修复后从本工具启动副本。`,
      buttons: ['取消', '创建修复副本'], defaultId: 0, cancelId: 0, noLink: true
    });
    return result.response === 1 ? await manager.install(latest, options) : null;
  }, true);
  for (const action of ['computerUseStatus', 'prepareComputerUse', 'restoreComputerUseConfig'] as const) {
    handle(action, async (id: unknown) => {
      assertWindows();
      if (typeof id !== 'string') throw new Error('无效记录。');
      return await manager[action](id);
    }, true);
  }
  handle('restore', async (id: string) => {
    assertWindows();
    if (typeof id !== 'string') throw new Error('无效记录。');
    const result = await dialog.showMessageBox(window, { type: 'question', message: '恢复该副本的原始文件？', detail: '副本将恢复为修复前的应用文件，备份和个人数据保留。Computer Use 配置需单独点击“恢复 Computer Use 配置”回退。之后请使用官方应用入口启动。', buttons: ['取消', '恢复原始文件'], defaultId: 0, cancelId: 0, noLink: true });
    return result.response === 1 ? await manager.restore(id) : null;
  }, true);
  handle('launch', async (id: string) => {
    assertWindows();
    if (typeof id !== 'string') throw new Error('无效记录。');
    const { executable, computerUse } = await manager.launchSpec(id);
    if (computerUse && !(await manager.computerUseStatus(id)).ready) throw new Error('Computer Use 运行环境尚未就绪，请先点击“准备 Computer Use”并查看检测结果。');
    await new Promise<void>((resolve, reject) => {
      const child = spawn(executable, [], { detached: true, stdio: 'ignore', cwd: path.dirname(executable), shell: false,
        env: computerUse ? { ...process.env, CODEX_ELECTRON_ENABLE_WINDOWS_COMPUTER_USE: '1', NODE_REPL_TRUSTED_CODE_PATHS: [process.env.NODE_REPL_TRUSTED_CODE_PATHS, path.join(path.dirname(executable), 'resources/cua_node/bin/node_modules'), path.join(path.dirname(executable), 'resources/plugins/openai-bundled')].filter(Boolean).join(path.delimiter) } : process.env });
      child.once('error', reject);
      child.once('spawn', () => { child.unref(); resolve(); });
    });
    report(computerUse ? '已发出启动请求。请在 Codex 的 Computer Use 设置中启用 Any App，并在新会话中验证截图与操作效果。' : '已发出启动请求。请在 Codex 中选择简体中文，并确认界面显示正常。');
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
