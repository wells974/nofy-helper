import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { findGatePatches, applyGatePatch } from '../src/core/gate';

const wrap = (expression: string) => `const localeOverride = 'zh-CN'; const messages = {}; const layer = '72216192'; result = ${expression};`;
for (const expression of ['config?.get("enable_i18n",!1)', "config.get('enable_i18n',false)", 'config?.get(`enable_i18n`, false)', 'config?.["get"]("enable_i18n", false)', 'config?.get?.("enable_i18n",false)']) {
  test(`full getter replacement: ${expression}`, () => {
    const source = wrap(expression), patches = findGatePatches(source); assert.equal(patches.length, 1);
    const output = applyGatePatch(Buffer.from(source), patches[0]); assert.equal(output.length, Buffer.byteLength(source));
    for (const config of [undefined, { get: () => false }, { get: () => undefined }, { get: () => true }]) {
      const context = { config, result: null }; vm.runInNewContext(output.toString(), context); assert.equal(context.result, true);
    }
  });
}
test('ignores strings, unrelated getters, and settings picker true default', () => {
  assert.equal(findGatePatches(wrap(`config?.get('other_feature',false)`)).length, 0);
  assert.equal(findGatePatches(wrap(`config?.get('enable_i18n',true)`)).length, 0);
  assert.equal(findGatePatches(wrap(`"config.get('enable_i18n',false)"`)).length, 0);
  assert.equal(findGatePatches('config.get("enable_i18n",false)').length, 0);
});
test('ambiguous providers stay visible to the caller for refusal', () => { assert.equal(findGatePatches(wrap(`config.get('enable_i18n',false) || config.get('enable_i18n',false)`)).length, 2); });
test('UTF-8 offsets and multiline expressions preserve valid syntax and byte length', () => {
  const source = 'const 文本 = "中文";\n' + wrap('配置?.get(\n"enable_i18n", false)');
  const patch = findGatePatches(source)[0], result = applyGatePatch(Buffer.from(source), patch);
  assert.equal(result.length, Buffer.byteLength(source)); assert.equal(result.toString().split('\n').length, source.split('\n').length);
  const context = { result: false }; vm.runInNewContext(result.toString(), context); assert.equal(context.result, true);
});
test('rejects a stale patch plan', () => { const source = wrap('config.get("enable_i18n",false)'), patch = findGatePatches(source)[0]; assert.throws(() => applyGatePatch(Buffer.from(source.replace('false', 'true ')), patch)); });
