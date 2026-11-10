import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { queryPowerShell } from '../src/powershell';
import { probeNativePipe } from '../src/core/native-pipe';
import { withEnvironment } from '../src/core/process-env';

// These run in the existing windows-latest CI job, not simulated on macOS.
test('Windows PowerShell preserves Chinese paths and treats spaces/metacharacters literally', { skip: process.platform !== 'win32' }, async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'nofy-中文 '));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, "主机 [1] $literal 'quote'.json");
  await writeFile(file, '{}');
  const output = await queryPowerShell("if (!(Test-Path -LiteralPath $env:NOFY_TEST_FILE)) { throw 'file missing' }; $env:NOFY_TEST_FILE",
    { env: withEnvironment(process.env, { NOFY_TEST_FILE: file }) });
  assert.equal(output, file);
});

test('Windows native pipe probe distinguishes a real listening pipe from a closed pipe without connecting', { skip: process.platform !== 'win32' }, async t => {
  const pipe = String.raw`\\.\pipe\codex-computer-use-nofy-test-${randomUUID()}`;
  const server = createServer(socket => { socket.destroy(); });
  let connections = 0;
  server.on('connection', () => { connections++; });
  t.after(() => { if (server.listening) server.close(); });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(pipe, resolve); });
  assert.equal(await probeNativePipe(pipe), 'active');
  assert.equal(connections, 0, 'probing must not consume a native service connection');
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  assert.equal(await probeNativePipe(pipe), 'missing');
});
