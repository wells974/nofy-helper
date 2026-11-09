import { build } from 'esbuild';
import { mkdir, readFile, writeFile, copyFile, cp } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
const folder = path.resolve('work/ui-preview');
await mkdir(folder, { recursive: true });
await build({ entryPoints: ['tests/ui-fixture.ts'], outfile: path.join(folder, 'fixture.js'), bundle: true, platform: 'browser' });
const html = (await readFile('src/index.html', 'utf8')).replace('<script src="renderer.js">', '<script src="fixture.js"></script>\n  <script src="renderer.js">');
await writeFile(path.join(folder, 'index.html'), html);
for (const name of ['renderer.js', 'styles.css']) await copyFile(path.join('dist', name), path.join(folder, name));
await cp('dist/branding', path.join(folder, 'branding'), { recursive: true });
const server = createServer(async (req, res) => {
  const name = new URL(req.url, 'http://localhost').pathname.slice(1) || 'index.html';
  if (!['index.html', 'renderer.js', 'fixture.js', 'styles.css', 'branding/nofyai-icon-192.png', 'branding/nofyai-logo-light.png', 'branding/nofyai-logo-dark.png', 'branding/nofyai-favicon.ico'].includes(name)) { res.writeHead(404); res.end(); return; }
  res.setHeader('Content-Type', name.endsWith('.png') ? 'image/png' : name.endsWith('.ico') ? 'image/x-icon' : name.endsWith('.css') ? 'text/css' : name.endsWith('.js') ? 'text/javascript' : 'text/html');
  res.end(await readFile(path.join(folder, name)));
});
server.listen(4318, '127.0.0.1', () => console.log('UI fixture preview: http://127.0.0.1:4318 (no filesystem repair operations)'));
