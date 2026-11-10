import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, realpath, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { ComputerUseRuntime, pluginCommandError, type CliRunner } from '../src/core/computer-use-runtime';

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
    assert.ok(!args.includes('-c'), 'use the configured reserved marketplace, never replace its source');
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
test('missing default cache is advisory when the official CLI confirms installation, while changed native files block preparation', async t => {
  const e = await environment(t); await e.runtime.prepare();
  await rm(path.join(e.home, 'plugins'), { recursive: true });
  const status = await e.runtime.status();
  assert.equal(status.ready, true);
  assert.ok(status.checks.some(check => check.name === '插件文件诊断' && check.warning));
  await e.runtime.prepare(); assert.equal(e.additions(), 1, 'do not reinstall an officially enabled plugin solely for an unfamiliar cache layout');
  await writeFile(path.join(e.root, 'resources/cua_node/bin/node.exe'), 'modified');
  assert.equal((await e.runtime.status()).canPrepare, false);
});
test('accepts the reported local marketplace registration and a plugin version different from the packaged descriptor', async t => {
  const e = await environment(t);
  const pluginRoot = path.join(e.home, '.tmp/bundled-marketplaces/openai-bundled/plugins/computer-use');
  const file = path.join(pluginRoot, '.codex-plugin/plugin.json');
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify({ name: 'computer-use', version: '26.1103.32239' }, null, 2));
  const logs: string[] = [];
  const runtime = new ComputerUseRuntime(e.root, e.source, e.folder, e.home, message => logs.push(message), async (_file, args) => {
    assert.ok(!args.includes('add'), 'installed and enabled plugins must not be registered again');
    return JSON.stringify({ installed: [
      { pluginId: 'unified-computer-use@openai-bundled', name: 'unified-computer-use', version: '26.1103.32239', installed: true, enabled: true },
      { pluginId: 'computer-use@openai-bundled', name: 'computer-use', marketplaceName: 'openai-bundled', version: '26.1103.32239', installed: true, enabled: true, source: { source: 'local', path: pluginRoot }, marketplaceSource: { sourceType: 'local', source: path.dirname(path.dirname(pluginRoot)) } },
    ], available: [] });
  });
  const status = await runtime.prepare();
  assert.equal(status.ready, true);
  assert.ok(status.checks.find(check => check.name === '插件文件诊断')?.ok);
  assert.ok(status.checks.find(check => check.name === '插件版本提示')?.warning);
  assert.ok(logs.some(message => message.includes('26.1103.32239')));
  assert.equal(status.backup, undefined, 'inspection must not create a config backup or change configuration');
  assert.equal(await readFile(path.join(e.home, 'config.toml'), 'utf8'), e.original);
});
test('cache descriptor JSON formatting does not invalidate an enabled plugin', async t => {
  const e = await environment(t); await e.runtime.prepare();
  const cached = path.join(e.home, 'plugins/cache/openai-bundled/computer-use/1.0/.codex-plugin/plugin.json');
  await writeFile(cached, '\uFEFF' + JSON.stringify({ version: '1.0', name: 'computer-use', description: 'normalized by CLI' }, null, 2));
  const status = await e.runtime.status();
  assert.equal(status.ready, true);
  assert.equal(status.checks.find(check => check.name === '插件文件诊断')?.ok, true);
});
test('reports an actually missing or disabled plugin separately from advisory cache details', async t => {
  const e = await environment(t);
  const missing = await e.runtime.status();
  assert.equal(missing.ready, false); assert.equal(missing.canPrepare, true);
  assert.match(missing.checks.find(check => check.name === 'Computer Use 插件')!.detail, /尚未安装/);
  const disabled = new ComputerUseRuntime(e.root, e.source, e.folder, e.home, undefined, async () => JSON.stringify({ installed: [{ pluginId: 'computer-use@openai-bundled', installed: true, enabled: false, version: '1.0' }] }));
  const status = await disabled.status();
  assert.equal(status.ready, false); assert.equal(status.canPrepare, true);
  assert.match(status.checks.find(check => check.name === 'Computer Use 插件')!.detail, /已安装但未启用/);
  assert.equal(status.checks.some(check => check.name === '插件文件诊断'), false);
});

