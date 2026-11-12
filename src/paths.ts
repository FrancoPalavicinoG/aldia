import { homedir } from 'node:os';
import { join } from 'node:path';

export interface ClaudePaths {
  settings: string;
  installedPlugins: string;
}

export function resolveClaudePaths(env: NodeJS.ProcessEnv = process.env): ClaudePaths {
  const configDir = join(env.HOME || homedir(), '.claude');
  return {
    settings: join(configDir, 'settings.json'),
    installedPlugins: join(configDir, 'plugins', 'installed_plugins.json'),
  };
}
