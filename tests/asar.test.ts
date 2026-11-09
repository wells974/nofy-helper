import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import * as officialAsar from '@electron/asar';
import { planArchive, writeArchivePatch } from '../src/core/asar';
import { sha256 } from '../src/core/hash';
import { archive, provider } from './fixtures';

test('round-trips archives produced by official @electron/asar, including unpacked payload', async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'nofy-official-asar-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const src = path.join(dir, 'source'), target = path.join(dir, 'app.asar');
  await mkdir(path.join(src, 'webview/assets/async'), { recursive: true });
  await writeFile(path.join(src, 'package.json'), '{"name":"codex","version":"1.0"}');
  await writeFile(path.join(src, 'webview/assets/async/123.js'), provider);
  await writeFile(path.join(src, 'webview/assets/zh-CN-a.js'), 'export default {"new":"新聊天"};');
  await writeFile(path.join(src, 'native.bin'), Buffer.from([0, 255, 3, 8]));
  await officialAsar.createPackageWithOptions(src, target, { unpack: '*.bin' });
  const originalHeader = officialAsar.getRawHeader(target).headerString;
  const plan = await planArchive(target); assert.equal(sha256(plan.archive.raw), sha256(originalHeader));
  const newHash = await writeArchivePatch(target, plan);
  officialAsar.uncache(target);
  assert.equal(sha256(officialAsar.getRawHeader(target).headerString), newHash);
  assert.equal(officialAsar.extractFile(target, 'webview/assets/async/123.js').toString(), plan.modified.toString());
  assert.equal(officialAsar.extractFile(target, 'package.json').toString(), '{"name":"codex","version":"1.0"}');
  assert.deepEqual(await readFile(`${target}.unpacked/native.bin`), Buffer.from([0, 255, 3, 8]));
});
test('supports numeric locale chunks but refuses a registry without actual Chinese resources', async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'nofy-catalog-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const target = path.join(dir, 'app.asar');
  const base = { 'package.json': '{"name":"codex"}', 'webview/assets/async/1.js': provider };
  await writeFile(target, archive({ ...base, 'webview/assets/async/2.js': 'export default ' + JSON.stringify({ new: '新聊天', settings: '设置', ...Object.fromEntries(Array.from({ length: 110 }, (_, i) => [`key${i}`, '中文翻译'])) }) }).bytes);
  assert.equal((await planArchive(target)).translationFiles, 1);
  await writeFile(target, archive({ ...base, 'webview/assets/async/2.js': 'const locale="zh-CN";' }).bytes);
  await assert.rejects(() => planArchive(target), /中文界面资源/);
});
