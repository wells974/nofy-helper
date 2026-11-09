import { useEffect, useState } from 'react';
export type Theme = 'system' | 'light' | 'dark';
const key = 'nofy-helper.theme';
function read(): Theme {
  try { const value = localStorage.getItem(key); if (value === 'light' || value === 'dark') return value; } catch { /* Defaults remain usable if storage is unavailable. */ }
  return 'system';
}
export function useTheme() {
  const [theme, setTheme] = useState<Theme>(read);
  const [error, setError] = useState('');
  useEffect(() => {
    const media = matchMedia('(prefers-color-scheme: dark)');
    const apply = () => document.documentElement.classList.toggle('dark', theme === 'dark' || (theme === 'system' && media.matches));
    apply(); media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [theme]);
  const change = (next: Theme) => {
    try { localStorage.setItem(key, next); setTheme(next); setError(''); }
    catch { setError('外观设置未能保存，请检查本地存储后重试。'); }
  };
  return { theme, change, error };
}
