import { build } from 'esbuild';
import { mkdir, copyFile, readFile, cp } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
const uiOnly = process.argv.includes('--ui');
const pkg = JSON.parse(await readFile('package.json', 'utf8'));
await mkdir('dist', { recursive: true });
await Promise.all([
  !uiOnly && build({ entryPoints: ['src/main.ts'], outfile: 'dist/main.cjs', bundle: true, platform: 'node', format: 'cjs', target: 'node22', external: ['electron'] }),
  !uiOnly && build({ entryPoints: ['src/worker.ts'], outfile: 'dist/worker.cjs', bundle: true, platform: 'node', format: 'cjs', target: 'node22' }),
  !uiOnly && build({ entryPoints: ['src/preload.ts'], outfile: 'dist/preload.cjs', bundle: true, platform: 'node', format: 'cjs', target: 'node22', external: ['electron'] }),
  build({ entryPoints: ['src/renderer.tsx'], outfile: 'dist/renderer.js', bundle: true, platform: 'browser', target: 'chrome130', jsx: 'automatic', define: { __APP_VERSION__: JSON.stringify(pkg.version), 'process.env.NODE_ENV': JSON.stringify(uiOnly ? 'development' : 'production') } }),
  copyFile('src/index.html', 'dist/index.html'),
  cp('assets/branding', 'dist/branding', { recursive: true })
]);

execFileSync(process.execPath, ['node_modules/@tailwindcss/cli/dist/index.mjs', '-i', 'src/styles.css', '-o', 'dist/styles.css'], { stdio: 'inherit' });
