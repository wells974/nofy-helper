import { contextBridge, ipcRenderer } from 'electron';
import type { HelperAPI, Progress } from './shared';
const api: HelperAPI = {
  overview: () => ipcRenderer.invoke('overview'),
  choose: () => ipcRenderer.invoke('choose'),
  inspect: (path) => ipcRenderer.invoke('inspect', path),
  repair: () => ipcRenderer.invoke('repair'),
  restore: (id) => ipcRenderer.invoke('restore', id),
  launch: (id) => ipcRenderer.invoke('launch', id),
  logs: () => ipcRenderer.invoke('logs'),
  onProgress(callback) {
    const listener = (_event: unknown, progress: Progress) => callback(progress);
    ipcRenderer.on('progress', listener); return () => ipcRenderer.removeListener('progress', listener);
  }
};
contextBridge.exposeInMainWorld('helper', api);
