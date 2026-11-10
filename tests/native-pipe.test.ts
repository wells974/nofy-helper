import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from 'smol-toml';
import { cleanPipeEnvironment, inspectPipeValues, planPipeConfig } from '../src/core/native-pipe';

const pipe = String.raw`\\.\pipe\codex-computer-use-123`;
const env = { SKY_CUA_NATIVE_PIPE: '1', SKY_CUA_NATIVE_PIPE_DIRECTORY: pipe };
const section = `[mcp_servers.node_repl.env]\nSKY_CUA_NATIVE_PIPE = "1"\nSKY_CUA_NATIVE_PIPE_DIRECTORY = '${pipe}'\n`;

test('only absent native pipes are stale; probe failures preserve the address', async () => {
  assert.equal((await inspectPipeValues(env, async () => 'active')).state, 'active');
  assert.equal((await inspectPipeValues(env, async () => 'missing')).state, 'stale');
  assert.equal((await inspectPipeValues(env, async () => 'unknown')).state, 'unknown');
  assert.equal((await inspectPipeValues({}, async () => { throw new Error('must not probe'); })).state, 'absent');
  assert.equal((await inspectPipeValues({ SKY_CUA_NATIVE_PIPE: '1' })).state, 'stale');
});
test('removes only targeted stale overrides, preserving comments, CRLF, BOM, dates, credentials and other MCP servers', async () => {
  const original = '\uFEFF# keep me\r\nlast_updated = 2026-11-10T00:00:00Z\r\n' + section.replaceAll('\n', '\r\n') +
    'HTTP_PROXY = "http://127.0.0.1:1234"\r\nAPI_KEY = "fixture-secret"\r\n[mcp_servers.other.env]\r\nSKY_CUA_NATIVE_PIPE = "custom"\r\n';
  const plan = await planPipeConfig(Buffer.from(original), async () => 'missing');
  assert.equal(plan.state, 'stale');
  const expected = original.replace('SKY_CUA_NATIVE_PIPE = "1"\r\n', '').replace(`SKY_CUA_NATIVE_PIPE_DIRECTORY = '${pipe}'\r\n`, '');
  assert.equal(plan.cleaned?.toString(), expected);
  assert.deepEqual(parse(plan.cleaned!.toString().slice(1)), parse(expected.slice(1)));
});
test('supports quoted TOML segments and keys without rewriting unrelated bytes', async () => {
  const text = `["mcp_servers".'node_repl'.env] # section\n'SKY_CUA_NATIVE_PIPE' = "1" # old\n"SKY_CUA_NATIVE_PIPE_DIRECTORY" = '${pipe}'`;
  const result = await planPipeConfig(Buffer.from(text), async () => 'missing');
  assert.equal(result.cleaned?.toString(), `["mcp_servers".'node_repl'.env] # section\n`);
});
test('keeps active overrides and refuses unsafe inline-table edits or invalid TOML', async () => {
  assert.equal((await planPipeConfig(Buffer.from(section), async () => 'active')).cleaned, undefined);
  const inline = `[mcp_servers.node_repl]\nenv = { SKY_CUA_NATIVE_PIPE = '0' }\n`;
  const result = await planPipeConfig(Buffer.from(inline));
  assert.equal(result.state, 'unknown'); assert.equal(result.cleaned, undefined);
  assert.equal((await planPipeConfig(Buffer.from('[broken'))).state, 'unknown');
});
test('does not remove lookalike keys and section headers embedded in multiline strings', async () => {
  const fake = `instructions = '''\n${section}'''\n`;
  const onlyFake = await planPipeConfig(Buffer.from(fake), async () => { throw new Error('must not probe'); });
  assert.equal(onlyFake.state, 'absent');
  const both = await planPipeConfig(Buffer.from(fake + section), async () => 'missing');
  assert.equal(both.state, 'unknown'); assert.equal(both.cleaned, undefined);
});
test('launch cleanup removes stale child variables only and preserves active or indeterminate values', async () => {
  const input = { ...env, PATH: 'unchanged', HTTP_PROXY: 'unchanged' };
  const missing = await cleanPipeEnvironment(input, async () => 'missing');
  assert.deepEqual(missing.env, { PATH: 'unchanged', HTTP_PROXY: 'unchanged' });
  assert.deepEqual(input, { ...env, PATH: 'unchanged', HTTP_PROXY: 'unchanged' });
  for (const state of ['active', 'unknown'] as const) assert.deepEqual((await cleanPipeEnvironment(input, async () => state)).env, input);
  const lower = { sky_cua_native_pipe: '1', sky_cua_native_pipe_directory: pipe };
  assert.deepEqual((await cleanPipeEnvironment(lower, async () => 'missing')).env, {});
  const conflict = { ...input, sky_cua_native_pipe: '0' };
  assert.equal((await cleanPipeEnvironment(conflict)).check.state, 'unknown');
  assert.deepEqual((await cleanPipeEnvironment(conflict)).env, conflict);
});
