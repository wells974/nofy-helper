import { Languages } from 'lucide-react';

// Register actual tools here. Compatibility belongs to each tool, not the app shell.
export const tools = [{
  id: 'language', title: 'Codex 中文修复', icon: Languages,
  keywords: ['语言', '中文', '修复', 'codex', 'language', 'i18n'],
  platforms: ['win32-x64'],
}] as const;
export type ToolId = typeof tools[number]['id'];
