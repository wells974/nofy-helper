import * as fs from 'node:fs';
import { createRequire } from 'node:module';

// Electron exposes .asar files as virtual directories through node:fs. Discovery
// needs their real disk metadata without disabling ASAR support for the helper UI.
const disk: typeof fs = process.versions.electron
  ? createRequire(process.execPath)('original-fs')
  : fs;

export const { readdir, stat } = disk.promises;
