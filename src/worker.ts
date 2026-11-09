import { parentPort, workerData } from 'node:worker_threads';
import { inspect, RepairManager } from './core/manager';
import { assertCodexStopped } from './windows';
const port = parentPort!;
// Electron's fs shim normally exposes .asar as a virtual directory. This worker must
// inspect raw archive bytes. Bundled worker code is already loaded; target fuses and
// the main window's ASAR handling remain unchanged.
(process as NodeJS.Process & { noAsar?: boolean }).noAsar = true;
const report = (progress: string) => port.postMessage({ progress });
const manager = new RepairManager(workerData.storage, report, assertCodexStopped);
port.on('message', async ({ id, action, input }) => {
  try {
    let value;
    switch (action) {
      case 'inspect': value = await inspect(input, report); break;
      case 'list': value = await manager.list(); break;
      case 'install': value = await manager.install(input); break;
      case 'restore': value = await manager.restore(input); break;
      case 'launchPath': value = await manager.launchPath(input); break;
      default: throw new Error('不支持的后台操作。');
    }
    port.postMessage({ id, value });
  } catch (error) { port.postMessage({ id, error: error instanceof Error ? error.message : String(error) }); }
});