test('cleans stale pipe config even when the plugin is already enabled, with a reversible backup and no reinstall', async t => {
  const e = await environment(t);
  const original = e.original + `[mcp_servers.node_repl.env]\nSKY_CUA_NATIVE_PIPE = "1"\nSKY_CUA_NATIVE_PIPE_DIRECTORY = '\\\\.\\pipe\\codex-computer-use-old'\nOTHER = "keep"\n`;
  await writeFile(path.join(e.home, 'config.toml'), original);
  const runtime = new ComputerUseRuntime(e.root, e.source, e.folder, e.home, undefined, async (_file, args) => {
    assert.ok(!args.includes('add'));
    return JSON.stringify({ installed: [{ pluginId: 'computer-use@openai-bundled', installed: true, enabled: true, version: '1.0' }] });
  }, async () => 'missing');
  const before = await runtime.status();
  assert.equal(before.ready, false); assert.equal(before.canPrepare, true);
  const after = await runtime.prepare();
  assert.equal(after.ready, true);
  assert.equal(await readFile(after.backup!, 'utf8'), original);
  const cleaned = await readFile(path.join(e.home, 'config.toml'), 'utf8');
  assert.ok(!cleaned.includes('SKY_CUA_NATIVE_PIPE')); assert.ok(cleaned.includes('OTHER = "keep"'));
  assert.equal((await runtime.prepare()).backup, after.backup);
  await runtime.restoreConfig();
  assert.equal(await readFile(path.join(e.home, 'config.toml'), 'utf8'), original);
});

test('an unreadable pipe check blocks cleanup without backing up or overwriting config', async t => {
  const e = await environment(t);
  const original = `[mcp_servers.node_repl.env]\nSKY_CUA_NATIVE_PIPE = "1"\nSKY_CUA_NATIVE_PIPE_DIRECTORY = '\\\\.\\pipe\\codex-computer-use-current'\n`;
  await writeFile(path.join(e.home, 'config.toml'), original);
  const runtime = new ComputerUseRuntime(e.root, e.source, e.folder, e.home, undefined, e.runner, async () => 'unknown');
  assert.equal((await runtime.status()).canPrepare, false);
  await assert.rejects(() => runtime.prepare(), /配置检查/);
  assert.equal(await readFile(path.join(e.home, 'config.toml'), 'utf8'), original);
  assert.equal((await runtime.status()).backup, undefined);
});

test('uses the real configured marketplace rather than an override that silently hides installed plugins', async t => {
  const e = await environment(t);
  const observed: string[][] = [];
  const runtime = new ComputerUseRuntime(e.root, e.source, e.folder, e.home, undefined, async (_file, args) => {
    observed.push(args);
    if (args.includes('-c')) return '{"installed":[],"available":[]}';
    assert.ok(!args.includes('add'), 'a registered plugin must not be reinstalled');
    return JSON.stringify({ installed: ['computer-use', 'browser', 'chrome', 'unified-computer-use'].map(name => ({ pluginId: `${name}@openai-bundled`, installed: true, enabled: true, version: '26.1103.32239' })) });
  });
  const status = await runtime.prepare();
  assert.equal(status.ready, true);
  assert.deepEqual(observed, [['plugin', 'list', '--marketplace', 'openai-bundled', '--json']]);
  assert.equal(await readFile(path.join(e.home, 'config.toml'), 'utf8'), e.original);
});

test('browser combination installs only missing browser plugins using the existing marketplace', async t => {
  const e = await environment(t), installed = new Set(['computer-use', 'chrome']);
  for (const name of ['browser', 'chrome']) for (const root of [e.root, e.source]) {
    const file = path.join(root, `resources/plugins/openai-bundled/plugins/${name}/.codex-plugin/plugin.json`);
    await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, JSON.stringify({ name, version: '1.0' }));
  }
  const added: string[] = [];
  const runtime = new ComputerUseRuntime(e.root, e.source, e.folder, e.home, undefined, async (_file, args) => {
    assert.ok(!args.includes('-c'));
    if (args.includes('add')) { const name = args[2].split('@')[0]; added.push(name); installed.add(name); return '{}'; }
    return JSON.stringify({ installed: [...installed].map(name => ({ pluginId: `${name}@openai-bundled`, installed: true, enabled: true, version: '1.0' })) });
  }, undefined, true);
  assert.equal((await runtime.status()).ready, false);
  assert.equal((await runtime.prepare()).ready, true);
  assert.deepEqual(added, ['browser']);
});

test('CLI failures include the exit code and useful stderr while masking common credentials', () => {
  const error = pluginCommandError({ code: 2, stderr: 'plugin not found in marketplace openai-bundled\napi_key="private-key"\nAuthorization: Bearer private-token\nhttps://user:password@example.com\nsk-test-secret' });
  assert.match(error.message, /退出码 2/); assert.match(error.message, /plugin not found in marketplace/);
  for (const secret of ['private-key', 'private-token', 'user:password', 'sk-test-secret']) assert.ok(!error.message.includes(secret));
});
