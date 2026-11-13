import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { computerUseFixture, availability, runtime } from './computer-use-fixtures';
import { provider } from './fixtures';
import { inspect, RepairManager } from '../src/core/manager';
import { entries, readArchive, readEntry, verifyIntegrity } from '../src/core/asar';
import { browserUseSpans } from '../src/core/browser-use-gates';

// Independent executable fixtures for the upstream's named browser availability inputs.
const browser = `
export const browserCalls=[]; const capability=(x,y)=>(browserCalls.push(y.name),{isCapable:false});
export const pane=capability(null,{name:'browser.in-app'}).isCapable;
export function external({pending=false,loading=false,enabled=true,wsl=false,windowType='electron'}={}) {
 if(!enabled)return 'disabled';
 return function({areRequirementsPending:p,isBrowserAndComputerUseAllowed:a,isExternalBrowserUseFeatureEnabled:f,isExternalBrowserUseFeatureLoading:l,isExternalBrowserUseGateEnabled:g,runCodexInWsl:w,windowType:t}) {
  return p?'loading':a?t==='chrome-extension'?'available':l?'loading':f?w?'wsl-disabled':g?'available':'statsig-disabled':'config-requirement-disabled':'config-requirement-disabled';
 }({areRequirementsPending:pending,isBrowserAndComputerUseAllowed:false,isExternalBrowserUseFeatureEnabled:false,isExternalBrowserUseFeatureLoading:loading,isExternalBrowserUseGateEnabled:(browserCalls.push('external'),false),runCodexInWsl:wsl,windowType});
}
export function internal({pending=false,loading=false,enabled=true,browserEnabled=true,wsl=false,windowType='electron'}={}) {
 if(!enabled)return 'disabled';
 return function({areRequirementsPending:p,isBrowserAgentGateEnabled:g,isBrowserAndComputerUseAllowed:a,isBrowserEnabled:b,isBrowserUseEnabled:u,isLoading:l,runCodexInWsl:w,windowType:t}) {
  return t==='chrome-extension'?'window-type-disabled':p?'loading':a?l?'loading':b?g?u?w?'wsl-disabled':'available':'config-requirement-disabled':'statsig-disabled':'browser-pane-disabled':'config-requirement-disabled';
 }({areRequirementsPending:pending,isBrowserAgentGateEnabled:false,isBrowserAndComputerUseAllowed:false,isBrowserEnabled:browserEnabled,isBrowserUseEnabled:false,isLoading:loading,runCodexInWsl:wsl,windowType});
}`;
async function environment(t: any) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'nofy-browser-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return { root: path.join(dir, 'original'), storage: path.join(dir, 'repairs') };
}
async function load(file: string, member: string): Promise<any> {
  const archive = await readArchive(file), entry = entries(archive.header).find(([name]) => name === member)![1];
  return import(`data:text/javascript;base64,${(await readEntry(archive, entry)).toString('base64')}`);
}

test('browser combination preserves WSL, loading and user controls while opening the three observed browser targets', async t => {
  const { root, storage } = await environment(t);
  await computerUseFixture(root, { 'webview/browser.js': runtime + browser, 'webview/runtime.js': '' });
  const manager = new RepairManager(storage), source = await inspect(root);
  assert.equal(source.browserUse?.supported, true, source.browserUse?.reason);
  const original = await readFile(path.join(root, 'resources/app.asar'));
  const record = await manager.install(source, { computerUse: true, browserUse: true });
  assert.equal(record.features?.browserUse, true);
  const file = path.join(storage, record.id, 'app/resources/app.asar'), mod = await load(file, 'webview/browser.js');
  assert.equal(mod.pane, true);
  for (const fn of [mod.external, mod.internal]) {
    assert.equal(fn(), 'available'); assert.equal(fn({ enabled: false }), 'disabled');
    assert.equal(fn({ wsl: true }), 'wsl-disabled'); assert.equal(fn({ pending: true }), 'loading');
    assert.equal(fn({ loading: true }), 'loading');
  }
  assert.equal(mod.internal({ browserEnabled: false }), 'browser-pane-disabled');
  assert.equal(mod.internal({ windowType: 'chrome-extension' }), 'window-type-disabled');
  assert.equal(mod.browserCalls[0], 'browser.in-app');
  assert.ok(mod.browserCalls.includes('external'), 'feature expressions still evaluate');
  const archive = await readArchive(file);
  for (const [, entry] of entries(archive.header)) verifyIntegrity(await readEntry(archive, entry), entry);
  assert.deepEqual(await readFile(path.join(root, 'resources/app.asar')), original);
  await manager.restore(record.id); assert.deepEqual(await readFile(file), original);
});

