import { build } from 'esbuild';
import { spawn } from 'node:child_process';
import electron from 'electron';
await build({ entryPoints: ['tests/electron-smoke.ts'], outfile: 'work/electron-smoke.cjs', bundle: true, platform: 'node', format: 'cjs', target: 'node22', external: ['electron'] });
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(electron, ['work/electron-smoke.cjs'], { stdio: 'inherit', env });
child.on('error', error => { console.error(error); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
