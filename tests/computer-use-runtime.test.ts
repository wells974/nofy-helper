import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, realpath, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { ComputerUseRuntime, type CliRunner } from '../src/core/computer-use-runtime';

async function environment(t: any) {
  const dir = await realpath(await mkdtemp(path.join(os.tmpdir(), 'nofy-cua-runtime-')));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const root = path.join(dir, 'copy'), source = path.join(dir, 'official'), home = path.join(dir, '.codex');
  await mkdir(home);
  const original = 'model_provider = "my-provider"\n# preserve this comment\n[model_providers.my-provider]\nbase_url = "https://example.com/v1"\n';
  await writeFile(path.join(home, 'config.toml'), original);
  for (const relative of ['codex.exe', 'cua_node/bin/node.exe', 'cua_node/bin/node_repl.exe', 'cua_node/bin/node_modules/@oai/cua-repl/bin/cua-repl.mjs', 'cua_node/bin/node_modules/@oai/sky/package.json', 'cua_node/bin/node_modules/@oai/sky/bin/windows/codex-computer-use.exe', 'plugins/openai-bundled/.agents/plugins/marketplace.json', 'plugins/openai-bundled/plugins/computer-use/.codex-plugin/plugin.json']) {
    for (const base of [root, source]) {
      const file = path.join(base, 'resources', relative); await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, relative.endsWith('plugin.json') ? '{"name":"computer-use","version":"1.0"}' : 'same official runtime');
    }
  }
  let installed = false, additions = 0;
  const runner: CliRunner = async (file, args, env) => {
    assert.equal(file, path.join(root, 'resources/codex.exe'));
    assert.equal(env.CODEX_HOME, home);
    assert.ok(args.includes('marketplaces.openai-bundled.source_type="local"'));
    if (args.includes('add')) {
      assert.ok(args.includes('computer-use@openai-bundled'));
      assert.ok(!args.some(arg => arg.includes('chrome@') || arg.includes('browser@')));
      additions++; installed = true;
      await writeFile(path.join(home, 'config.toml'), original + '\n[plugins."computer-use@openai-bundled"]\nenabled = true\n');
      const cached = path.join(home, 'plugins/cache/openai-bundled/computer-use/1.0/.codex-plugin/plugin.json');
      await mkdir(path.dirname(cached), { recursive: true });
      await writeFile(cached, '{"name":"computer-use","version":"1.0"}');
      return '{}';
    }
    return JSON.stringify({ installed: installed ? [{ pluginId: 'computer-use@openai-bundled', installed: true, enabled: true, version: '1.0' }] : [] });
  };
  const folder = path.join(dir, 'record');
  return { root, source, home, folder, original, runner, additions: () => additions, runtime: new ComputerUseRuntime(root, source, folder, home, undefined, runner) };
}
test('prepares through the matching official CLI, backs up config, verifies, and restores exact original bytes', async t => {
  const e = await environment(t);
  assert.equal((await e.runtime.status()).ready, false);
  const result = await e.runtime.prepare(); assert.equal(result.ready, true);
  assert.equal(await readFile(result.backup!, 'utf8'), e.original);
  assert.ok((await readFile(path.join(e.home, 'config.toml'), 'utf8')).startsWith(e.original));
  await e.runtime.prepare(); assert.equal(e.additions(), 1, 'ready plugin must not be reinstalled');
  await e.runtime.restoreConfig();
  assert.equal(await readFile(path.join(e.home, 'config.toml'), 'utf8'), e.original);
  assert.equal((await e.runtime.status()).backup, undefined);
});
test('refuses a tampered runtime CLI before executing it', async t => {
  const e = await environment(t); await writeFile(path.join(e.root, 'resources/codex.exe'), 'changed');
  const runtime = new ComputerUseRuntime(e.root, e.source, e.folder, e.home, undefined, async () => { throw new Error('must not execute'); });
  const status = await runtime.status(); assert.equal(status.canPrepare, false);
  await assert.rejects(() => runtime.prepare(), /CLI 校验失败/);
  assert.equal(await readFile(path.join(e.home, 'config.toml'), 'utf8'), e.original);
});
test('configuration changed after preparation is preserved and its original backup remains available', async t => {
  const e = await environment(t), status = await e.runtime.prepare();
  const edited = '# user edited after preparation\n'; await writeFile(path.join(e.home, 'config.toml'), edited);
  await assert.rejects(() => e.runtime.restoreConfig(), /已被修改，未覆盖/);
  assert.equal(await readFile(path.join(e.home, 'config.toml'), 'utf8'), edited);
  assert.equal(await readFile(status.backup!, 'utf8'), e.original);
});
test('a failed plugin command leaves a recoverable configuration backup', async t => {
  const e = await environment(t);
  const runner: CliRunner = async (file, args, env) => {
    const result = await e.runner(file, args, env);
    if (args.includes('add')) throw new Error('installation interrupted');
    return result;
  };
  const runtime = new ComputerUseRuntime(e.root, e.source, e.folder, e.home, undefined, runner);
  await assert.rejects(() => runtime.prepare(), /installation interrupted/);
  await runtime.restoreConfig();
  assert.equal(await readFile(path.join(e.home, 'config.toml'), 'utf8'), e.original);
});
test('restores absence when config.toml did not exist before preparation', async t => {
  const e = await environment(t); await rm(path.join(e.home, 'config.toml'));
  await e.runtime.prepare(); await e.runtime.restoreConfig();
  await assert.rejects(() => readFile(path.join(e.home, 'config.toml')), { code: 'ENOENT' });
});
test('retry after failed preparation retains the first configuration backup', async t => {
  const e = await environment(t);
  let fail = true;
  const runtime = new ComputerUseRuntime(e.root, e.source, e.folder, e.home, undefined, async (file, args, env) => {
    const result = await e.runner(file, args, env);
    if (args.includes('add') && fail) { fail = false; await rm(path.join(e.home, 'plugins'), { recursive: true }); throw new Error('interrupted'); }
    return result;
  });
  await assert.rejects(() => runtime.prepare(), /interrupted/);
  const backup = (await runtime.status()).backup;
  assert.equal((await runtime.prepare()).backup, backup);
  await runtime.restoreConfig();
  assert.equal(await readFile(path.join(e.home, 'config.toml'), 'utf8'), e.original);
});
test('missing plugin cache is not reported ready and a changed native runtime is rejected', async t => {
  const e = await environment(t); await e.runtime.prepare();
  await rm(path.join(e.home, 'plugins'), { recursive: true });
  assert.equal((await e.runtime.status()).ready, false);
  await writeFile(path.join(e.root, 'resources/cua_node/bin/node.exe'), 'modified');
  assert.equal((await e.runtime.status()).canPrepare, false);
});
