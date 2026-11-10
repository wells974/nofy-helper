import path from 'node:path';
import os from 'node:os';

// Worker process.env is case-sensitive even on Windows. Child processes also
// select only one of duplicate keys, so replace all case variants explicitly.
export function envValue(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const values = [...new Set(Object.entries(env)
    .filter(([key, value]) => key.toUpperCase() === name.toUpperCase() && value !== undefined)
    .map(([, value]) => value!))];
  if (values.length > 1) throw new Error(`环境变量 ${name} 存在大小写冲突，请统一后重试。`);
  return values[0];
}

export function withEnvironment(env: NodeJS.ProcessEnv, overrides: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const result = { ...env };
  for (const [name, value] of Object.entries(overrides)) {
    for (const key of Object.keys(result)) if (key.toUpperCase() === name.toUpperCase()) delete result[key];
    if (value !== undefined) result[name] = value;
  }
  return result;
}

export function resolveCodexHome(env: NodeJS.ProcessEnv = process.env): string {
  // Resolve before changing the CLI/Desktop cwd, so both read the same config.
  return path.resolve(envValue(env, 'CODEX_HOME') || path.join(os.homedir(), '.codex'));
}
