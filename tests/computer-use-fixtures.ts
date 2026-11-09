import { fixture } from './fixtures';

export const availability = `
export function availability({ pending=false, required=false, enabled=true, allowed=false, loading=false, gate=false, platform=true, platformLoading=false, windowType='electron' }={}) {
 return function({areRequirementsPending:p,areRequiredFeaturesEnabled:r,enabled:e,isBrowserAndComputerUseAllowed:a,isAnyFeatureLoading:l,isComputerUseGateEnabled:g,isHostCompatiblePlatform:h,isPlatformLoading:s,windowType:w}) {
  return !e?'disabled':w!=='electron'?'window-type-disabled':p?'loading':!a?'config-requirement-disabled':!g?'statsig-disabled':s?'loading':!h?'unsupported-platform':l?'loading':!r?'config-requirement-disabled':'available';
 }({areRequirementsPending:pending,areRequiredFeaturesEnabled:required,enabled:enabled,isBrowserAndComputerUseAllowed:allowed,isAnyFeatureLoading:loading,isComputerUseGateEnabled:gate,isHostCompatiblePlatform:platform,isPlatformLoading:platformLoading,windowType:windowType});
}`;
export const runtime = `// 中文路径与多字节内容不改变补丁位置\nexport const calls=[];const sdk={check:id=>{calls.push(id);return id==='337408568'}}; export const runtime=(0,sdk.check)('1892382740'); export const restricted=(0,sdk.check)('337408568'); export const unrelated=(0,sdk.check)('unrelated');`;
export const bootstrap = `const u="NODE_REPL_TRUSTED_CODE_PATHS"; const p=(roots,separator)=>roots.filter(Boolean).join(separator); export function launchEnv(t,m,g=';'){return {[u]:p([t,m],g)}}`;
export async function computerUseFixture(root: string, extra: Record<string, string> = {}) {
  return fixture(root, {
    'package.json': '{"name":"codex","version":"26.1103.4239.0"}',
    'webview/availability.js': availability,
    'webview/runtime.js': runtime,
    '.vite/build/early-bootstrap.js': bootstrap,
    ...extra,
  });
}
