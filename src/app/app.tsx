import { useEffect, useState, type CSSProperties } from 'react';
import { FileText, Languages, Laptop, Moon, Search, Settings, Sun } from 'lucide-react';
import { SidebarProvider, Sidebar, SidebarHeader, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupLabel, SidebarGroupContent, SidebarMenu, SidebarMenuItem, SidebarMenuButton, SidebarInset, SidebarTrigger, useSidebar } from '@/components/ui/sidebar';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Separator } from '@/components/ui/separator';
import { Command, CommandDialog, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem, CommandShortcut } from '@/components/ui/command';
import { Kbd } from '@/components/ui/kbd';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Field, FieldGroup, FieldLabel, FieldDescription } from '@/components/ui/field';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { LanguagePage } from '@/features/language/language-page';
import { useLanguageTool } from '@/features/language/use-language-tool';
import { tools, type ToolId } from './tools';
import { useTheme, type Theme } from './preferences';

declare const __APP_VERSION__: string;
type Page = ToolId | 'settings';
function AppContent() {
  const tool = useLanguageTool();
  const theme = useTheme();
  const [page, setPage] = useState<Page>('language');
  const [searchOpen, setSearchOpen] = useState(false);
  const sidebar = useSidebar();
  const mac = tool.overview?.platform.startsWith('darwin') ?? /Mac/.test(navigator.userAgent);
  const navigate = (next: Page) => { setPage(next); setSearchOpen(false); sidebar.setOpenMobile(false); };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); setSearchOpen(current => !current); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return <>
    <Sidebar collapsible="icon">
      <SidebarHeader><div className="brand"><img className="brand-symbol" src="branding/nofyai-icon-192.png" alt="NofyAI" /><div className="brand-lockup"><img className="brand-logo brand-logo-light" src="branding/nofyai-logo-light.png" alt="NofyAI" /><img className="brand-logo brand-logo-dark" src="branding/nofyai-logo-dark.png" alt="NofyAI" /><span className="brand-product">nofy-helper</span></div></div>
        <SidebarMenu><SidebarMenuItem><SidebarMenuButton className="search-entry" tooltip="搜索工具" onClick={() => setSearchOpen(true)}><Search /><span>搜索工具</span><Kbd className="ml-auto">{mac ? '⌘' : 'Ctrl'} K</Kbd></SidebarMenuButton></SidebarMenuItem></SidebarMenu>
      </SidebarHeader>
      <SidebarContent><SidebarGroup><SidebarGroupLabel>工具</SidebarGroupLabel><SidebarGroupContent><SidebarMenu>{tools.map(item => <SidebarMenuItem key={item.id}><SidebarMenuButton isActive={page === item.id} tooltip={item.title} aria-current={page === item.id ? 'page' : undefined} onClick={() => navigate(item.id)}><item.icon /><span>{item.title}</span></SidebarMenuButton></SidebarMenuItem>)}</SidebarMenu></SidebarGroupContent></SidebarGroup></SidebarContent>
      <SidebarFooter><SidebarMenu><SidebarMenuItem><SidebarMenuButton isActive={page === 'settings'} tooltip="设置" aria-current={page === 'settings' ? 'page' : undefined} onClick={() => navigate('settings')}><Settings /><span>设置</span></SidebarMenuButton></SidebarMenuItem></SidebarMenu><div className="app-meta"><span className="local-indicator" />nofy-api 辅助工具<span>v{__APP_VERSION__}</span></div></SidebarFooter>
    </Sidebar>
    <SidebarInset><header className="app-header"><div className="header-location"><SidebarTrigger aria-label="切换侧栏" /><Separator orientation="vertical" className="h-4!" /><span>{page === 'settings' ? '偏好设置' : '工具'}</span><span className="crumb-divider">/</span><strong>{page === 'settings' ? '通用' : 'Codex 中文修复'}</strong></div><span className="app-environment">{tool.overview ? platformName(tool.overview.platform) : 'nofy-helper'}</span></header>
      <div className="workspace" id="main-content">
        <div hidden={page !== 'language'}><LanguagePage tool={tool} /></div>
        {page === 'settings' && <div className="settings-page"><div className="page-heading"><div className="tool-emblem"><Settings /></div><div className="heading-copy"><h1>设置</h1></div></div>
          <Card><CardHeader><CardTitle>外观</CardTitle><CardDescription>设置会保存在这台设备上。</CardDescription></CardHeader><CardContent><FieldGroup><Field><FieldLabel id="theme-label">主题</FieldLabel><ToggleGroup aria-labelledby="theme-label" value={[theme.theme]} onValueChange={values => { if (values[0]) theme.change(values[0] as Theme); }} variant="outline"><ToggleGroupItem value="light"><Sun data-icon="inline-start" />浅色</ToggleGroupItem><ToggleGroupItem value="dark"><Moon data-icon="inline-start" />深色</ToggleGroupItem><ToggleGroupItem value="system"><Laptop data-icon="inline-start" />跟随系统</ToggleGroupItem></ToggleGroup><FieldDescription>跟随系统会自动匹配当前设备的外观。</FieldDescription></Field></FieldGroup></CardContent></Card>
          {theme.error && <Alert variant="destructive"><AlertTitle>设置未保存</AlertTitle><AlertDescription>{theme.error}</AlertDescription></Alert>}
          <section className="about-section"><h2>关于 nofy-helper</h2><p>nofy-api 的桌面辅助工具。</p><dl className="detail-list"><dt>应用版本</dt><dd>{__APP_VERSION__}</dd><dt>运行环境</dt><dd>{tool.overview ? platformName(tool.overview.platform) : '浏览器'}</dd></dl><p>每个工具会单独标注支持的系统与适用条件。</p><Button variant="outline" disabled={!tool.connected || !!tool.busy} onClick={tool.logs}><FileText data-icon="inline-start" />打开日志文件</Button></section>
        </div>}
      </div>
    </SidebarInset>
    <CommandDialog open={searchOpen} onOpenChange={setSearchOpen} title="搜索工具" description="输入工具名称，使用方向键选择并按回车打开。"><Command><CommandInput placeholder="搜索工具或设置…" /><CommandList><CommandEmpty>没有找到匹配的工具。</CommandEmpty><CommandGroup heading="工具">{tools.map(item => <CommandItem key={item.id} value={item.title} keywords={[...item.keywords]} onSelect={() => navigate(item.id)}><item.icon /><span>{item.title}</span><CommandShortcut>↵</CommandShortcut></CommandItem>)}</CommandGroup><CommandGroup heading="应用"><CommandItem value="设置" keywords={['theme', '外观', 'settings']} onSelect={() => navigate('settings')}><Settings /><span>设置</span></CommandItem></CommandGroup></CommandList></Command></CommandDialog>
  </>;
}
function platformName(platform: string) {
  const [os, arch] = platform.split('-');
  return `${os === 'darwin' ? 'macOS' : os === 'win32' ? 'Windows' : os === 'linux' ? 'Linux' : os} · ${arch}`;
}
export function App() {
  return <TooltipProvider><SidebarProvider style={{ '--sidebar-width': '224px', '--sidebar-width-icon': '56px' } as CSSProperties}><AppContent /></SidebarProvider></TooltipProvider>;
}
