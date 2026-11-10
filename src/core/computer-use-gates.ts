import { parse } from 'acorn';
import { simple } from 'acorn-walk';
import { entries, readEntry, verifyIntegrity, type ArchiveChange, type ArchivePlan } from './asar';
import type { ComputerUseSupport } from '../shared';

// Independently implemented from the version/feature observations documented at
// chen0416ccc-cpu/codex-windows-fast-patch-skill, commit 83d564dd9e9d429ca1a415cd9791fab9922e31c8.
// No upstream installer, model changes, or global Statsig override is included.
const fields = ['areRequirementsPending', 'areRequiredFeaturesEnabled', 'enabled', 'isBrowserAndComputerUseAllowed', 'isAnyFeatureLoading', 'isComputerUseGateEnabled', 'isHostCompatiblePlatform', 'isPlatformLoading', 'windowType'];
export interface Span { start: number; end: number; value: string; hook?: string }
export function propertyName(property: any): string | undefined {
  if (property.type !== 'Property' || property.kind !== 'init' || property.method) return;
  if (!property.computed && property.key.type === 'Identifier') return property.key.name;
  if (property.key.type === 'Literal' && typeof property.key.value === 'string') return property.key.value;
}
export function hookName(callee: any): string | undefined {
  if (callee.type === 'SequenceExpression') {
    if (callee.expressions.length !== 2 || callee.expressions[0].type !== 'Literal' || callee.expressions[0].value !== 0) return;
    return hookName(callee.expressions[1]);
  }
  if (callee.type === 'Identifier') return callee.name;
  if (callee.type === 'MemberExpression' && !callee.computed && callee.object.type === 'Identifier' && callee.property.type === 'Identifier') return `${callee.object.name}.${callee.property.name}`;
}

export function computerUseSpans(source: string): { availability: Span[]; runtime: Span[]; model: Span[] } {
  const found = { availability: [] as Span[], runtime: [] as Span[], model: [] as Span[] };
  const ast = parse(source, { ecmaVersion: 'latest', sourceType: 'module', allowHashBang: true });
  simple(ast, {
    CallExpression(node: any) {
      const argument = node.arguments[0];
      if (node.arguments.length === 1 && argument?.type === 'ObjectExpression' && ['FunctionExpression', 'ArrowFunctionExpression'].includes(node.callee.type)) {
        const props = argument.properties;
        const keys = props.map(propertyName);
        const params = node.callee.params;
        const paramKeys = params.length === 1 && params[0].type === 'ObjectPattern' ? params[0].properties.map(propertyName) : [];
        if (fields.every(key => keys.includes(key) && paramKeys.includes(key))) {
          if (keys.includes(undefined) || paramKeys.includes(undefined) || new Set(keys).size !== keys.length || new Set(paramKeys).size !== paramKeys.length) throw new Error('Computer Use 可用性参数存在重复或动态字段。');
          const statuses = new Set<string>();
          simple(node.callee.body, { Literal(value: any) { if (typeof value.value === 'string') statuses.add(value.value); } });
          if (!['available', 'disabled', 'loading', 'unsupported-platform', 'window-type-disabled', 'statsig-disabled', 'config-requirement-disabled'].every(status => statuses.has(status))) throw new Error('Computer Use 可用性判断结构发生变化。');
          // Keep enabled, platform, loading and window-type checks in place.
          for (const key of ['isComputerUseGateEnabled', 'areRequiredFeaturesEnabled', 'isBrowserAndComputerUseAllowed']) {
            const property = props.find((property: any) => propertyName(property) === key);
            // Evaluate the original expression once, including any feature-hook side effects.
            const value = `(${source.slice(property.value.start, property.value.end)},true)`;
            found.availability.push({ start: property.shorthand ? property.start : property.value.start, end: property.value.end, value: property.shorthand ? `${key}:${value}` : value });
          }
        }
      }
      // Require both known feature IDs to call the same hook in the same module.
      const hook = hookName(node.callee);
      if (node.arguments.length !== 1 || argument?.type !== 'Literal' || !hook) return;
      if (argument.value === '1892382740') found.runtime.push({ start: node.start, end: node.end, value: `(${source.slice(node.start, node.end)},true)`, hook });
      if (argument.value === '337408568') found.model.push({ start: node.start, end: node.end, value: `(${source.slice(node.start, node.end)},false)`, hook });
    },
  });
  return found;
}

