import { readFile, readdir, stat, writeFile, appendFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export function validateVersion(pkg, lock, tag) {
  const version = pkg.version;
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) throw new Error('版本号必须为 x.y.z 或 x.y.z-beta.1 格式');
  if (lock.version !== version || lock.packages?.['']?.version !== version) throw new Error('package.json 和 package-lock.json 版本号不一致');
  if (tag && tag !== `v${version}`) throw new Error(`标签 ${tag} 与版本 v${version} 不一致`);
  return version;
}

export function expectedAssets(version) {
  return [
    `nofy-helper-${version}-x64-setup.exe`,
    ...['x64', 'arm64'].flatMap(arch => ['dmg', 'zip'].map(ext => `nofy-helper-${version}-mac-${arch}.${ext}`)),
    ...['AppImage', 'tar.gz'].map(ext => `nofy-helper-${version}-linux-x64.${ext}`),
  ].sort();
}

export async function prepareChecksums(directory, version) {
  const expected = expectedAssets(version);
  const actual = (await readdir(directory)).sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`发布文件不完整或包含多余文件。预期：${expected.join(', ')}；实际：${actual.join(', ')}`);
  const lines = [];
  for (const name of expected) {
    const file = path.join(directory, name);
    const info = await stat(file);
    if (!info.isFile() || info.size === 0) throw new Error(`发布文件为空或无效：${name}`);
    const hash = createHash('sha256').update(await readFile(file)).digest('hex');
    lines.push(`${hash}  ${name}`);
  }
  await writeFile(path.join(directory, 'SHA256SUMS.txt'), `${lines.join('\n')}\n`);
  return expected;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const pkg = JSON.parse(await readFile('package.json', 'utf8'));
  const lock = JSON.parse(await readFile('package-lock.json', 'utf8'));
  const tag = process.env.GITHUB_REF_TYPE === 'tag' ? process.env.GITHUB_REF_NAME : undefined;
  const version = validateVersion(pkg, lock, tag);
  if (process.argv[2] === 'assets') await prepareChecksums(process.argv[3], version);
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `version=${version}\n`);
  console.log(`发布版本校验通过：${version}`);
}
