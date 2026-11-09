import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, readdir, symlink } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fixture, executable, provider } from './fixtures';
import { inspect, RepairManager } from '../src/core/manager';
import { hashFile, sha256 } from '../src/core/hash';
import { planArchive, readArchive, readEntry, entries, verifyIntegrity } from '../src/core/asar';
import { integrityResource, patchExecutable } from '../src/core/pe';

async function environment(t: any) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'nofy-test-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const source = path.join(dir, '安装目录 with spaces'), storage = path.join(dir, 'repairs');
  await fixture(source); return { source, storage, manager: new RepairManager(storage) };
}
test('install → verify → restore, preserving the official installation byte for byte', async t => {
  const { source, storage, manager } = await environment(t); const before = await inspect(source);
  const result = await manager.install(before); const app = path.join(storage, result.id, 'app');
  assert.equal((await manager.list()).length, 1); assert.equal(await hashFile(path.join(source, 'resources/app.asar')), before.sourceHash);
  assert.equal(await hashFile(path.join(source, 'Codex.exe')), before.executableHash);
  assert.notEqual(result.patchedAsarHash, before.sourceHash); assert.notEqual(result.patchedExeHash, before.executableHash);
  assert.equal(await manager.launchPath(result.id), path.join(app, 'Codex.exe'));
  assert.equal(await readFile(path.join(app, 'runtime.dll'), 'utf8'), 'untouched runtime');
  const archive = await readArchive(path.join(app, 'resources/app.asar'));
  for (const [name, entry] of entries(archive.header)) { const bytes = await readEntry(archive, entry); verifyIntegrity(bytes, entry); if (name === 'untouched.txt') assert.equal(bytes.toString(), 'do not change'); }
  await assert.rejects(() => planArchive(path.join(app, 'resources/app.asar')), /未识别/);
  const restored = await manager.restore(result.id); assert.equal(restored.status, 'restored');
  assert.equal(await hashFile(path.join(app, 'resources/app.asar')), before.sourceHash); assert.equal(await hashFile(path.join(app, 'Codex.exe')), before.executableHash);
  await assert.rejects(() => manager.launchPath(result.id), /恢复/); assert.equal((await manager.restore(result.id)).status, 'restored');
});
test('refuses ambiguous providers without publishing a copy', async t => {
  const { source, storage } = await environment(t);
  await fixture(source, { 'webview/second.js': provider });
  await assert.rejects(() => inspect(source), /2 个/);
  assert.deepEqual(await readdir(storage).catch(() => []), []);
});
test('selects the desktop EXE by ASAR integrity when a second named EXE is a CLI', async t => {
  const { source } = await environment(t);
  await writeFile(path.join(source, 'ChatGPT.exe'), 'CLI without an Electron integrity resource');
  const result = await inspect(source);
  assert.equal(result.executable, 'Codex.exe');
});
test('ignores a mismatched named EXE and preserves the selected executable through repair and restore', async t => {
  const { source, manager } = await environment(t);
  const desktop = await readFile(path.join(source, 'Codex.exe'));
  await writeFile(path.join(source, 'ChatGPT.exe'), desktop);
  await writeFile(path.join(source, 'Codex.exe'), executable(sha256('different archive')));
  const result = await inspect(source);
  assert.equal(result.executable, 'ChatGPT.exe');
  const record = await manager.install(result);
  assert.equal(path.basename(await manager.launchPath(record.id)), 'ChatGPT.exe');
  assert.equal((await manager.restore(record.id)).status, 'restored');
});
test('refuses two executables that both match the ASAR and reports the filenames', async t => {
  const { source } = await environment(t);
  await writeFile(path.join(source, 'ChatGPT.exe'), await readFile(path.join(source, 'Codex.exe')));
  const messages: string[] = [];
  await assert.rejects(() => inspect(source, message => messages.push(message)), /多个.*Codex\.exe.*ChatGPT\.exe|多个.*ChatGPT\.exe.*Codex\.exe/);
  assert.ok(messages.some(message => message.includes('Codex.exe') && message.includes('ChatGPT.exe')));
});
test('reports why each recognized executable was rejected when none match', async t => {
  const { source } = await environment(t);
  await writeFile(path.join(source, 'Codex.exe'), 'launcher without an Electron integrity resource');
  await writeFile(path.join(source, 'ChatGPT.exe'), executable(sha256('other archive')));
  await assert.rejects(() => inspect(source), error => {
    assert.ok(error instanceof Error);
    assert.match(error.message, /未找到.*完整性匹配/);
    assert.match(error.message, /Codex\.exe.*不是有效的 Windows EXE/);
    assert.match(error.message, /ChatGPT\.exe.*哈希不一致/);
    return true;
  });
});
test('source update between inspection and install is rejected', async t => {
  const { source, manager } = await environment(t); const before = await inspect(source);
  await fixture(source, { 'untouched.txt': 'updated' }); await assert.rejects(() => manager.install(before), /检测后发生变化/);
});
test('source update makes the previous copy stale', async t => {
  const { source, manager } = await environment(t); const result = await manager.install(await inspect(source));
  await fixture(source, { 'untouched.txt': 'updated' }); await assert.rejects(() => manager.launchPath(result.id), /已更新/);
});
test('corrupt backup blocks restore', async t => {
  const { source, storage, manager } = await environment(t); const result = await manager.install(await inspect(source));
  await writeFile(path.join(storage, result.id, 'originals/app.asar'), 'broken');
  await assert.rejects(() => manager.restore(result.id), /备份校验失败/);
  assert.equal((await manager.list())[0].status, 'ready');
});
test('partial restore is non-launchable and can be resumed', async t => {
  const { source, storage, manager } = await environment(t); const result = await manager.install(await inspect(source));
  result.status = 'restoring'; await writeFile(path.join(storage, result.id, 'manifest.json'), JSON.stringify(result));
  await writeFile(path.join(storage, result.id, 'app/Codex.exe'), 'partially restored');
  await assert.rejects(() => manager.launchPath(result.id), /恢复/);
  assert.equal((await manager.restore(result.id)).status, 'restored');
});
test('aborts if a process starts during repair and removes staging files', async t => {
  const { source, storage } = await environment(t); let calls = 0;
  const manager = new RepairManager(storage, () => {}, async () => { if (++calls === 2) throw new Error('running'); });
  const before = await inspect(source); await assert.rejects(() => manager.install(before), /running/);
  assert.deepEqual(await readdir(storage), []); assert.equal(await hashFile(path.join(source, 'resources/app.asar')), before.sourceHash);
});
test('refuses links and rejects traversal in IDs', async t => {
  const { source, manager } = await environment(t); const before = await inspect(source);
  await assert.rejects(() => manager.restore('../../original'), /无效/);
  if (process.platform !== 'win32') { await symlink(os.tmpdir(), path.join(source, 'external')); await assert.rejects(() => manager.install(before), /符号链接/); }
});
test('PE patch changes only the 64-byte integrity value', () => {
  const oldHash = sha256('old'), newHash = sha256('new'), before = executable(oldHash), resource = integrityResource(before);
  const after = patchExecutable(before, oldHash, newHash); assert.equal(after.length, before.length);
  assert.deepEqual(after.subarray(0, resource.hashOffset), before.subarray(0, resource.hashOffset));
  assert.deepEqual(after.subarray(resource.hashOffset + 64), before.subarray(resource.hashOffset + 64));
  assert.equal(integrityResource(after).hash, newHash);
  assert.throws(() => patchExecutable(before, newHash, oldHash), /不匹配/);
});
test('malformed and unsupported executables fail closed', () => {
  assert.throws(() => integrityResource(Buffer.from('not PE')));
  const bytes = executable(sha256('header')); bytes.writeUInt16LE(0xaa64, 0x84); assert.throws(() => integrityResource(bytes), /x64/);
  const truncated = executable(sha256('header')).subarray(0, 200); assert.throws(() => integrityResource(truncated));
});
