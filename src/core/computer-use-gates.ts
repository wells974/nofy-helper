import { parse } from 'acorn';
import { simple } from 'acorn-walk';
import { entries, readEntry, verifyIntegrity, type ArchiveChange, type ArchivePlan } from './asar';
import type { ComputerUseSupport } from '../shared';

// Independently implemented from the version/feature observations documented at
// chen0416ccc-cpu/codex-windows-fast-patch-skill, commit 83d564dd9e9d429ca1a415cd9791fab9922e31c8.
// No upstream installer, model changes, or global Statsig override is included.
export const COMPUTER_USE_VERSION = '26.1103.4239.0';
const fields = ['areRequirementsPending', 'areRequiredFeaturesEnabled', 'enabled', 'isBrowserAndComputerUseAllowed', 'isAnyFeatureLoading', 'isComputerUseGateEnabled', 'isHostCompatiblePlatform', 'isPlatformLoading', 'windowType'];
interface Span { start: number; end: number; value: string }

export function computerUseSpans(source: string): { availability: Span[]; runtime: Span[]; model: Span[] } {
  const found = { availability: [] as Span[], runtime: [] as Span[], model: [] as Span[] };
  const ast = parse(source, { ecmaVersion: 'latest', sourceType: 'module', allowHashBang: true });
  simple(ast, {
    CallExpression(node: any) {
      const argument = node.arguments[0];
      if (node.arguments.length === 1 && argument?.type === 'ObjectExpression' && node.callee.type === 'FunctionExpression') {
        const props = argument.properties;
        const keys = props.map((property: any) => property.key?.name);
        const params = node.callee.params;
        const paramKeys = params.length === 1 && params[0].type === 'ObjectPattern' ? params[0].properties.map((property: any) => property.key?.name) : [];
        if (keys.length === fields.length && paramKeys.length === fields.length && fields.every(key => keys.includes(key) && paramKeys.includes(key))) {
          const statuses = new Set<string>();
          simple(node.callee.body, { Literal(value: any) { if (typeof value.value === 'string') statuses.add(value.value); } });
          if (!['available', 'disabled', 'loading', 'unsupported-platform', 'window-type-disabled', 'statsig-disabled', 'config-requirement-disabled'].every(status => statuses.has(status))) throw new Error('Computer Use 可用性判断结构发生变化。');
          // Keep enabled, platform, loading and window-type checks in place.
          for (const key of ['isComputerUseGateEnabled', 'areRequiredFeaturesEnabled', 'isBrowserAndComputerUseAllowed']) {
            const property = props.find((property: any) => property.key.name === key);
            if (property.shorthand || property.computed || property.value.type !== 'Identifier') throw new Error('Computer Use 可用性参数结构发生变化。');
            found.availability.push({ start: property.value.start, end: property.value.end, value: '1' });
          }
        }
      }
      // These two version-bound calls share the renderer runtime feature module.
      const sequence = node.callee.type === 'SequenceExpression' ? node.callee.expressions : [];
      const callee = sequence.length === 2 && sequence[0].type === 'Literal' && sequence[0].value === 0 ? sequence[1] : null;
      if (node.arguments.length !== 1 || argument?.type !== 'Literal' || callee?.type !== 'MemberExpression' || callee.computed) return;
      if (argument.value === '1892382740') found.runtime.push({ start: node.start, end: node.end, value: `(${source.slice(node.start, node.end)},true)` });
      if (argument.value === '337408568') found.model.push({ start: node.start, end: node.end, value: `(${source.slice(node.start, node.end)},false)` });
    },
  });
  return found;
}

/** Preserve the runtime's own trusted roots and include the launcher's explicit roots. */
export function inheritTrustedPaths(source: string): Buffer {
  const ast = parse(source, { ecmaVersion: 'latest', sourceType: 'module' });
  const bindings = new Set<string>();
  simple(ast, { VariableDeclarator(node: any) {
    if (node.id.type === 'Identifier' && node.init?.type === 'Literal' && node.init.value === 'NODE_REPL_TRUSTED_CODE_PATHS') bindings.add(node.id.name);
  } });
  const arrays: { start: number; end: number; key: string }[] = [];
  simple(ast, { Property(node: any) {
    if (!node.computed || node.key.type !== 'Identifier' || !bindings.has(node.key.name)) return;
    const call = node.value, array = call.arguments?.[0];
    if (call.type !== 'CallExpression' || call.callee.type !== 'Identifier' || call.arguments.length !== 2 || call.arguments[1].type !== 'Identifier' || array?.type !== 'ArrayExpression' || array.elements.length !== 2 || !array.elements.every((value: any) => value?.type === 'Identifier')) throw new Error('Node REPL 可信目录结构发生变化。');
    arrays.push({ start: array.start, end: array.end, key: node.key.name });
  } });
  if (bindings.size !== 1 || arrays.length !== 1) throw new Error('未唯一识别 Node REPL 可信目录继承位置。');
  const array = arrays[0];
  const modified = source.slice(0, array.end - 1) + `,process.env[${array.key}]??""` + source.slice(array.end - 1);
  parse(modified, { ecmaVersion: 'latest', sourceType: 'module' });
  return Buffer.from(modified);
}

function apply(source: Buffer, spans: Span[]): Buffer {
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
  if (!/^26\.1103\.4239(?:\.0)?$/.test(plan.version)) throw new Error(`Computer Use 暂只适配 ${COMPUTER_USE_VERSION}，当前为 ${plan.version}。`);
  const changes: ArchiveChange[] = [];
  let availability = 0, runtime = 0, model = 0;
  const runtimeFiles: string[] = [], modelFiles: string[] = [];
  for (const [file, entry] of entries(plan.archive.header)) {
    if (file === '.vite/build/early-bootstrap.js') {
      const original = await readEntry(plan.archive, entry);
      verifyIntegrity(original, entry);
      changes.push({ file, original, modified: inheritTrustedPaths(new TextDecoder('utf-8', { fatal: true }).decode(original)) });
      continue;
    }
    if (!file.startsWith('webview/') || !file.endsWith('.js') || entry.unpacked || entry.link) continue;
    const original = await readEntry(plan.archive, entry);
    if (!['isComputerUseGateEnabled', '1892382740', '337408568'].some(marker => original.includes(Buffer.from(marker)))) continue;
    verifyIntegrity(original, entry);
    const spans = computerUseSpans(new TextDecoder('utf-8', { fatal: true }).decode(original));
    availability += spans.availability.length; runtime += spans.runtime.length; model += spans.model.length;
    if (spans.runtime.length) runtimeFiles.push(file);
    if (spans.model.length) modelFiles.push(file);
    const all = [...spans.availability, ...spans.runtime, ...spans.model];
    if (all.length) changes.push({ file, original, modified: apply(original, all) });
  }
  if (availability !== 3 || runtime !== 1 || model !== 1 || runtimeFiles[0] !== modelFiles[0]) throw new Error(`Computer Use 结构不匹配（可用性 ${availability}/3，运行时 ${runtime}/1，模型门控 ${model}/1），停止修复。`);
  if (!changes.some(change => change.file === '.vite/build/early-bootstrap.js')) throw new Error('缺少受支持的 Node REPL 启动模块。');
  return { support: { supported: true, reason: '已识别当前版本的 Computer Use 开关；创建副本后还需准备运行环境。', files: changes.map(change => change.file), patches: 6 }, changes };
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
