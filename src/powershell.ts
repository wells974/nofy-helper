import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { envValue } from './core/process-env';

const exec = promisify(execFile);
export async function queryPowerShell(script: string, options: {
  env?: NodeJS.ProcessEnv; timeout?: number; maxBuffer?: number;
} = {}): Promise<string> {
  const executable = path.join(envValue(process.env, 'SystemRoot') || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
  const { stdout } = await exec(executable, ['-NoProfile', '-NonInteractive', '-Command',
    `$ErrorActionPreference='Stop'; [Console]::OutputEncoding=[System.Text.Encoding]::UTF8; ${script}`],
  { windowsHide: true, timeout: 30000, maxBuffer: 1024 * 1024, ...options });
  return stdout.replace(/^\uFEFF/, '').trim();
}
