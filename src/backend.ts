import { Worker } from 'node:worker_threads';
import path from 'node:path';
import type { ComputerUseStatus, Inspection, Installation, RepairOptions } from './shared';

/** Keep AST parsing and large archive hashing off Electron's main/UI thread. */
export class RepairBackend {
  private worker: Worker;
  private sequence = 0;
  private failed = false;
  private pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }>();
  constructor(storage: string, report: (message: string) => void) {
    this.worker = new Worker(path.join(__dirname, 'worker.cjs'), { workerData: { storage } });
    this.worker.on('message', (message) => {
      if (message.progress) { report(message.progress); return; }
      const waiter = this.pending.get(message.id);
      if (!waiter) return;
      this.pending.delete(message.id);
      if (message.error) waiter.reject(new Error(message.error)); else waiter.resolve(message.value);
    });
    const fail = (error: Error) => {
      this.failed = true;
      for (const waiter of this.pending.values()) waiter.reject(error);
      this.pending.clear();
    };
    this.worker.on('error', fail);
    this.worker.on('exit', (code) => fail(new Error(`修复进程已退出（${code}），请重启工具后重试。`)));
  }
  private call<T>(action: string, input?: unknown): Promise<T> {
    if (this.failed) return Promise.reject(new Error('修复进程不可用，请重启工具。'));
    const id = ++this.sequence;
    return new Promise((resolve, reject) => { this.pending.set(id, { resolve, reject }); this.worker.postMessage({ id, action, input }); });
  }
  inspect(input: string) { return this.call<Inspection>('inspect', input); }
  list() { return this.call<Installation[]>('list'); }
  install(input: Inspection, options: RepairOptions = {}) { return this.call<Installation>('install', { inspection: input, options }); }
  computerUseStatus(id: string) { return this.call<ComputerUseStatus>('computerUseStatus', id); }
  prepareComputerUse(id: string) { return this.call<ComputerUseStatus>('prepareComputerUse', id); }
  restoreComputerUseConfig(id: string) { return this.call<void>('restoreComputerUseConfig', id); }
  restore(id: string) { return this.call<Installation>('restore', id); }
  launchPath(id: string) { return this.call<string>('launchPath', id); }
  launchSpec(id: string) { return this.call<{ executable: string; computerUse: boolean }>('launchSpec', id); }
  close() { void this.worker.terminate(); }
}
