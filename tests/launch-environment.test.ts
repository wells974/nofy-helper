import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { realpath } from 'node:fs/promises';
import { envValue, resolveCodexHome, withEnvironment } from '../src/core/process-env';
import { desktopEnvironment } from '../src/core/launch-environment';
import { runPluginCli } from '../src/core/computer-use-runtime';

test('resolves relative and mixed-case CODEX_HOME before the Desktop changes cwd', async () => {
  const inherited = { codex_home: '自定义 config', PATH: 'keep', electron_run_as_node: '1' };
  const home = resolveCodexHome(inherited), exe = path.resolve('副本/app/ChatGPT.exe');
  const launch = await desktopEnvironment(exe, false, home, inherited);
  assert.equal(home, path.resolve('自定义 config'));
  assert.equal(launch.env.CODEX_HOME, home);
  assert.equal(launch.env.codex_home, undefined);
  assert.equal(envValue(launch.env, 'ELECTRON_RUN_AS_NODE'), undefined);
  assert.equal(launch.env.PATH, 'keep');
  assert.equal(inherited.electron_run_as_node, '1');
});

test('replaces disabled mixed-case CUA flags and retains existing trusted roots without duplicate env keys', async () => {
  const inherited = { Codex_Electron_Enable_Windows_Computer_Use: '0', Node_Repl_Trusted_Code_Paths: 'existing',
    sky_cua_native_pipe: '1', sky_cua_native_pipe_directory: String.raw`\\.\pipe\codex-computer-use-old` };
  const exe = path.resolve('副本/app/ChatGPT.exe');
  const launch = await desktopEnvironment(exe, true, path.resolve('.codex'), inherited, async () => 'missing');
  assert.equal(launch.check?.state, 'stale');
  assert.equal(launch.env.CODEX_ELECTRON_ENABLE_WINDOWS_COMPUTER_USE, '1');
  assert.equal(launch.env.Codex_Electron_Enable_Windows_Computer_Use, undefined);
  assert.equal(launch.env.Node_Repl_Trusted_Code_Paths, undefined);
  assert.equal(envValue(launch.env, 'SKY_CUA_NATIVE_PIPE_DIRECTORY'), undefined);
  assert.equal(launch.env.NODE_REPL_TRUSTED_CODE_PATHS, ['existing',
    path.join(path.dirname(exe), 'resources/cua_node/bin/node_modules'),
    path.join(path.dirname(exe), 'resources/plugins/openai-bundled')].join(path.delimiter));
  assert.equal(inherited.Codex_Electron_Enable_Windows_Computer_Use, '0');
});

test('refuses conflicting configuration homes instead of backing up one and launching another', () => {
  assert.throws(() => resolveCodexHome({ CODEX_HOME: '/a', codex_home: '/b' }), /CODEX_HOME.*大小写冲突/);
  assert.equal(envValue({ CODEX_HOME: '/a', codex_home: '/a' }, 'CODEX_HOME'), '/a');
  assert.deepEqual(withEnvironment({ CodeX_HOME: '/old', PATH: 'keep' }, { CODEX_HOME: '/new' }), { CODEX_HOME: '/new', PATH: 'keep' });
});

test('real CLI child uses its executable directory rather than the helper project cwd', async () => {
  const env = withEnvironment(process.env, { CODEX_HOME: path.resolve('配置目录'), ELECTRON_RUN_AS_NODE: undefined });
  const output = await runPluginCli(process.execPath, ['-e', 'console.log(JSON.stringify({cwd:process.cwd(),home:process.env.CODEX_HOME}))'], env);
  const value = JSON.parse(output);
  assert.equal(await realpath(value.cwd), await realpath(path.dirname(process.execPath)));
  assert.equal(value.home, env.CODEX_HOME);
});