test('language, CUA, and browser patches compose on a single member and do not depend on the version string', async t => {
  const { root, storage } = await environment(t);
  const member = 'webview/assets/async/provider.js';
  await computerUseFixture(root, { 'package.json': '{"name":"codex","version":"27.1.12345"}',
    [member]: 'const config={get:()=>false};' + provider + availability + runtime + browser,
    'webview/availability.js': '', 'webview/runtime.js': '',
  });
  const manager = new RepairManager(storage), source = await inspect(root);
  assert.equal(source.browserUse?.supported, true);
  const record = await manager.install(source, { computerUse: true, browserUse: true });
  const mod = await load(path.join(storage, record.id, 'app/resources/app.asar'), member);
  assert.equal(mod.enabled, true); assert.equal(mod.availability(), 'available'); assert.equal(mod.runtime, true);
  assert.equal(mod.external(), 'available'); assert.equal(mod.internal(), 'available'); assert.equal(mod.pane, true);
});

test('CUA-only copies and old manifests retain their original browser behavior', async t => {
  const { root, storage } = await environment(t); await computerUseFixture(root, { 'webview/browser.js': runtime + browser, 'webview/runtime.js': '' });
  const manager = new RepairManager(storage), source = await inspect(root);
  const record = await manager.install(source, { computerUse: true });
  const file = path.join(storage, record.id, 'app/resources/app.asar');
  const mod = await load(file, 'webview/browser.js'); assert.equal(mod.pane, false); assert.equal(mod.external(), 'config-requirement-disabled');
  const manifest = path.join(storage, record.id, 'manifest.json'), saved = JSON.parse(await readFile(manifest, 'utf8'));
  delete saved.features.browserUse; await writeFile(manifest, JSON.stringify(saved));
  assert.equal((await manager.list())[0].features?.browserUse, undefined);
});

test('29 browser capability reads select only the upstream CUA feature module and preserve unrelated chunks', async t => {
  const { root, storage } = await environment(t);
  const unrelated = Object.fromEntries(Array.from({ length: 28 }, (_, i) => [
    `webview/assets/async/unrelated-${i}.js`,
    `const capability=()=>({isCapable:false});export const pane=capability(null,{name:'browser.in-app'}).isCapable;const text='1892382740 337408568';`,
  ]));
  const target = 'webview/assets/async/renamed-feature-module.js';
  await computerUseFixture(root, { ...unrelated, [target]: runtime + browser, 'webview/runtime.js': '' });
  const manager = new RepairManager(storage), source = await inspect(root);
  assert.equal(source.computerUse?.supported, true);
  assert.equal(source.browserUse?.supported, true, source.browserUse?.reason);
  assert.deepEqual(source.browserUse?.files, [target]);
  const record = await manager.install(source, { computerUse: true, browserUse: true });
  const file = path.join(storage, record.id, 'app/resources/app.asar'), archive = await readArchive(file);
  for (const [name, entry] of entries(archive.header)) {
    const bytes = await readEntry(archive, entry); verifyIntegrity(bytes, entry);
    if (name in unrelated) assert.equal(bytes.toString(), unrelated[name], name);
  }
  const mod = await load(file, target);
  assert.equal(mod.pane, true); assert.equal(mod.runtime, true); assert.equal(mod.restricted, false);
  assert.equal(mod.external(), 'available'); assert.equal(mod.internal(), 'available');
});