/** Preserve the runtime's own trusted roots and include the launcher's explicit roots. */
export function inheritTrustedPaths(source: string): Buffer {
  const ast = parse(source, { ecmaVersion: 'latest', sourceType: 'module', allowHashBang: true });
  const bindings = new Set<string>();
  simple(ast, { VariableDeclarator(node: any) {
    if (node.id.type === 'Identifier' && node.init?.type === 'Literal' && node.init.value === 'NODE_REPL_TRUSTED_CODE_PATHS') bindings.add(node.id.name);
  } });
  const isKey = (node: any) => node.type === 'Identifier' ? bindings.has(node.name) : node.type === 'Literal' && node.value === 'NODE_REPL_TRUSTED_CODE_PATHS';
  const arrays: { end: number; expression: string; inherited: boolean }[] = [];
  simple(ast, { Property(node: any) {
    if (!(node.computed && isKey(node.key)) && propertyName(node) !== 'NODE_REPL_TRUSTED_CODE_PATHS') return;
    const call = node.value, array = call.arguments?.[0];
    // Other env objects may reference the same key; only a root-merging call is eligible.
    if (call.type !== 'CallExpression' || !hookName(call.callee) || call.arguments.length !== 2 || array?.type !== 'ArrayExpression' || array.elements.length < 2 || array.elements.some((value: any) => !value)) return;
    let inherited = false;
    simple(array, { MemberExpression(value: any) {
      const object = value.object;
      if (object.type === 'MemberExpression' && !object.computed && object.object.type === 'Identifier' && object.object.name === 'process' && object.property.name === 'env' && ((value.computed && isKey(value.property)) || (!value.computed && value.property.name === 'NODE_REPL_TRUSTED_CODE_PATHS'))) inherited = true;
    } });
    arrays.push({ end: array.end, expression: node.computed ? source.slice(node.key.start, node.key.end) : JSON.stringify('NODE_REPL_TRUSTED_CODE_PATHS'), inherited });
  } });
  if (arrays.length !== 1) throw new Error(`Node REPL 可信目录匹配 ${arrays.length}/1，无法确定继承位置。`);
  const array = arrays[0];
  if (array.inherited) return Buffer.from(source);
  const modified = source.slice(0, array.end - 1) + `,process.env[${array.expression}]??""` + source.slice(array.end - 1);
  parse(modified, { ecmaVersion: 'latest', sourceType: 'module', allowHashBang: true });
  return Buffer.from(modified);
}

export function apply(source: Buffer, spans: Span[]): Buffer {
  const text = new TextDecoder('utf-8', { fatal: true }).decode(source);
  const parts: Buffer[] = [];
  let byteEnd = 0;
  let end = -1;
  for (const span of [...spans].sort((a, b) => a.start - b.start)) {
    if (span.start < end) throw new Error('Computer Use 补丁范围重叠。');
    end = span.end;
    const start = Buffer.byteLength(text.slice(0, span.start));
    const before = Buffer.from(text.slice(span.start, span.end));
    const replacement = Buffer.alloc(Math.max(before.length, Buffer.byteLength(span.value)), 32);
    for (let i = span.value.length; i < before.length; i++) if (before[i] === 10 || before[i] === 13) replacement[i] = before[i];
    replacement.write(span.value);
    parts.push(source.subarray(byteEnd, start), replacement);
    byteEnd = start + before.length;
  }
  parts.push(source.subarray(byteEnd));
  const result = Buffer.concat(parts);
  parse(result.toString('utf8'), { ecmaVersion: 'latest', sourceType: 'module', allowHashBang: true });
  return result;
}

