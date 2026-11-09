import { useCallback, useEffect, useRef, useState } from 'react';
import type { ComputerUseStatus, Inspection, Installation, Overview, Progress, Result } from '../../shared';

function unwrap<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(result.error);
  return result.value;
}
export function useLanguageTool() {
  const api = window.helper;
  const [overview, setOverview] = useState<Overview | null>(null);
  const [path, setPath] = useState('');
  const [inspection, setInspection] = useState<Inspection | null>(null);
  const [records, setRecords] = useState<Installation[]>([]);
  const [computerUse, setComputerUse] = useState(false);
  const [computerUseStates, setComputerUseStates] = useState<Record<string, ComputerUseStatus>>({});
  const [events, setEvents] = useState<Progress[]>([]);
  const [busy, setBusy] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null);
  const lock = useRef(false);
  const supported = overview?.platform === 'win32-x64';
  const run = useCallback(async (label: string, action: () => Promise<void>) => {
    if (lock.current) return;
    lock.current = true; setBusy(label); setNotice(null);
    try { await action(); }
    catch (error) { setNotice({ text: error instanceof Error ? error.message : String(error), error: true }); }
    finally { lock.current = false; setBusy(''); }
  }, []);
  const load = useCallback(async () => {
    if (!api) return;
    const data = unwrap(await api.overview());
    setOverview(data); setRecords(data.installations);
    setPath(current => current || data.candidates[0]?.path || '');
  }, [api]);
  useEffect(() => {
    if (!api) { setLoaded(true); return; }
    const unsubscribe = api.onProgress(event => setEvents(current => [...current.slice(-149), event]));
    void run('正在查找安装', load).finally(() => setLoaded(true));
    return unsubscribe;
  }, [api, load, run]);
  const setInput = (value: string) => { setPath(value); setInspection(null); setComputerUse(false); setNotice(null); };
  const notify = (text: string) => setNotice({ text, error: false });
  return {
    overview, path, inspection, records, events, busy, loaded, notice, supported, connected: !!api,
    computerUse, computerUseStates, setComputerUse,
    setInput, dismiss: () => setNotice(null),
    rescan: () => run('正在查找安装', async () => { setInspection(null); setComputerUse(false); await load(); }),
    browse: () => run('正在选择目录', async () => { const chosen = unwrap(await api.choose()); if (chosen) setInput(chosen); }),
    inspect: () => run('正在检测安装', async () => { setInspection(null); setComputerUse(false); setInspection(unwrap(await api.inspect(path))); }),
    repair: () => run('正在创建修复副本', async () => {
      const record = unwrap(await api.repair({ computerUse })); if (!record) return;
      setRecords(current => [record, ...current]);
      notify(computerUse ? '中文与 Computer Use 副本已创建。请先准备 Computer Use，再启动验证效果。' : '修复副本已创建。启动后，请在 Codex 中确认中文显示。');
    }),
    checkComputerUse: (id: string) => run('正在检查 Computer Use', async () => {
      const status = unwrap(await api.computerUseStatus(id));
      setComputerUseStates(current => ({ ...current, [id]: status }));
    }),
    prepareComputerUse: (id: string) => run('正在准备 Computer Use', async () => {
      const result = await api.prepareComputerUse(id);
      const refreshed = result.ok ? result : await api.computerUseStatus(id);
      if (refreshed.ok) setComputerUseStates(current => ({ ...current, [id]: refreshed.value }));
      unwrap(result);
      notify('Computer Use 运行文件与插件已就绪。启动副本后，请验证 Any App、截图和窗口操作。');
    }),
    restoreComputerUseConfig: (id: string) => run('正在恢复 Computer Use 配置', async () => {
      unwrap(await api.restoreComputerUseConfig(id));
      setComputerUseStates(current => { const next = { ...current }; delete next[id]; return next; });
      notify('已恢复准备前的 Codex 配置，插件缓存和备份保留。');
    }),
    launch: (id: string) => run('正在启动副本', async () => {
      unwrap(await api.launch(id));
      notify(records.find(record => record.id === id)?.features?.computerUse ? '已发出启动请求。请开启 Any App，在新会话中验证截图与窗口操作。' : '已发出启动请求。请在 Codex 的 Language 中选择简体中文，并检查菜单与设置页。');
    }),
    restore: (id: string) => run('正在恢复原始文件', async () => {
      const record = unwrap(await api.restore(id)); if (!record) return;
      setRecords(current => current.map(item => item.id === record.id ? record : item));
      notify('副本已恢复原始文件。请通过原来的官方入口启动 Codex。');
    }),
    logs: () => run('正在打开日志', async () => { unwrap(await api.logs()); }),
  };
}
export type LanguageTool = ReturnType<typeof useLanguageTool>;
