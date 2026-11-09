import { parse, type Node } from 'acorn';
import { ancestor } from 'acorn-walk';

export interface GatePatch { start: number; end: number; before: string; replacement: string }
function literal(node: any): unknown {
  if (node?.type === 'Literal') return node.value;
  if (node?.type === 'TemplateLiteral' && node.expressions.length === 0) return node.quasis[0].value.cooked;
  return undefined;
}
function falseValue(node: any): boolean {
  return literal(node) === false || (node?.type === 'UnaryExpression' && node.operator === '!' && literal(node.argument) === 1);
}

/** Only the known translation provider getter is eligible. Never broad-replace !1 or feature gates. */
export function findGatePatches(source: string): GatePatch[] {
  if (!source.includes('enable_i18n')) return [];
  if (!source.includes('72216192') || !source.includes('localeOverride') || !source.includes('messages')) return [];
  const ast = parse(source, { ecmaVersion: 'latest', sourceType: 'module', allowHashBang: true });
  const found: GatePatch[] = [];
  ancestor(ast, {
    CallExpression(node: any, parents: Node[]) {
      const callee = node.callee;
      if (callee?.type !== 'MemberExpression') return;
      const method = callee.computed ? literal(callee.property) : callee.property.name;
      if (method !== 'get' || node.arguments.length !== 2 || literal(node.arguments[0]) !== 'enable_i18n' || !falseValue(node.arguments[1])) return;
      const parent = parents[parents.length - 2];
      const expression = parent?.type === 'ChainExpression' ? parent : node;
      const before = source.slice(expression.start, expression.end);
      // Keep the ASAR member byte size and line breaks unchanged. Replace the entire optional
      // chain, so an absent config and an explicit server false are handled too.
      const bytes = Buffer.from(before);
      const replacement = Buffer.alloc(bytes.length, 32);
      for (let i = 4; i < bytes.length; i++) if (bytes[i] === 10 || bytes[i] === 13) replacement[i] = bytes[i];
      replacement.write('true', 0, 'ascii');
      found.push({ start: Buffer.byteLength(source.slice(0, expression.start)), end: Buffer.byteLength(source.slice(0, expression.end)), before, replacement: replacement.toString() });
    }
  });
  return found;
}

export function applyGatePatch(original: Buffer, patch: GatePatch): Buffer {
  if (original.subarray(patch.start, patch.end).toString() !== patch.before) throw new Error('国际化代码已变化，请重新检测。');
  const modified = Buffer.from(original);
  const replacement = Buffer.from(patch.replacement);
  if (replacement.length !== patch.end - patch.start) throw new Error('补丁长度不一致。');
  replacement.copy(modified, patch.start);
  parse(modified.toString('utf8'), { ecmaVersion: 'latest', sourceType: 'module', allowHashBang: true });
  return modified;
}
