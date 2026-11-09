import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { validateVersion, prepareChecksums } from './release-metadata.mjs';

const pkg = JSON.parse(await readFile('package.json', 'utf8'));
const lock = JSON.parse(await readFile('package-lock.json', 'utf8'));
if (process.env.GITHUB_EVENT_NAME !== 'push' || process.env.GITHUB_REF_TYPE !== 'tag') throw new Error('只有标签推送可以发布');
const tag = process.env.GITHUB_REF_NAME;
if (!tag) throw new Error('缺少发布标签');
const version = validateVersion(pkg, lock, tag);
const repo = process.env.GITHUB_REPOSITORY;
if (!repo) throw new Error('缺少目标仓库');
const files = await prepareChecksums('release-assets', version);
const gh = args => execFileSync('gh', [...args, '--repo', repo], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
// A list failure must abort, rather than be mistaken for a missing release.
const releases = JSON.parse(gh(['release', 'list', '--limit', '100', '--json', 'tagName,isDraft']));
const existing = releases.find(release => release.tagName === tag);
if (existing && !existing.isDraft) throw new Error('该版本已发布；请增加版本号，不覆盖公开产物');
const notes = `## nofy-helper ${version}\n\nWindows x64、macOS Intel / Apple Silicon、Linux x64。\n\n当前 Codex 中文修复功能仅支持 Windows x64；其他系统可使用应用界面与设置。\n\n此版本 Windows 未配置发布者签名；macOS 使用临时签名，未做 Apple 公证。首次打开时系统可能提示来源未验证。\n\n使用 SHA256SUMS.txt 校验下载文件。\n`;
await writeFile('release-notes.md', notes);
if (!existing) gh(['release', 'create', tag, '--verify-tag', '--draft', '--title', `nofy-helper ${version}`, '--notes-file', 'release-notes.md', ...(version.includes('-') ? ['--prerelease'] : [])]);
gh(['release', 'upload', tag, ...[...files, 'SHA256SUMS.txt'].map(name => `release-assets/${name}`), '--clobber']);
gh(['release', 'edit', tag, '--draft=false', '--notes-file', 'release-notes.md']);
console.log(`已发布 ${tag}：${files.length} 个安装包和 SHA256SUMS.txt`);
