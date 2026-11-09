import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import electron from 'electron';

const root = fileURLToPath(new URL('../', import.meta.url));
let executable = electron;
let args = ['.'];

if (process.platform === 'darwin') {
  // Dock labels come from the .app bundle, not BrowserWindow.title or app.setName.
  // Use a project-local app bundle so npm run dev previews the real product name.
  const { build, Platform, archFromString } = await import('electron-builder');
  let bundle;
  await build({
    projectDir: root,
    targets: Platform.MAC.createTarget('dir', archFromString(process.arch)),
    publish: 'never',
    config: {
      directories: { output: 'work/desktop' },
      electronDist: path.dirname(electron).replace(/\/Electron\.app\/Contents\/MacOS$/, ''),
      npmRebuild: false,
      mac: { identity: '-', hardenedRuntime: false, notarize: false },
      afterPack: context => {
        bundle = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
      },
    },
  });
  if (!bundle) throw new Error('没有生成 macOS 预览应用。');
  console.log(`启动本地预览：${bundle}`);
  executable = '/usr/bin/open';
  args = ['-W', '-n', bundle];
}

const child = spawn(executable, args, { cwd: root, stdio: 'inherit' });
child.on('error', error => { console.error(error); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
