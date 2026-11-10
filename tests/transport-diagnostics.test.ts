import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, utimes } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { browserTransportChecks, desktopTransportChecks, transportLogSummary } from '../src/core/transport-diagnostics';

async function fixture(t: any) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'nofy-transport-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

test('separates native startup failure from browser feature gates and does not export arbitrary log text', () => {
  const result = transportLogSummary('secret=fixture\ncomputer-use native pipe startup failed reason=missing-helper-path\nbrowser_use_availability_resolved available=false reason=statsig-disabled token=private\n');
  assert.match(result.native!, /missing-helper-path/);
  assert.match(result.browser!, /statsig-disabled/);
  assert.ok(!JSON.stringify(result).includes('private'));
  assert.ok(!JSON.stringify(result).includes('secret'));
  const ready = transportLogSummary('computer-use native pipe startup failed\ncomputer-use native pipe startup ready');
  assert.match(ready.native!, /历史启动成功/);
  assert.equal(ready.browser, undefined);
});

test('reads newest non-empty log evidence and labels it historical, without accepting old startup as live success', async t => {
  const dir = await fixture(t), logs = path.join(dir, 'Codex/Logs/2026/11/10');
  await mkdir(logs, { recursive: true });
  const old = path.join(logs, 'old.log'), recent = path.join(logs, 'recent.log');
  await writeFile(old, 'computer-use native pipe startup ready\n');
  await utimes(old, new Date(0), new Date(0));
  await writeFile(recent, 'computer-use native pipe startup failed missing-helper-path\nbrowser_use_availability_resolved reason=config-requirement-disabled\n');
  await writeFile(path.join(logs, 'running.log'), '');
  const checks = await desktopTransportChecks(dir);
  assert.match(checks.find(c => c.name === 'Native pipe 最近日志')!.detail, /missing-helper-path/);
  assert.match(checks.find(c => c.name === 'Browser Use 最近日志')!.detail, /config-requirement-disabled/);
  assert.ok(checks.every(c => c.warning && !c.ok));
  assert.match(checks[0].detail, /本次副本/);
});

test('missing log evidence remains unknown for both transports', async t => {
  const checks = await desktopTransportChecks(await fixture(t));
  assert.equal(checks.length, 2);
  assert.ok(checks.every(c => !c.ok && /不是通过结论/.test(c.detail)));
});

test('uses the actual registry manifest path and reports stale Chrome paths independently of native pipe', async t => {
  const dir = await fixture(t), codexHome = path.join(dir, '.codex'), custom = path.join(dir, 'registered');
  await mkdir(codexHome); await mkdir(custom);
  const host = path.join(custom, 'host.exe'), manifest = path.join(custom, 'host.json');
  await writeFile(host, 'fixture');
  await writeFile(manifest, JSON.stringify({ name: 'com.openai.codexextension', type: 'stdio', path: 'host.exe' }));
  const state = JSON.stringify({ schemaVersion: 2, entries: [{ schemaVersion: 2, paths: {
    extensionHostPath: host, codexCliPath: host, nodePath: host, browserClientPath: path.join(custom, 'missing.mjs'),
  } }] });
  await writeFile(path.join(codexHome, 'chrome-native-hosts.json'), state);
  const checks = await browserTransportChecks(codexHome, dir, async () => manifest);
  assert.equal(checks.find(c => c.name === 'Chrome Native Messaging')?.ok, true);
  assert.match(checks.find(c => c.name === 'Chrome Native Messaging')!.detail, /尚未验证/);
  assert.match(checks.find(c => c.name === 'Chrome 主机路径记录')!.detail, /1 个缺失/);
  assert.equal(await readFile(path.join(codexHome, 'chrome-native-hosts.json'), 'utf8'), state);
});

test('unrecognized host state and missing registry do not trigger any repair or readiness claim', async t => {
  const dir = await fixture(t);
  await writeFile(path.join(dir, 'chrome-native-hosts.json'), '{"schemaVersion":99,"entries":[]}');
  const checks = await browserTransportChecks(dir, dir, async () => undefined);
  assert.ok(checks.every(c => c.warning && !c.ok));
  assert.match(checks[0].detail, /其他注册位置或 Edge 未核验/);
});
