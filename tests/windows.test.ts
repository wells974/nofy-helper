import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { discover } from '../src/windows';

async function environment(t: TestContext) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'nofy-discovery-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}
async function installation(root: string, executable = 'Codex.exe') {
  await mkdir(path.join(root, 'resources'), { recursive: true });
  await writeFile(path.join(root, 'resources', 'app.asar'), 'discovery only');
  await writeFile(path.join(root, executable), 'discovery only');
  return root;
}
const options = { platform: 'win32' as const, env: {}, query: async () => '[]' };
function queries(store: unknown, registry: unknown = []) {
  return async (script: string) => JSON.stringify(script.includes('Get-AppxPackage') ? store : registry);
}

test('discovers Store packages at their root, app or bin directory', async t => {
  const dir = await environment(t);
  const packages = [];
  const expected = [];
  for (const [index, subfolder] of ['', 'app', 'bin'].entries()) {
    const root = path.join(dir, `包 ${index}`);
    expected.push(await installation(path.join(root, subfolder)));
    packages.push({ Name: `OpenAI.Codex${index}`, InstallLocation: root });
  }
  const found = await discover({ ...options, query: queries(packages) });
  assert.deepEqual(found.map(item => item.path), expected);
  assert.ok(found.every(item => item.label.includes('Microsoft Store')));
});

test('accepts singleton PowerShell JSON and ignores empty package locations', async t => {
  const root = await installation(path.join(await environment(t), 'Codex'));
  assert.equal((await discover({ ...options, query: queries({ Name: 'Codex', InstallLocation: root }) }))[0]?.path, root);
  assert.deepEqual(await discover({ ...options, query: queries([null, {}, { InstallLocation: ' ' }]) }), []);
});

test('discovers custom registry paths and quoted App Paths executables, without duplicates', async t => {
  const root = await installation(path.join(await environment(t), '自定义 安装', 'app'), 'ChatGPT.exe');
  const query = queries([{ Name: 'ChatGPT', InstallLocation: path.dirname(root) }], [
    { Name: 'ChatGPT', InstallLocation: `"${path.join(root, 'ChatGPT.exe')}"` },
    { Name: 'ChatGPT', InstallLocation: root },
  ]);
  assert.deepEqual((await discover({ ...options, query })).map(item => item.path), [root]);
});

test('finds local installs after both PowerShell sources fail and reports the failures', async t => {
  const dir = await environment(t);
  const expected = await installation(path.join(dir, 'Programs', 'Codex'));
  const messages: string[] = [];
  const found = await discover({ ...options, env: { LOCALAPPDATA: dir }, query: async () => { throw new Error('blocked'); }, report: message => messages.push(message) });
  assert.deepEqual(found.map(item => item.path), [expected]);
  assert.equal(messages.length, 2);
  assert.ok(messages.every(message => message.includes('blocked')));
});

test('finds direct LocalAppData installs and the newest valid version directory', async t => {
  const dir = await environment(t);
  const older = await installation(path.join(dir, 'Codex', 'app-2.9.0'));
  const newest = await installation(path.join(dir, 'Codex', 'app-2.10.0'));
  await mkdir(path.join(dir, 'Codex', 'app-3.0.0'), { recursive: true });
  const chatgpt = await installation(path.join(dir, 'ChatGPT'), 'chatgpt.exe');
  const found = await discover({ ...options, env: { LOCALAPPDATA: dir } });
  assert.deepEqual(found.map(item => item.path), [newest, chatgpt]);
  assert.ok(!found.some(item => item.path === older));
});

test('falls back to readable WindowsApps directories on Store query failure', async t => {
  const dir = await environment(t);
  const expected = await installation(path.join(dir, 'WindowsApps', 'OpenAI.Codex_1.0_x64__test'));
  await installation(path.join(dir, 'WindowsApps', 'OtherApp_1.0'));
  const found = await discover({ ...options, env: { ProgramFiles: dir }, query: async () => { throw new Error('Appx unavailable'); } });
  assert.deepEqual(found.map(item => item.path), [expected]);
});

test('malformed Store output does not block registry discovery', async t => {
  const root = await installation(path.join(await environment(t), 'Codex'));
  const query = async (script: string) => script.includes('Get-AppxPackage') ? 'invalid JSON' : JSON.stringify([{ Name: 'Codex', InstallLocation: root }]);
  assert.equal((await discover({ ...options, query }))[0]?.path, root);
});

test('rejects resource-only directories, ASAR directories and CLI installs', async t => {
  const dir = await environment(t);
  const noExe = path.join(dir, 'no-exe');
  await mkdir(path.join(noExe, 'resources'), { recursive: true });
  await writeFile(path.join(noExe, 'resources', 'app.asar'), 'no desktop executable');
  const noArchive = path.join(dir, 'cli');
  await mkdir(noArchive);
  await writeFile(path.join(noArchive, 'codex.exe'), 'CLI');
  const archiveDirectory = path.join(dir, 'archive-directory');
  await mkdir(path.join(archiveDirectory, 'resources', 'app.asar'), { recursive: true });
  await writeFile(path.join(archiveDirectory, 'Codex.exe'), 'not an archive');
  const query = queries([noExe, noArchive, archiveDirectory].map(InstallLocation => ({ InstallLocation })));
  assert.deepEqual(await discover({ ...options, query }), []);
});

test('does not query Windows sources on other platforms', async () => {
  assert.deepEqual(await discover({ platform: 'darwin', query: async () => { throw new Error('must not run'); } }), []);
});
