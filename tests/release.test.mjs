import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { validateVersion, expectedAssets, prepareChecksums } from '../scripts/release-metadata.mjs';
const metadata = version => [{ version }, { version, packages: { '': { version } } }];

test('release accepts matching stable and prerelease tags', () => {
  for (const version of ['0.1.0', '1.2.3-beta.1']) assert.equal(validateVersion(...metadata(version), `v${version}`), version);
  assert.equal(validateVersion(...metadata('0.1.0')), '0.1.0');
});
test('release rejects wrong tags, version drift and malformed versions', () => {
  assert.throws(() => validateVersion(...metadata('0.1.0'), 'v0.2.0'), /不一致/);
  assert.throws(() => validateVersion(...metadata('0.1.0'), '0.1.0'), /不一致/);
  const [pkg, lock] = metadata('0.1.0'); lock.packages[''].version = '0.0.9';
  assert.throws(() => validateVersion(pkg, lock, 'v0.1.0'), /不一致/);
  assert.throws(() => validateVersion(...metadata('invalid')), /版本号/);
});
test('release requires all seven nonempty packages before writing checksums', async () => {
  const folder = await mkdtemp(path.join(tmpdir(), 'nofy-release-'));
  try {
    const names = expectedAssets('0.1.0'); assert.equal(names.length, 7);
    await assert.rejects(prepareChecksums(folder, '0.1.0'), /不完整/);
    for (const name of names) await writeFile(path.join(folder, name), 'abc');
    await writeFile(path.join(folder, 'unexpected.txt'), 'abc');
    await assert.rejects(prepareChecksums(folder, '0.1.0'), /多余/);
    await rm(path.join(folder, 'unexpected.txt'));
    await writeFile(path.join(folder, names[0]), '');
    await assert.rejects(prepareChecksums(folder, '0.1.0'), /为空/);
    await writeFile(path.join(folder, names[0]), 'abc');
    await prepareChecksums(folder, '0.1.0');
    const sums = await readFile(path.join(folder, 'SHA256SUMS.txt'), 'utf8');
    assert.equal(sums.trim().split('\n').length, 7);
    for (const line of sums.trim().split('\n')) assert.match(line, /^ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad  /);
  } finally { await rm(folder, { recursive: true, force: true }); }
});
