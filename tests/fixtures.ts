import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { sha256 } from '../src/core/hash';
import type { Entry } from '../src/core/asar';

export const provider = `const localeOverride='zh-CN'; const messages={}; const layer='72216192'; export const enabled = config?.get("enable_i18n",!1); export const picker = config?.get('enable_i18n',true);`;

export function archive(files: Record<string, string>): { bytes: Buffer; headerHash: string } {
  const header: Entry = { files: {} }; const payload: Buffer[] = []; let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const bytes = Buffer.from(text), parts = name.split('/'), leaf = parts.pop()!;
    let dir = header;
    for (const part of parts) dir = (dir.files![part] ??= { files: {} });
    const blocks: string[] = []; const blockSize = 32;
    for (let i = 0; i < bytes.length; i += blockSize) blocks.push(sha256(bytes.subarray(i, i + blockSize)));
    dir.files![leaf] = { size: bytes.length, offset: String(offset), integrity: { algorithm: 'SHA256', hash: sha256(bytes), blockSize, blocks } };
    payload.push(bytes); offset += bytes.length;
  }
  const raw = Buffer.from(JSON.stringify(header)), padding = (4 - raw.length % 4) % 4;
  const prefix = Buffer.alloc(16);
  prefix.writeUInt32LE(4, 0); prefix.writeUInt32LE(8 + raw.length + padding, 4);
  prefix.writeUInt32LE(4 + raw.length + padding, 8); prefix.writeUInt32LE(raw.length, 12);
  return { bytes: Buffer.concat([prefix, raw, Buffer.alloc(padding), ...payload]), headerHash: sha256(raw) };
}
/** Minimal PE32+ with a real three-level named resource tree. No executable machine code. */
export function executable(hash: string): Buffer {
  const pe = Buffer.alloc(4096); pe.writeUInt16LE(0x5a4d, 0); pe.writeUInt32LE(0x80, 0x3c);
  pe.writeUInt32LE(0x4550, 0x80); pe.writeUInt16LE(0x8664, 0x84); pe.writeUInt16LE(1, 0x86); pe.writeUInt16LE(240, 0x94);
  const opt = 0x98; pe.writeUInt16LE(0x20b, opt); pe.writeUInt32LE(16, opt + 108);
  pe.writeUInt32LE(0x1000, opt + 128); pe.writeUInt32LE(2048, opt + 132);
  const section = opt + 240; pe.write('.rsrc', section); pe.writeUInt32LE(2048, section + 8); pe.writeUInt32LE(0x1000, section + 12); pe.writeUInt32LE(2048, section + 16); pe.writeUInt32LE(0x200, section + 20);
  const base = 0x200;
  function name(relative: number, text: string) { pe.writeUInt16LE(text.length, base + relative); pe.write(text, base + relative + 2, 'utf16le'); }
  name(0x100, 'INTEGRITY'); name(0x130, 'ELECTRONASAR');
  pe.writeUInt16LE(1, base + 12); pe.writeUInt32LE(0x80000100, base + 16); pe.writeUInt32LE(0x80000020, base + 20);
  pe.writeUInt16LE(1, base + 0x20 + 12); pe.writeUInt32LE(0x80000130, base + 0x20 + 16); pe.writeUInt32LE(0x80000040, base + 0x20 + 20);
  pe.writeUInt16LE(1, base + 0x40 + 14); pe.writeUInt32LE(1033, base + 0x40 + 16); pe.writeUInt32LE(0x60, base + 0x40 + 20);
  const data = Buffer.from(JSON.stringify([{ file: 'resources\\app.asar', alg: 'sha256', value: hash }]));
  pe.writeUInt32LE(0x1200, base + 0x60); pe.writeUInt32LE(data.length, base + 0x64); data.copy(pe, base + 0x200);
  pe.write('UNRELATED DATA MUST SURVIVE', 3500);
  return pe;
}
export async function fixture(root: string, extra: Record<string, string> = {}) {
  await mkdir(path.join(root, 'resources'), { recursive: true });
  const data = archive({ 'package.json': JSON.stringify({ name: 'codex', version: '26.1103.test' }), 'webview/assets/async/provider.js': provider, 'webview/assets/zh-CN-abc.js': 'export default {newChat:"新聊天",settings:"设置"};', 'native-menu-locales/zh-CN.json': '{"settings":"设置"}', 'untouched.txt': 'do not change', ...extra });
  await writeFile(path.join(root, 'resources/app.asar'), data.bytes);
  await writeFile(path.join(root, 'Codex.exe'), executable(data.headerHash));
  await writeFile(path.join(root, 'runtime.dll'), 'untouched runtime');
  return data;
}
