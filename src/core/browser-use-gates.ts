import { parse } from 'acorn';
import { simple } from 'acorn-walk';
import { entries, readEntry, verifyIntegrity, type ArchiveChange, type ArchivePlan } from './asar';
import { apply, hookName, propertyName, type Span } from './computer-use-gates';
import type { ComputerUseSupport } from '../shared';

// Upstream observations: desktop-2611034239-profiles.json at 83d564dd9e9d429ca1a415cd9791fab9922e31c8,
// kinds browser-external, browser-in-app and browser-pane. Independently match named
// arguments; retain the original loading, WSL, window and user-enable conditions.
const external = ['areRequirementsPending', 'isBrowserAndComputerUseAllowed', 'isExternalBrowserUseFeatureEnabled', 'isExternalBrowserUseFeatureLoading', 'isExternalBrowserUseGateEnabled', 'runCodexInWsl', 'windowType'];
const internal = ['areRequirementsPending', 'isBrowserAgentGateEnabled', 'isBrowserAndComputerUseAllowed', 'isBrowserEnabled', 'isBrowserUseEnabled', 'isLoading', 'runCodexInWsl', 'windowType'];

export function browserUseSpans(source: string): { external: Span[]; internal: Span[]; pane: Span[] } {
  const found = { external: [] as Span[], internal: [] as Span[], pane: [] as Span[] };
  const runtimeHooks: string[] = [], modelHooks: string[] = [];
  const ast = parse(source, { ecmaVersion: 'latest', sourceType: 'module', allowHashBang: true });
  simple(ast, {
    CallExpression(node: any) {
      const hook = hookName(node.callee);
      if (hook && node.arguments.length === 1 && node.arguments[0]?.type === 'Literal') {
        if (node.arguments[0].value === '1892382740') runtimeHooks.push(hook);
        if (node.arguments[0].value === '337408568') modelHooks.push(hook);
      }
      if (node.arguments.length !== 1 || node.arguments[0]?.type !== 'ObjectExpression' || !['FunctionExpression', 'ArrowFunctionExpression'].includes(node.callee.type)) return;
      const props = node.arguments[0].properties, keys = props.map(propertyName);
      const params = node.callee.params;
      const paramKeys = params.length === 1 && params[0].type === 'ObjectPattern' ? params[0].properties.map(propertyName) : [];
      const kind = external.every(key => keys.includes(key) && paramKeys.includes(key)) ? 'external' : internal.every(key => keys.includes(key) && paramKeys.includes(key)) ? 'internal' : undefined;
      if (!kind) return;
      if (keys.includes(undefined) || paramKeys.includes(undefined) || new Set(keys).size !== keys.length || new Set(paramKeys).size !== paramKeys.length) throw new Error('Browser Use 可用性参数重复或包含动态字段。');
      const statuses = new Set<string>();
      simple(node.callee.body, { Literal(value: any) { if (typeof value.value === 'string') statuses.add(value.value); } });
      const expected = ['available', 'loading', 'wsl-disabled', 'statsig-disabled', 'config-requirement-disabled', ...(kind === 'internal' ? ['browser-pane-disabled', 'window-type-disabled'] : [])];
      if (!expected.every(status => statuses.has(status))) throw new Error('Browser Use 可用性判断结构已变化。');
      const gates = kind === 'external' ? ['isBrowserAndComputerUseAllowed', 'isExternalBrowserUseFeatureEnabled', 'isExternalBrowserUseGateEnabled'] : ['isBrowserAgentGateEnabled', 'isBrowserAndComputerUseAllowed', 'isBrowserUseEnabled'];
      for (const key of gates) {
        const property = props.find((item: any) => propertyName(item) === key);
        const value = `(${source.slice(property.value.start, property.value.end)},true)`;
        found[kind].push({ start: property.shorthand ? property.start : property.value.start, end: property.value.end, value: property.shorthand ? `${key}:${value}` : value });
      }
    },
    MemberExpression(node: any) {
      if ((node.computed ? node.property.value : node.property.name) !== 'isCapable') return;
      const call = node.object;
      if (call.type !== 'CallExpression' || !hookName(call.callee) || call.arguments.length !== 2 || call.arguments[1]?.type !== 'ObjectExpression') return;
      const props = call.arguments[1].properties;
      if (props.length !== 1 || propertyName(props[0]) !== 'name' || props[0].value.type !== 'Literal' || props[0].value.value !== 'browser.in-app') return;
      found.pane.push({ start: node.start, end: node.end, value: `(${source.slice(node.start, node.end)},true)` });
    },
  });
  // Upstream places browser-pane alongside cua-runtime and cua-model-gate in the
  // same renderer member. Many other chunks read browser.in-app for unrelated UI.
  // Select that module by its unique paired hook calls, never by filename/version
  // or by taking the first capability read. Ambiguity within it still fails below.
  if (runtimeHooks.length !== 1 || modelHooks.length !== 1 || runtimeHooks[0] !== modelHooks[0]) found.pane = [];
  return found;
}

export async function planBrowserUse(plan: ArchivePlan): Promise<{ support: ComputerUseSupport; changes: ArchiveChange[] }> {
  const changes: ArchiveChange[] = [];
  const counts = { external: 0, internal: 0, pane: 0 };
  for (const [file, entry] of entries(plan.archive.header)) {
    if (!file.startsWith('webview/') || !file.endsWith('.js') || entry.unpacked || entry.link) continue;
    const original = await readEntry(plan.archive, entry);
    if (!['isExternalBrowserUseGateEnabled', 'isBrowserAgentGateEnabled', 'browser.in-app'].some(value => original.includes(Buffer.from(value)))) continue;
    verifyIntegrity(original, entry);
    const spans = browserUseSpans(new TextDecoder('utf-8', { fatal: true }).decode(original));
    for (const kind of ['external', 'internal', 'pane'] as const) counts[kind] += spans[kind].length;
    const all = [...spans.external, ...spans.internal, ...spans.pane];
    if (all.length) changes.push({ file, original, modified: apply(original, all) });
  }
  if (counts.external !== 3 || counts.internal !== 3 || counts.pane !== 1) throw new Error(`浏览器结构不匹配（Chrome ${counts.external}/3，内置 Browser Use ${counts.internal}/3，面板 ${counts.pane}/1；面板需位于两个 CUA 特性调用所在模块且唯一），未生成浏览器补丁。`);
  return { support: { supported: true, reason: 'Chrome、内置 Browser Use 与浏览器面板结构均唯一匹配；创建新组合副本后仍需完成扩展设置并验证实际连接。', files: changes.map(change => change.file), patches: 7 }, changes };
}

/** Reparse already-modified members, so language/CUA/browser edits may share a file. */
export async function addBrowserUsePatches(plan: ArchivePlan): Promise<ArchivePlan> {
  const { changes: targets } = await planBrowserUse(plan);
  const changes = new Map((plan.changes ?? []).map(change => [change.file, change]));
  let modified = plan.modified;
  for (const target of targets) {
    const current = target.file === plan.file ? modified : changes.get(target.file)?.modified ?? target.original;
    const expected = browserUseSpans(target.original.toString('utf8'));
    const found = browserUseSpans(current.toString('utf8'));
    if (Object.keys(expected).some(key => expected[key as keyof typeof expected].length !== found[key as keyof typeof found].length)) throw new Error('其他补丁应用后浏览器结构发生变化，停止组合修复。');
    const output = apply(current, [...found.external, ...found.internal, ...found.pane]);
    if (target.file === plan.file) modified = output;
    else changes.set(target.file, { ...target, modified: output });
  }
  return { ...plan, modified, changes: [...changes.values()] };
}
