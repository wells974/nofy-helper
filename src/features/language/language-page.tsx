import { useState } from 'react';
import { ArrowRight, Check, CheckCheck, ChevronDown, CircleAlert, Copy, FileText, FolderOpen, Info, Languages, Monitor, Play, RotateCcw, Search, ShieldCheck, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardFooter, CardHeader, CardTitle, CardDescription, CardAction } from '@/components/ui/card';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field';
import { InputGroup, InputGroupInput, InputGroupAddon, InputGroupButton } from '@/components/ui/input-group';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Alert, AlertTitle, AlertDescription, AlertAction } from '@/components/ui/alert';
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription, EmptyMedia } from '@/components/ui/empty';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { ComputerUsePanel } from './computer-use-panel';
import type { LanguageTool } from './use-language-tool';

export function LanguagePage({ tool }: { tool: LanguageTool }) {
  const [logsOpen, setLogsOpen] = useState(false);
  const disabled = !!tool.busy || !tool.supported;
  const readyCopy = tool.inspection ? tool.records.find(record => record.status === 'ready' && record.source.sourceHash === tool.inspection?.sourceHash && record.source.root === tool.inspection?.root && !!record.features?.computerUse === tool.computerUse) : undefined;
  const needsPreparation = readyCopy?.features?.computerUse && !tool.computerUseStates[readyCopy.id]?.ready;
  const unavailable = tool.loaded && !tool.supported;
  const status = tool.busy || (unavailable ? '当前系统不可用' : tool.inspection ? '检测通过' : '等待检测');
  return <div className="tool-page">
    <div className="page-heading">
      <div className="tool-emblem"><Languages aria-hidden="true" /></div>
      <div className="heading-copy"><h1>Codex 中文修复</h1><p>启用内置中文，也可为受支持版本修复 Computer Use。</p></div>
      <Badge variant="outline"><Monitor data-icon="inline-start" />Windows x64</Badge>
    </div>
    {tool.loaded && !tool.supported && <Alert className="platform-alert"><Info /><AlertTitle>{tool.connected ? '当前系统暂不支持此工具' : '请在桌面应用中使用此工具'}</AlertTitle><AlertDescription>{tool.connected ? '中文修复目前适用于 Windows x64。' : '安装检测与修复需要 nofy-helper 桌面应用。'}</AlertDescription></Alert>}
    {tool.notice && <Alert variant={tool.notice.error ? 'destructive' : 'default'} className="result-notice" role={tool.notice.error ? 'alert' : 'status'}>
      {tool.notice.error ? <CircleAlert /> : <CheckCheck />}<AlertTitle>{tool.notice.error ? '操作未完成' : '操作结果'}</AlertTitle><AlertDescription>{tool.notice.text}</AlertDescription><AlertAction><Button size="icon-xs" variant="ghost" aria-label="关闭提示" onClick={tool.dismiss}><X /></Button></AlertAction>
    </Alert>}
    <Card className="repair-card" aria-busy={!!tool.busy}>
      <CardHeader><CardTitle>安装与检测</CardTitle><CardDescription>选择 Codex 安装目录，检查版本和中文资源。</CardDescription><CardAction><Button variant="ghost" size="sm" disabled={disabled} onClick={tool.rescan}><RotateCcw data-icon="inline-start" />重新查找</Button></CardAction></CardHeader>
      <CardContent>
        {!tool.loaded ? <div className="flex flex-col gap-3" aria-label="正在读取安装信息"><Skeleton className="h-4 w-32" /><Skeleton className="h-10 w-full" /></div> : <FieldGroup>
          {tool.overview && tool.overview.candidates.length > 1 && <Field data-disabled={disabled}><FieldLabel htmlFor="detected-install">已找到的安装</FieldLabel><NativeSelect id="detected-install" value={tool.overview.candidates.some(candidate => candidate.path === tool.path) ? tool.path : ''} disabled={disabled} onChange={event => tool.setInput(event.target.value)}><NativeSelectOption value="" disabled>选择安装</NativeSelectOption>{tool.overview.candidates.map(candidate => <NativeSelectOption key={candidate.path} value={candidate.path}>{candidate.label} — {candidate.path}</NativeSelectOption>)}</NativeSelect></Field>}
          <Field data-disabled={disabled}><FieldLabel htmlFor="install-path">安装目录</FieldLabel><InputGroup><InputGroupInput id="install-path" value={tool.path} disabled={disabled} spellCheck={false} placeholder="选择文件夹或粘贴安装路径" onChange={event => tool.setInput(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !disabled && tool.path.trim()) void tool.inspect(); }} /><InputGroupAddon><FolderOpen /></InputGroupAddon><InputGroupAddon align="inline-end"><InputGroupButton variant="ghost" disabled={disabled} onClick={tool.browse} aria-label="选择安装目录">浏览</InputGroupButton></InputGroupAddon></InputGroup><FieldDescription>{tool.supported && !tool.path && !tool.overview?.candidates.length ? '未自动找到 Codex，你可以手动选择安装目录。' : '支持 Microsoft Store 与独立安装版本。'}</FieldDescription></Field>
        </FieldGroup>}
        <div className="check-status" role="status" aria-live="polite">
          <span className="status-icon" data-ready={!!tool.inspection}>{tool.busy ? <Spinner /> : unavailable ? <Info /> : tool.inspection ? <Check /> : <Search />}</span>
          <div><strong>{status}</strong><p>{tool.busy ? (tool.events.at(-1)?.message || '请稍候，完成后会在这里显示结果。') : unavailable ? '请在 Windows x64 设备上检测与修复。' : tool.inspection ? `Codex ${tool.inspection.version} · 已找到中文资源，可以创建修复副本。` : '检测仅读取文件，不会修改应用。'}</p></div>
        </div>
        {tool.inspection && <FieldGroup className="mb-4"><Field data-disabled={disabled}><FieldLabel id="repair-options-label">修复内容</FieldLabel><ToggleGroup aria-labelledby="repair-options-label" value={[tool.computerUse ? 'computer' : 'language']} onValueChange={values => { if (values.length) tool.setComputerUse(values[0] === 'computer'); }} disabled={disabled} variant="outline" className="flex-wrap"><ToggleGroupItem value="language">中文界面</ToggleGroupItem><ToggleGroupItem value="computer" disabled={!tool.inspection.computerUse?.supported}>中文 + Computer Use</ToggleGroupItem></ToggleGroup><FieldDescription>{tool.inspection.computerUse?.reason || '此版本暂未适配 Computer Use。'}{tool.computerUse && ' 准备运行环境会调用官方 CLI 启用插件，并备份 Codex 配置。'}</FieldDescription></Field></FieldGroup>}
        {tool.inspection && <Collapsible className="inspection-details"><CollapsibleTrigger render={<Button variant="ghost" size="sm" />}><ChevronDown data-icon="inline-start" />查看检测详情</CollapsibleTrigger><CollapsibleContent><dl className="detail-list"><dt>安装来源</dt><dd>{tool.inspection.store ? 'Microsoft Store' : '独立安装'}</dd><dt>中文资源</dt><dd>{tool.inspection.translationFiles} 个相关资源</dd><dt>完整性</dt><dd>EXE 与 ASAR 一致，翻译加载器唯一匹配</dd><dt>修复位置</dt><dd className="file-path">{tool.inspection.gateFile}</dd></dl></CollapsibleContent></Collapsible>}
      </CardContent>
      <CardFooter><span className="safe-note"><ShieldCheck aria-hidden="true" />原始安装保留，副本可恢复</span><div className="flex items-center gap-2">{tool.inspection && <Button variant="outline" disabled={disabled} onClick={tool.inspect}>重新检测</Button>}<Button disabled={disabled || !tool.path.trim() || (!!needsPreparation && !!readyCopy && tool.computerUseStates[readyCopy.id]?.canPrepare === false)} onClick={readyCopy ? () => needsPreparation ? tool.prepareComputerUse(readyCopy.id) : tool.launch(readyCopy.id) : tool.inspection ? tool.repair : tool.inspect}>{tool.busy ? <Spinner data-icon="inline-start" /> : readyCopy ? <Play data-icon="inline-start" /> : tool.inspection ? <Copy data-icon="inline-start" /> : <Search data-icon="inline-start" />}{readyCopy ? needsPreparation ? '准备运行环境' : '启动 Codex' : tool.inspection ? '创建修复副本' : '检测安装'}<ArrowRight data-icon="inline-end" /></Button></div></CardFooter>
    </Card>
    <section className="copies-section" aria-labelledby="copies-title"><div className="section-title"><div className="flex items-center gap-2"><h2 id="copies-title">修复副本</h2>{tool.records.length > 0 && <Badge variant="secondary">{tool.records.length}</Badge>}</div>{tool.records.length === 0 && <span>创建后从这里启动</span>}</div>
      {tool.records.length === 0 ? <Empty><EmptyHeader><EmptyMedia variant="icon"><Copy /></EmptyMedia><EmptyTitle>还没有修复副本</EmptyTitle><EmptyDescription>完成检测后创建副本，启动和恢复入口会显示在这里。</EmptyDescription></EmptyHeader></Empty> : <div className="copies-list">{tool.records.map((record, index) => <div key={record.id}>{index > 0 && <Separator />}<div className="copy-row"><div className="copy-icon"><Copy aria-hidden="true" /></div><div className="copy-info"><div className="copy-title"><h3>Codex {record.source.version}</h3><Badge variant={record.status === 'ready' ? 'secondary' : 'outline'}>{record.status === 'ready' ? record.features?.computerUse ? '待确认效果' : '待确认中文' : record.status === 'restoring' ? '恢复中断' : '已恢复'}</Badge></div><p className="file-path">{record.source.root}</p><p>{new Date(record.createdAt).toLocaleString('zh-CN', { hour12: false })}</p></div><div className="copy-actions">{record.status !== 'restored' && <Button variant="ghost" size="sm" disabled={disabled} onClick={() => tool.restore(record.id)}><RotateCcw data-icon="inline-start" />{record.status === 'restoring' ? '重试恢复' : '恢复'}</Button>}{record.status === 'ready' && <Button variant="outline" size="sm" disabled={disabled || (!!record.features?.computerUse && !tool.computerUseStates[record.id]?.ready)} onClick={() => tool.launch(record.id)}><Play data-icon="inline-start" />启动副本</Button>}</div></div>{record.features?.computerUse && <ComputerUsePanel record={record} tool={tool} disabled={disabled} />}</div>)}</div>}
    </section>
    <Collapsible open={logsOpen} onOpenChange={setLogsOpen} className="logs-section"><div className="logs-heading"><CollapsibleTrigger render={<Button variant="ghost" size="sm" />}><FileText data-icon="inline-start" />运行记录<ChevronDown data-icon="inline-end" /></CollapsibleTrigger><Button variant="ghost" size="sm" disabled={!tool.connected || !!tool.busy} onClick={tool.logs}>打开日志文件<FolderOpen data-icon="inline-end" /></Button></div><CollapsibleContent><ol className="event-list" aria-label="运行记录">{tool.events.length ? tool.events.map((event, index) => <li key={index}><time>{new Date(event.at).toLocaleTimeString('zh-CN', { hour12: false })}</time><span>{event.message}</span></li>) : <li><span>暂无运行记录。</span></li>}</ol></CollapsibleContent></Collapsible>
    <p className="tool-footnote">修复中文与 Computer Use；保留 API 配置和密钥。Computer Use 使用 Windows 当前桌面，实际截图与操作效果需在 Codex 内确认。</p>
  </div>;
}