test('three pane reads in one member select the feature publisher and preserve link routing and handoff', async t => {
  const { root, storage } = await environment(t);
  const member = 'webview/combined.js';
  const sourceCode = browser.replace("export const pane=capability(null,{name:'browser.in-app'}).isCapable;", '') + `
export function routeLink(){return capability(null,{name:'browser.in-app'}).isCapable;}
export const features=()=>{
 const sdk={check:id=>id==='337408568'};
 const pane=capability(null,{name:'browser.in-app'}).isCapable;
 const runtime=(0,sdk.check)('1892382740'), restricted=(0,sdk.check)('337408568');
 const handoff=()=>capability(null,{name:'browser.in-app'}).isCapable;
 return {browserPane:pane,runtime,restricted,handoff};
};`;
  await computerUseFixture(root, { [member]: sourceCode, 'webview/runtime.js': '' });
  const source = await inspect(root);
  assert.equal(source.browserUse?.supported, true, source.browserUse?.reason);
  assert.equal(source.browserUse?.patches, 7);
  const manager = new RepairManager(storage);
  const original = await readFile(path.join(root, 'resources/app.asar'));
  const record = await manager.install(source, { computerUse: true, browserUse: true });
  const file = path.join(storage, record.id, 'app/resources/app.asar');
  const mod = await load(file, member), features = mod.features();
  assert.equal(features.browserPane, true);
  assert.equal(features.runtime, true);
  assert.equal(features.restricted, false);
  assert.equal(mod.routeLink(), false);
  assert.equal(features.handoff(), false);
  assert.deepEqual(mod.browserCalls, ['browser.in-app', 'browser.in-app', 'browser.in-app']);
  const archive = await readArchive(file);
  const patched = (await readEntry(archive, entries(archive.header).find(([name]) => name === member)![1])).toString();
  for (const consumer of ["export function routeLink(){return capability(null,{name:'browser.in-app'}).isCapable;}", "const handoff=()=>capability(null,{name:'browser.in-app'}).isCapable;"]) {
    assert.ok(patched.includes(consumer), 'unrelated consumers remain byte-for-byte unchanged');
  }
  for (const [, entry] of entries(archive.header)) verifyIntegrity(await readEntry(archive, entry), entry);
  await manager.restore(record.id);
  assert.deepEqual(await readFile(file), original);
});

test('CUA gates in different function scopes cannot select a pane even when hook names match', () => {
  const source = `const check=()=>false,capability=()=>({isCapable:false});
function outer(){const runtime=check('1892382740');const pane=capability(null,{name:'browser.in-app'}).isCapable;
return ()=>check('337408568');}`;
  assert.deepEqual(browserUseSpans(source).pane, []);
});

test('multiple pane reads inside the CUA feature scope remain ambiguous and are not modified', async t => {
  const { root, storage } = await environment(t);
  await computerUseFixture(root, { 'webview/browser.js': runtime + browser + `export const secondPane=capability(null,{name:'browser.in-app'}).isCapable;`, 'webview/runtime.js': '' });
  const source = await inspect(root), original = await readFile(path.join(root, 'resources/app.asar'));
  assert.equal(source.computerUse?.supported, true);
  assert.equal(source.browserUse?.supported, false);
  assert.match(source.browserUse!.reason, /面板 2\/1/);
  await assert.rejects(() => new RepairManager(storage).install(source, { computerUse: true, browserUse: true }), /面板 2\/1/);
  assert.deepEqual(await readFile(path.join(root, 'resources/app.asar')), original);
});

test('ambiguous or incomplete browser targets reject only the browser combination', async t => {
  const { root, storage } = await environment(t);
  const variants: Record<string, string>[] = [{ 'webview/a.js': browser, 'webview/b.js': browser }, { 'webview/a.js': browser.replace("name:'browser.in-app'", "name:'other'") }];
  for (const extra of variants) {
    await rm(root, { recursive: true, force: true });
    await computerUseFixture(root, extra);
    const manager = new RepairManager(storage), source = await inspect(root);
    assert.equal(source.computerUse?.supported, true); assert.equal(source.browserUse?.supported, false);
    await assert.rejects(() => manager.install(source, { computerUse: true, browserUse: true }), /浏览器结构不匹配/);
  }
});
