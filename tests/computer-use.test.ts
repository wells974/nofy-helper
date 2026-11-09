import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { computerUseFixture, availability, runtime } from './computer-use-fixtures';
import { provider } from './fixtures';
import { inspect, RepairManager } from '../src/core/manager';
import { readArchive, entries, readEntry, verifyIntegrity } from '../src/core/asar';
import { hashFile } from '../src/core/hash';

async function environment(t: any) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'nofy-cua-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return { root: path.join(dir, 'official'), storage: path.join(dir, 'repairs') };
}
async function moduleAt(file: string, member: string): Promise<any> {
  const archive = await readArchive(file), entry = entries(archive.header).find(([name]) => name === member)![1];
  return import(`data:text/javascript;base64,${(await readEntry(archive, entry)).toString('base64')}`);
}
test('combined repair opens targeted CUA gates, inherits trusted roots, preserves host checks, and fully restores', async t => {
  const { root, storage } = await environment(t); await computerUseFixture(root);
  const manager = new RepairManager(storage), source = await inspect(root);
  assert.equal(source.computerUse?.supported, true);
  const before = await readFile(path.join(root, 'resources/app.asar'));
  const record = await manager.install(source, { computerUse: true });
  const file = path.join(storage, record.id, 'app/resources/app.asar');
  assert.ok((await readFile(file)).length > before.length, 'expanded bootstrap is stored with updated archive offsets');
  const app = await moduleAt(file, 'webview/availability.js');
  assert.equal(app.availability(), 'available');
  assert.equal(app.availability({ enabled: false }), 'disabled');
  assert.equal(app.availability({ platform: false }), 'unsupported-platform');
  assert.equal(app.availability({ pending: true }), 'loading');
  assert.equal(app.availability({ windowType: 'chrome-extension' }), 'window-type-disabled');
  const gates = await moduleAt(file, 'webview/runtime.js');
  assert.equal(gates.runtime, true); assert.equal(gates.restricted, false); assert.equal(gates.unrelated, false);
  assert.deepEqual(gates.calls, ['1892382740', '337408568', 'unrelated'], 'original feature hooks still run');
  const bootstrap = await moduleAt(file, '.vite/build/early-bootstrap.js');
  const previous = process.env.NODE_REPL_TRUSTED_CODE_PATHS;
  try {
    process.env.NODE_REPL_TRUSTED_CODE_PATHS = 'helper-root';
    assert.equal(bootstrap.launchEnv('native-root', 'cache-root').NODE_REPL_TRUSTED_CODE_PATHS, 'native-root;cache-root;helper-root');
  } finally { if (previous === undefined) delete process.env.NODE_REPL_TRUSTED_CODE_PATHS; else process.env.NODE_REPL_TRUSTED_CODE_PATHS = previous; }
  assert.equal((await manager.launchSpec(record.id)).computerUse, true);
  const archive = await readArchive(file);
  for (const [, entry] of entries(archive.header)) verifyIntegrity(await readEntry(archive, entry), entry);
  assert.deepEqual(await readFile(path.join(root, 'resources/app.asar')), before);
  await manager.restore(record.id);
  assert.deepEqual(await readFile(file), before);
});
test('language-only repair leaves CUA gates unchanged and old manifests still load', async t => {
  const { root, storage } = await environment(t); await computerUseFixture(root);
  const manager = new RepairManager(storage), record = await manager.install(await inspect(root));
  const file = path.join(storage, record.id, 'app/resources/app.asar');
  assert.equal((await moduleAt(file, 'webview/runtime.js')).runtime, false);
  const manifest = path.join(storage, record.id, 'manifest.json');
  const saved = JSON.parse(await readFile(manifest, 'utf8')); delete saved.features;
  await writeFile(manifest, JSON.stringify(saved));
  assert.equal((await manager.list()).length, 1);
  assert.equal((await manager.launchSpec(record.id)).computerUse, false);
});
test('Chinese and CUA patches can share a single archive member', async t => {
  const { root, storage } = await environment(t);
  await computerUseFixture(root, { 'webview/assets/async/provider.js': runtime + '\nconst config={get:()=>false};' + provider + availability, 'webview/availability.js': '', 'webview/runtime.js': '' });
  const manager = new RepairManager(storage), record = await manager.install(await inspect(root), { computerUse: true });
  const file = path.join(storage, record.id, 'app/resources/app.asar');
  const app = await moduleAt(file, 'webview/assets/async/provider.js');
  assert.equal(app.enabled, true); assert.equal(app.availability(), 'available');
  assert.equal(app.runtime, true); assert.equal(app.restricted, false); assert.equal(app.calls.length, 3);
});
test('unknown versions and duplicate runtime gates refuse CUA without changing the source', async t => {
  const { root, storage } = await environment(t);
  const manager = new RepairManager(storage);
  const variations: Record<string, string>[] = [
    { 'package.json': '{"name":"codex","version":"26.1201.0"}' },
    { 'webview/duplicate.js': runtime },
    { 'webview/availability.js': availability.replace('isComputerUseGateEnabled:gate', 'isComputerUseGateEnabled:!0') },
    { '.vite/build/early-bootstrap.js': 'export const changed=true;' },
  ];
  for (const extra of variations) {
    await computerUseFixture(root, extra);
    const source = await inspect(root), before = await hashFile(path.join(root, 'resources/app.asar'));
    assert.equal(source.computerUse?.supported, false);
    await assert.rejects(() => manager.install(source, { computerUse: true }), /Computer Use|Node REPL/);
    assert.equal(await hashFile(path.join(root, 'resources/app.asar')), before);
  }
});
