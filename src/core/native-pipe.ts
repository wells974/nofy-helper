import { isDeepStrictEqual } from 'node:util';
import { parse, type TomlTable } from 'smol-toml';

import { queryPowerShell } from '../powershell';
import { withEnvironment } from './process-env';
export const pipeKeys = ['SKY_CUA_NATIVE_PIPE', 'SKY_CUA_NATIVE_PIPE_DIRECTORY'] as const;
export type PipeProbe = (pipe: string) => Promise<'active' | 'missing' | 'unknown'>;
export interface PipeState { state: 'absent' | 'active' | 'stale' | 'unknown'; detail: string }
export interface PipeConfigPlan extends PipeState { cleaned?: Buffer }

// Same existence check as the upstream Get-ComputerUsePipeConfigState; never connects
// to or creates a pipe, and never persists a process-specific address.
export const probeNativePipe: PipeProbe = async pipe => {
  if (process.platform !== 'win32') return 'unknown';
  try {
    const stdout = await queryPowerShell(
      "if (Test-Path -LiteralPath $env:NOFY_PIPE_PROBE_PATH) { 'active' } else { 'missing' }",
      { env: withEnvironment(process.env, { NOFY_PIPE_PROBE_PATH: pipe }), timeout: 10000, maxBuffer: 4096 });
    return stdout.trim() === 'active' ? 'active' : stdout.trim() === 'missing' ? 'missing' : 'unknown';
  } catch { return 'unknown'; }
};

export async function inspectPipeValues(env: Record<string, unknown>, probe: PipeProbe = probeNativePipe): Promise<PipeState> {
  if (!pipeKeys.some(key => Object.hasOwn(env, key))) return { state: 'absent', detail: '未固定 native pipe 地址，由 Codex 启动时生成。' };
  const pipe = env.SKY_CUA_NATIVE_PIPE_DIRECTORY;
  if (env.SKY_CUA_NATIVE_PIPE !== '1' || typeof pipe !== 'string' || !/^\\\\\.\\pipe\\codex-computer-use-[^\\/\r\n]+$/i.test(pipe)) {
    return { state: 'stale', detail: '存在不完整或无效的 native pipe 覆盖配置。' };
  }
  const state = await probe(pipe);
  return state === 'active'
    ? { state: 'active', detail: '覆盖地址对应的 pipe 存在，保留原值；尚未验证实际连接。' }
    : state === 'missing' ? { state: 'stale', detail: '覆盖地址对应的 pipe 不存在，可能触发 native pipe unavailable / os error 2。' }
      : { state: 'unknown', detail: '无法确认覆盖地址是否存在，保留原值；未判定为失效。' };
}

function nodeEnv(document: any): Record<string, unknown> { return document?.mcp_servers?.node_repl?.env ?? {}; }

export async function planPipeConfig(bytes: Buffer, probe: PipeProbe = probeNativePipe): Promise<PipeConfigPlan> {
  const text = bytes.toString('utf8');
  let document: TomlTable;
  try { document = parse(text.replace(/^\uFEFF/, '')); }
  catch { return { state: 'unknown', detail: 'config.toml 无法解析，未修改 native pipe 配置。' }; }
  const state = await inspectPipeValues(nodeEnv(document), probe);
  if (state.state !== 'stale') return state;

  // Preserve comments, encoding and unrelated settings. Accept only a section/key
  // layout we can edit losslessly, then prove the full parsed result differs solely
  // by these two keys (including against fake headers in multiline strings).
  let inSection = false;
  const cleaned = text.split(/(?<=\n)/).filter(line => {
    if (/^\s*\[/.test(line)) {
      try { inSection = nodeEnv(parse(`${line}\n__nofy_pipe_probe__ = true\n`)).__nofy_pipe_probe__ === true; }
      catch { inSection = false; }
    }
    return !(inSection && /^\s*(?:SKY_CUA_NATIVE_PIPE(?:_DIRECTORY)?|"SKY_CUA_NATIVE_PIPE(?:_DIRECTORY)?"|'SKY_CUA_NATIVE_PIPE(?:_DIRECTORY)?')\s*=/.test(line));
  }).join('');
  const expected = parse(text.replace(/^\uFEFF/, ''));
  for (const key of pipeKeys) delete nodeEnv(expected)[key];
  try {
    if (isDeepStrictEqual(parse(cleaned.replace(/^\uFEFF/, '')), expected)) return { ...state, cleaned: Buffer.from(cleaned) };
  } catch { /* unknown layouts require manual inspection, never a broad rewrite */ }
  return { state: 'unknown', detail: '发现失效 pipe 覆盖，但 TOML 写法无法安全局部修改；原配置已保留。' };
}

/** Launch-time cleanup affects only the child environment, not user/system variables. */
export async function cleanPipeEnvironment(env: NodeJS.ProcessEnv, probe: PipeProbe = probeNativePipe): Promise<{ env: NodeJS.ProcessEnv; check: PipeState }> {
  const values: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(env)) {
    if (!(pipeKeys as readonly string[]).includes(key.toUpperCase()) || value === undefined) continue;
    if (Object.hasOwn(values, key.toUpperCase()) && values[key.toUpperCase()] !== value) return { env: { ...env }, check: { state: 'unknown', detail: '环境中存在大小写冲突的 pipe 变量，未修改。' } };
    values[key.toUpperCase()] = value;
  }
  const check = await inspectPipeValues(values, probe);
  const result = { ...env };
  if (check.state === 'stale') for (const key of Object.keys(result)) if ((pipeKeys as readonly string[]).includes(key.toUpperCase())) delete result[key];
  return { env: result, check };
}
