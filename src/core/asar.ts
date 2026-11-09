import { open, type FileHandle } from 'node:fs/promises';
import { sha256 } from './hash';
import { findGatePatches, applyGatePatch, type GatePatch } from './gate';

export interface Entry {
  files?: Record<string, Entry>; size?: number; offset?: string; unpacked?: boolean; link?: string;
  integrity?: { algorithm: string; hash: string; blockSize: number; blocks: string[] };
}
export interface Archive { path: string; header: Entry; raw: Buffer; dataOffset: number; length: number }
export interface ArchivePlan { archive: Archive; file: string; patch: GatePatch; original: Buffer; modified: Buffer; version: string; packageName: string; translationFiles: number }
async function readExact(file: FileHandle, size: number, at: number): Promise<Buffer> {
  const out = Buffer.alloc(size);
  let offset = 0;
  while (offset < size) {
    const { bytesRead } = await file.read(out, offset, size - offset, at + offset);
    if (!bytesRead) throw new Error('ASAR 数据不完整。');
    offset += bytesRead;
  }
  return out;
}
export async function readArchive(path: string): Promise<Archive> {
  const file = await open(path, 'r');
  try {
    const length = (await file.stat()).size;
    const prefix = await readExact(file, 16, 0);
    const headerSize = prefix.readUInt32LE(4), jsonSize = prefix.readUInt32LE(12);
    if (prefix.readUInt32LE(0) !== 4 || headerSize < 8 || headerSize > 64 * 1024 * 1024 || jsonSize > headerSize - 8 || 8 + headerSize > length || prefix.readUInt32LE(8) !== headerSize - 4) throw new Error('不支持或损坏的 ASAR 头部。');
    const raw = await readExact(file, jsonSize, 16);
    const header = JSON.parse(raw.toString('utf8')) as Entry;
    if (!header.files) throw new Error('ASAR 文件目录缺失。');
    return { path, header, raw, dataOffset: 8 + headerSize, length };
  } finally { await file.close(); }
}
export function entries(header: Entry, prefix = ''): [string, Entry][] {
  const result: [string, Entry][] = [];
  function visit(node: Entry, current: string, depth: number) {
    if (depth > 80) throw new Error('ASAR 目录层级异常。');
    for (const [name, child] of Object.entries(node.files ?? {})) {
      if (name === '.' || name === '..' || /[\\/\0]/.test(name)) throw new Error('ASAR 包含不安全路径。');
      const path = current ? `${current}/${name}` : name;
      if (child.files) visit(child, path, depth + 1); else result.push([path, child]);
    }
  }
  visit(header, prefix, 0);
  return result;
}
function range(archive: Archive, entry: Entry) {
  const offset = Number(entry.offset), size = entry.size;
  if (entry.link || entry.unpacked || !/^\d+$/.test(entry.offset ?? '') || !Number.isSafeInteger(offset) || !Number.isSafeInteger(size) || size! < 0 || offset + size! > archive.length - archive.dataOffset) throw new Error('仅支持有效的 ASAR 内嵌文件。');
  return { offset: archive.dataOffset + offset, size: size! };
}
export function verifyIntegrity(data: Buffer, entry: Entry) {
  const integrity = entry.integrity;
  if (!integrity || integrity.algorithm !== 'SHA256' || integrity.hash !== sha256(data) || !Number.isSafeInteger(integrity.blockSize) || integrity.blockSize < 1) throw new Error('ASAR 文件完整性校验失败。');
  const count = Math.ceil(data.length / integrity.blockSize);
  // electron/asar records one empty block for empty files in some versions.
  if (data.length && integrity.blocks.length !== count) throw new Error('ASAR 分块校验信息异常。');
  for (let i = 0; i < count; i++) if (sha256(data.subarray(i * integrity.blockSize, (i + 1) * integrity.blockSize)) !== integrity.blocks[i]) throw new Error('ASAR 分块校验失败。');
}
export async function readEntry(archive: Archive, entry: Entry): Promise<Buffer> {
  const { offset, size } = range(archive, entry);
  if (size > 96 * 1024 * 1024) throw new Error('目标 JavaScript 文件过大，不支持此版本。');
  const handle = await open(archive.path, 'r');
  try { return await readExact(handle, size, offset); } finally { await handle.close(); }
}
export async function planArchive(path: string): Promise<ArchivePlan> {
  const archive = await readArchive(path), all = entries(archive.header);
  const packageEntry = all.find(([name]) => name === 'package.json')?.[1];
  if (!packageEntry) throw new Error('不是可识别的 Codex 应用包。');
  const pkg = JSON.parse((await readEntry(archive, packageEntry)).toString());
  if (!/codex|chatgpt/i.test(`${pkg.name ?? ''} ${pkg.productName ?? ''}`)) throw new Error('应用包标识不是 Codex / ChatGPT。');
  const translations = all.filter(([name]) => /(?:zh-CN|zh-Hans)(?:[.\/-]|$)/i.test(name) && /\.(?:js|json)$/.test(name));
  const catalogs = new Set(translations.filter(([name]) => name.startsWith('webview/')).map(([name]) => name));
  const matches: { file: string; entry: Entry; original: Buffer; patch: GatePatch }[] = [];
  for (const [file, entry] of all) {
    if (!file.startsWith('webview/') || !file.endsWith('.js') || entry.unpacked || entry.link) continue;
    const original = await readEntry(archive, entry);
    // Newer bundlers may give locale chunks numeric names. Require substantial Chinese
    // catalog content, not just a locale tag in a registry, before accepting such a chunk.
    if (!catalogs.size) {
      const text = original.toString('utf8');
      if (text.includes('新聊天') && text.includes('设置') && (text.match(/[\u4e00-\u9fff]{2,}/g)?.length ?? 0) >= 100) catalogs.add(file);
    }
    if (!original.includes(Buffer.from('enable_i18n'))) continue;
    for (const patch of findGatePatches(new TextDecoder('utf-8', { fatal: true }).decode(original))) matches.push({ file, entry, original, patch });
  }
  if (!catalogs.size) throw new Error('未找到内置简体中文界面资源，不能只修复语言开关。');
  if (matches.length !== 1) throw new Error(matches.length ? `找到 ${matches.length} 个可能的翻译加载器，停止修复以避免误改。` : '未识别到受支持的 enable_i18n 加载器；该版本可能已修复或代码结构已变化。');
  const match = matches[0];
  verifyIntegrity(match.original, match.entry);
  return { archive, file: match.file, patch: match.patch, original: match.original, modified: applyGatePatch(match.original, match.patch), version: String(pkg.version ?? '未知'), packageName: String(pkg.name), translationFiles: new Set([...translations.map(([name]) => name), ...catalogs]).size };
}
/** Only call on a staged copy. Fixed member size preserves offsets and all unrelated payload bytes. */
export async function writeArchivePatch(copyPath: string, plan: ArchivePlan): Promise<string> {
  const copied = await readArchive(copyPath);
  if (!copied.raw.equals(plan.archive.raw)) throw new Error('副本头部与检测结果不一致。');
  const entry = entries(copied.header).find(([name]) => name === plan.file)![1];
  const current = await readEntry(copied, entry);
  if (!current.equals(plan.original)) throw new Error('待修改文件在检测后发生变化。');
  const integrity = entry.integrity!;
  integrity.hash = sha256(plan.modified);
  integrity.blocks = [];
  for (let offset = 0; offset < plan.modified.length; offset += integrity.blockSize) integrity.blocks.push(sha256(plan.modified.subarray(offset, offset + integrity.blockSize)));
  const json = Buffer.from(JSON.stringify(copied.header));
  if (json.length > copied.raw.length) throw new Error('新 ASAR 头部长度超限，已停止。');
  const raw = Buffer.alloc(copied.raw.length, 32); json.copy(raw);
  const handle = await open(copyPath, 'r+');
  try { await handle.write(plan.modified, 0, plan.modified.length, range(copied, entry).offset); await handle.write(raw, 0, raw.length, 16); await handle.sync(); }
  finally { await handle.close(); }
  const checked = await readArchive(copyPath);
  const checkedEntry = entries(checked.header).find(([name]) => name === plan.file)![1];
  const checkedBytes = await readEntry(checked, checkedEntry);
  verifyIntegrity(checkedBytes, checkedEntry);
  if (!checkedBytes.equals(plan.modified)) throw new Error('补丁写入后的内容校验失败。');
  return sha256(checked.raw);
}
