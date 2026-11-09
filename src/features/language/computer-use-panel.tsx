import { Check, ChevronDown, CircleAlert, Monitor, RotateCcw, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import type { Installation } from '../../shared';
import type { LanguageTool } from './use-language-tool';

export function ComputerUsePanel({ record, tool, disabled }: { record: Installation; tool: LanguageTool; disabled: boolean }) {
  const status = tool.computerUseStates[record.id];
  const active = record.status === 'ready';
  return <Card size="sm" className="mb-4 mx-4">
    <CardHeader><CardTitle className="flex flex-wrap items-center gap-2"><Monitor aria-hidden="true" />Computer Use<Badge variant={status?.ready ? 'secondary' : 'outline'}>{status?.ready ? '运行环境就绪' : status ? '需要准备运行环境' : '待检查运行环境'}</Badge></CardTitle><CardDescription>准备时备份 Codex 配置并启用官方插件；检查结果不影响副本启动。启动后，在 Computer Use 设置中开启 Any App，并用新会话验证效果。</CardDescription></CardHeader>
    <CardContent>{status && <Collapsible><CollapsibleTrigger render={<Button variant="ghost" size="sm" />}><ChevronDown data-icon="inline-start" aria-hidden="true" />运行环境详情</CollapsibleTrigger><CollapsibleContent><ul className="flex flex-col gap-2" aria-label="Computer Use 运行环境">{status.checks.map(check => <li key={check.name} className="flex items-start gap-2">{check.ok ? <Check aria-hidden="true" /> : <CircleAlert aria-hidden="true" />}<span className="min-w-0 break-all">{check.name}：{check.detail}</span></li>)}</ul>{status.backup && <p className="file-path">配置备份：{status.backup}</p>}</CollapsibleContent></Collapsible>}</CardContent>
    <CardFooter className="flex flex-wrap gap-2">
      <Button variant="outline" size="sm" disabled={disabled || !active} onClick={() => tool.checkComputerUse(record.id)}><Search data-icon="inline-start" aria-hidden="true" />检查 Computer Use</Button>
      {!status?.ready && <Button size="sm" disabled={disabled || !active || status?.canPrepare === false} onClick={() => tool.prepareComputerUse(record.id)}>准备 Computer Use</Button>}
      <Button variant="ghost" size="sm" disabled={disabled} onClick={() => tool.restoreComputerUseConfig(record.id)}><RotateCcw data-icon="inline-start" aria-hidden="true" />恢复 Computer Use 配置</Button>
    </CardFooter>
  </Card>;
}
