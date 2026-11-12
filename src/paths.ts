import { homedir } from 'node:os';
import { join } from 'node:path';

export interface ClaudePaths {
  settings: string;
  installedPlugins: string;
  skillsDir: string;
}

// Claude Code moves its config with CLAUDE_CONFIG_DIR, and the plugins folder alone
// with CLAUDE_CODE_PLUGIN_CACHE_DIR (https://code.claude.com/docs/en/plugins/loading).
export function resolveClaudePaths(env: NodeJS.ProcessEnv = process.env): ClaudePaths {
  const configDir = env.CLAUDE_CONFIG_DIR || join(env.HOME || homedir(), '.claude');
  const pluginsDir = env.CLAUDE_CODE_PLUGIN_CACHE_DIR || join(configDir, 'plugins');
  return {
    settings: join(configDir, 'settings.json'),
    installedPlugins: join(pluginsDir, 'installed_plugins.json'),
    skillsDir: join(configDir, 'skills'),
  };
}
