import { app } from 'electron';
import { Worker } from 'node:worker_threads';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { computerUseFixture } from './computer-use-fixtures';
import { discover } from '../src/windows';

(process as NodeJS.Process & { noAsar?: boolean }).noAsar = true;

app.whenReady().then(async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'nofy-electron-smoke-'));
  let worker: Worker | undefined;
  try {
    const source = path.join(temp, '安装目录 with spaces'); await computerUseFixture(source);
    // Match the Store layout: a small Codex launcher plus the Electron host.
    await writeFile(path.join(source, 'ChatGPT.exe'), await readFile(path.join(source, 'Codex.exe')));
    await writeFile(path.join(source, 'Codex.exe'), 'launcher without an Electron integrity resource');
    // Discovery runs in the main process, where Electron's ASAR support stays enabled.
    (process as NodeJS.Process & { noAsar?: boolean }).noAsar = false;
    assert.equal((await stat(path.join(source, 'resources', 'app.asar'))).isDirectory(), true);
    const candidates = await discover({ platform: 'win32', env: {}, query: async script => script.includes('Get-AppxPackage') ? JSON.stringify([{ Name: 'OpenAI.Codex', InstallLocation: source }]) : '[]' });
    assert.deepEqual(candidates.map(item => item.path), [source]);
    assert.equal((process as NodeJS.Process & { noAsar?: boolean }).noAsar, false, 'discovery must preserve ASAR support for the helper UI');
    worker = new Worker(path.resolve('dist/worker.cjs'), { workerData: { storage: path.join(temp, 'records') } });
    const inspected: any = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Worker inspection timed out')), 15000);
      worker!.on('error', reject);
      worker!.on('message', message => {
        if (message.id !== 1) return;
        clearTimeout(timer);
        if (message.error) reject(new Error(message.error)); else resolve(message.value);
      });
      worker!.postMessage({ id: 1, action: 'inspect', input: source });
    });
    assert.equal(inspected.version, '26.1103.4239.0'); assert.equal(inspected.executable, 'ChatGPT.exe');
    assert.equal(inspected.computerUse.supported, true);
    console.log('Electron smoke passed: main-process discovery with ASAR enabled, dual-EXE worker inspection, and PE integrity.');
    await worker.terminate(); worker = undefined;
    (process as NodeJS.Process & { noAsar?: boolean }).noAsar = true;
    await rm(temp, { recursive: true, force: true }); app.exit(0);
  } catch (error) {
    console.error(error); if (worker) await worker.terminate();
    (process as NodeJS.Process & { noAsar?: boolean }).noAsar = true;
    await rm(temp, { recursive: true, force: true }); app.exit(1);
  }
});