export async function planComputerUse(plan: ArchivePlan): Promise<{ support: ComputerUseSupport; changes: ArchiveChange[] }> {
  const changes: ArchiveChange[] = [];
  let availability = 0, runtime = 0, model = 0, trusted = 0, trustedPatches = 0;
  const runtimeFiles: string[] = [], modelFiles: string[] = [];
  const runtimeHooks: string[] = [], modelHooks: string[] = [], trustedErrors: string[] = [];
  for (const [file, entry] of entries(plan.archive.header)) {
    const renderer = file.startsWith('webview/');
    const bootstrap = file.startsWith('.vite/build/');
    if ((!renderer && !bootstrap) || !file.endsWith('.js') || entry.unpacked || entry.link) continue;
    if (bootstrap) {
      const original = await readEntry(plan.archive, entry);
      if (!original.includes(Buffer.from('NODE_REPL_TRUSTED_CODE_PATHS'))) continue;
      verifyIntegrity(original, entry);
      let modified: Buffer;
      try { modified = inheritTrustedPaths(new TextDecoder('utf-8', { fatal: true }).decode(original)); }
      catch (error) { trustedErrors.push(`${file}：${error instanceof Error ? error.message : String(error)}`); continue; }
      trusted++;
      if (!modified.equals(original)) { trustedPatches++; changes.push({ file, original, modified }); }
      continue;
    }
    const original = await readEntry(plan.archive, entry);
    if (!['isComputerUseGateEnabled', '1892382740', '337408568'].some(marker => original.includes(Buffer.from(marker)))) continue;
    verifyIntegrity(original, entry);
    const spans = computerUseSpans(new TextDecoder('utf-8', { fatal: true }).decode(original));
    availability += spans.availability.length; runtime += spans.runtime.length; model += spans.model.length;
    if (spans.runtime.length) runtimeFiles.push(file);
    if (spans.model.length) modelFiles.push(file);
    runtimeHooks.push(...spans.runtime.map(span => span.hook!)); modelHooks.push(...spans.model.map(span => span.hook!));
    const all = [...spans.availability, ...spans.runtime, ...spans.model];
    if (all.length) changes.push({ file, original, modified: apply(original, all) });
  }
  if (availability !== 3 || runtime !== 1 || model !== 1 || runtimeFiles[0] !== modelFiles[0] || runtimeHooks[0] !== modelHooks[0]) throw new Error(`Computer Use 结构不匹配（可用性 ${availability}/3，运行时 ${runtime}/1，模型门控 ${model}/1；两处门控需位于同一模块并调用同一特性函数），无法生成补丁。`);
  if (trusted !== 1) throw new Error(`Node REPL 可信目录模块匹配 ${trusted}/1。${trustedErrors.join('；') || '缺失或存在多个候选，无法生成补丁。'}`);
  return { support: { supported: true, reason: `Computer Use 关键代码结构匹配，可尝试修复 ${plan.version}；创建副本后需准备运行环境，并验证截图与操作。`, files: changes.map(change => change.file), patches: 5 + trustedPatches }, changes };
}

export async function addComputerUsePatches(plan: ArchivePlan): Promise<ArchivePlan> {
  const { changes } = await planComputerUse(plan);
  const same = changes.find(change => change.file === plan.file);
  let modified = plan.modified;
  if (same) {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(plan.original);
    const spans = computerUseSpans(text);
    const all = [...spans.availability, ...spans.runtime, ...spans.model];
    if (all.some(span => Buffer.byteLength(text.slice(0, span.start)) < plan.patch.end && Buffer.byteLength(text.slice(0, span.end)) > plan.patch.start)) throw new Error('Computer Use 与中文补丁范围冲突。');
    const patchedSpans = computerUseSpans(new TextDecoder('utf-8', { fatal: true }).decode(plan.modified));
    const combined = [...patchedSpans.availability, ...patchedSpans.runtime, ...patchedSpans.model];
    if (combined.length !== all.length) throw new Error('中文修复后 Computer Use 结构发生变化。');
    modified = apply(plan.modified, combined);
  }
  return { ...plan, modified, changes: changes.filter(change => change.file !== plan.file) };
}
