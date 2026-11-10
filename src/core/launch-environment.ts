import path from 'node:path';
import { cleanPipeEnvironment, type PipeProbe } from './native-pipe';
import { envValue, withEnvironment } from './process-env';

export async function desktopEnvironment(executable: string, computerUse: boolean, codexHome: string,
  inherited: NodeJS.ProcessEnv = process.env, probe?: PipeProbe) {
  let env = withEnvironment(inherited, { CODEX_HOME: codexHome, ELECTRON_RUN_AS_NODE: undefined });
  if (!computerUse) return { env };
  const cleaned = await cleanPipeEnvironment(env, probe);
  env = withEnvironment(cleaned.env, {
    CODEX_ELECTRON_ENABLE_WINDOWS_COMPUTER_USE: '1',
    NODE_REPL_TRUSTED_CODE_PATHS: [envValue(env, 'NODE_REPL_TRUSTED_CODE_PATHS'),
      path.join(path.dirname(executable), 'resources/cua_node/bin/node_modules'),
      path.join(path.dirname(executable), 'resources/plugins/openai-bundled')].filter(Boolean).join(path.delimiter),
  });
  return { env, check: cleaned.check };
}
