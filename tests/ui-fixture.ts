// Browser-only test fixture. Not imported by the application or included in release files.
import type { ComputerUseStatus, HelperAPI, Inspection, Installation, Progress } from '../src/shared';
const state = new URLSearchParams(location.search).get('state') || 'windows';
const calls: string[] = [];
let callback: ((event: Progress) => void) | null = null;
const source: Inspection = {
  root: 'C:\\Users\\Alex\\AppData\\Local\\Programs\\Codex', executable: 'Codex.exe',
  version: state.startsWith('cua') ? '26.1103.4239.0' : '26.1104.1', packageName: 'Codex', sourceHash: 'a'.repeat(64), executableHash: 'b'.repeat(64), headerHash: 'c'.repeat(64),
  translationFiles: 3, gateFile: 'webview/assets/index-Bh7w8Sc3.js', gateOffset: 100, store: false,
  computerUse: { supported: state.startsWith('cua'), reason: state.startsWith('cua') ? '已识别当前版本的 Computer Use 开关；创建副本后还需准备运行环境。' : '此版本暂未适配 Computer Use。', files: ['webview/cua.js'], patches: 5 },
};
const record: Installation = { id: '259cf42f-233e-4c88-99ae-14a02bd88dc7', createdAt: '2026-11-09T11:43:27.000Z', source, status: 'ready', patchedAsarHash: 'd'.repeat(64), patchedExeHash: 'e'.repeat(64), patchedHeaderHash: 'f'.repeat(64) };
let records: Installation[] = JSON.parse(sessionStorage.getItem('ui-records') || 'null') || (state === 'records' ? [record] : []);
const save = () => sessionStorage.setItem('ui-records', JSON.stringify(records));
const pause = () => new Promise<void>(resolve => setTimeout(resolve, 180));
let cuaStatus: ComputerUseStatus = { ready: false, canPrepare: state !== 'cua-missing', checks: [{ name: '运行文件', ok: state !== 'cua-missing', detail: state === 'cua-missing' ? '运行文件缺失' : '文件存在' }] };
const api: HelperAPI = {
  async overview() { calls.push('overview'); await pause(); return { ok: true, value: { platform: state === 'mac' ? 'darwin-arm64' : 'win32-x64', candidates: state === 'empty' || state === 'mac' ? [] : [{ label: 'Codex', path: source.root }], installations: records } }; },
  async choose() { calls.push('choose'); return { ok: true, value: source.root }; },
  async inspect(path) { calls.push('inspect'); callback?.({ at: new Date().toISOString(), message: '正在检查中文资源与文件完整性…' }); await pause(); if (path.includes('invalid')) return { ok: false, error: '此目录未找到 Codex 安装，请检查路径后重试。' }; return { ok: true, value: { ...source, root: path } }; },
  async repair(options) { calls.push('repair'); if (state === 'cancel') return { ok: true, value: null }; callback?.({ at: new Date().toISOString(), message: '正在创建副本并保存原始文件…' }); await pause(); records = [{ ...record, features: { computerUse: options?.computerUse === true } }]; save(); return { ok: true, value: records[0] }; },
  async computerUseStatus() { calls.push('computerUseStatus'); await pause(); return { ok: true, value: cuaStatus }; },
  async prepareComputerUse() { calls.push('prepareComputerUse'); await pause(); if (state === 'cua-missing') return { ok: false, error: 'Computer Use 运行文件不完整。' }; cuaStatus = { ...cuaStatus, ready: true, backup: 'C:\\Nofy\\config-before.toml', checks: [{ name: 'Computer Use 插件', ok: true, detail: '已启用' }] }; return { ok: true, value: cuaStatus }; },
  async restoreComputerUseConfig() { calls.push('restoreComputerUseConfig'); cuaStatus = { ...cuaStatus, ready: false, backup: undefined }; return { ok: true, value: undefined }; },
  async restore() { calls.push('restore'); await pause(); records = [{ ...record, status: 'restored' }]; save(); return { ok: true, value: records[0] }; },
  async launch() { calls.push('launch'); await pause(); return { ok: true, value: undefined }; },
  async logs() { calls.push('logs'); return { ok: true, value: undefined }; },
  onProgress(fn) { callback = fn; return () => { callback = null; }; },
};
window.helper = api;
Object.assign(window, { uiTest: { calls } });
