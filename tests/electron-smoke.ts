import { app } from 'electron';
import { Worker } from 'node:worker_threads';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fixture } from './fixtures';

(process as NodeJS.Process & { noAsar?: boolean }).noAsar = true;

app.whenReady().then(async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'nofy-electron-smoke-'));
  let worker: Worker | undefined;
  try {
    const source = path.join(temp, 'source'); await fixture(source);
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
    assert.equal(inspected.version, '26.1103.test'); assert.equal(inspected.executable, 'Codex.exe');
    console.log('Electron worker smoke passed: raw ASAR, PE integrity, and provider inspection.');
    await worker.terminate(); worker = undefined;
    await rm(temp, { recursive: true, force: true }); app.exit(0);
  } catch (error) {
    console.error(error); if (worker) await worker.terminate();
    await rm(temp, { recursive: true, force: true }); app.exit(1);
  }
});
