/** Read and patch the existing Electron integrity resource without rebuilding the PE. */
interface Resource { offset: number; size: number }
export interface IntegrityResource extends Resource { hash: string; hashOffset: number }
export function integrityResource(pe: Buffer): IntegrityResource {
  const check = (offset: number, size: number) => {
    if (!Number.isSafeInteger(offset) || offset < 0 || offset + size > pe.length) throw new Error('EXE 结构越界或不完整。');
  };
  const u16 = (at: number) => { check(at, 2); return pe.readUInt16LE(at); };
  const u32 = (at: number) => { check(at, 4); return pe.readUInt32LE(at); };
  if (u16(0) !== 0x5a4d) throw new Error('不是有效的 Windows EXE。');
  const nt = u32(0x3c);
  if (u32(nt) !== 0x4550 || u16(nt + 4) !== 0x8664) throw new Error('第一版仅支持 Windows x64 应用。');
  const sections = u16(nt + 6), optional = nt + 24, optionalSize = u16(nt + 20);
  if (u16(optional) !== 0x20b || optionalSize < 136 || u32(optional + 108) < 3 || sections > 96) throw new Error('不支持此 PE 可选头。');
  const rvaToOffset = (rva: number, size: number): number => {
    for (let i = 0; i < sections; i++) {
      const section = optional + optionalSize + i * 40;
      const va = u32(section + 12), rawSize = u32(section + 16), raw = u32(section + 20);
      if (rva >= va && rva - va + size <= rawSize) { check(raw + rva - va, size); return raw + rva - va; }
    }
    throw new Error('无法解析 EXE 资源地址。');
  };
  const resourceRva = u32(optional + 112 + 16), resourceSize = u32(optional + 112 + 20);
  if (!resourceRva || resourceSize < 16) throw new Error('未找到 EXE 的完整性资源。');
  const base = rvaToOffset(resourceRva, resourceSize);
  const resourceCheck = (rel: number, size: number) => {
    if (rel < 0 || rel + size > resourceSize) throw new Error('EXE 资源目录越界。');
    check(base + rel, size);
  };
  const label = (field: number): string => {
    if (!(field & 0x80000000)) return String(field);
    const rel = field & 0x7fffffff;
    resourceCheck(rel, 2);
    const size = u16(base + rel) * 2;
    resourceCheck(rel + 2, size);
    return pe.subarray(base + rel + 2, base + rel + 2 + size).toString('utf16le').toUpperCase();
  };
  const matches: Resource[] = [];
  const visit = (rel: number, labels: string[]) => {
    if (labels.length > 2) throw new Error('EXE 资源目录深度异常。');
    resourceCheck(rel, 16);
    const count = u16(base + rel + 12) + u16(base + rel + 14);
    if (count > 4096) throw new Error('EXE 资源目录过大。');
    resourceCheck(rel + 16, count * 8);
    for (let i = 0; i < count; i++) {
      const at = base + rel + 16 + i * 8;
      const name = label(u32(at)), child = u32(at + 4), next = [...labels, name];
      if (next[0] !== 'INTEGRITY' || (next.length > 1 && next[1] !== 'ELECTRONASAR')) continue;
      if (child & 0x80000000) visit(child & 0x7fffffff, next);
      else {
        if (next.length !== 3) throw new Error('不支持的完整性资源层级。');
        resourceCheck(child, 16);
        const size = u32(base + child + 4);
        if (size > 1024 * 1024) throw new Error('完整性资源过大。');
        matches.push({ offset: rvaToOffset(u32(base + child), size), size });
      }
    }
  };
  visit(0, []);
  if (matches.length !== 1) throw new Error('EXE 必须具有唯一的 Electron ASAR 完整性资源。');
  const match = matches[0], raw = pe.subarray(match.offset, match.offset + match.size);
  const metadata = JSON.parse(raw.toString('utf8').replace(/\0+$/, ''));
  if (!Array.isArray(metadata)) throw new Error('完整性资源格式不支持。');
  const records = metadata.filter((item) => typeof item.file === 'string' && item.file.replaceAll('\\', '/').toLowerCase() === 'resources/app.asar');
  if (records.length !== 1 || records[0].alg?.toLowerCase() !== 'sha256' || !/^[a-f\d]{64}$/i.test(records[0].value)) throw new Error('EXE 内嵌 ASAR 哈希无效。');
  const hash = records[0].value as string, index = raw.indexOf(hash);
  if (index < 0 || raw.indexOf(hash, index + 1) >= 0) throw new Error('完整性资源哈希位置不唯一。');
  return { ...match, hash: hash.toLowerCase(), hashOffset: match.offset + index };
}
export function patchExecutable(pe: Buffer, oldHeaderHash: string, newHeaderHash: string): Buffer {
  const resource = integrityResource(pe);
  if (resource.hash !== oldHeaderHash || !/^[a-f\d]{64}$/.test(newHeaderHash)) throw new Error('EXE 与 ASAR 不匹配，可能已被修改或正在更新。');
  const result = Buffer.from(pe);
  result.write(newHeaderHash, resource.hashOffset, 64, 'ascii');
  if (integrityResource(result).hash !== newHeaderHash) throw new Error('EXE 完整性哈希写入校验失败。');
  return result;
}
