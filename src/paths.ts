import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

export interface ClaudePaths {
  home: string;
  settings: string;
  installedPlugins: string;
  skillsDir: string;
  globalState: string;
  // Session history: one folder per project, one .jsonl file per session.
  projectsDir: string;
}

// Claude Code moves its config with CLAUDE_CONFIG_DIR, .claude.json included, and the
// plugins folder alone with CLAUDE_CODE_PLUGIN_CACHE_DIR
// (https://code.claude.com/docs/en/claude-directory, .../plugins/loading).
export function resolveClaudePaths(env: NodeJS.ProcessEnv = process.env): ClaudePaths {
  const home = env.HOME || homedir();
  const configDir = env.CLAUDE_CONFIG_DIR || join(home, '.claude');
  const pluginsDir = env.CLAUDE_CODE_PLUGIN_CACHE_DIR || join(configDir, 'plugins');
  return {
    home,
    settings: join(configDir, 'settings.json'),
    installedPlugins: join(pluginsDir, 'installed_plugins.json'),
    skillsDir: join(configDir, 'skills'),
    globalState: env.CLAUDE_CONFIG_DIR ? join(env.CLAUDE_CONFIG_DIR, '.claude.json') : join(home, '.claude.json'),
    projectsDir: join(configDir, 'projects'),
  };
}

// A project's own Claude Code config, inside the repo
// (https://code.claude.com/docs/en/settings, .../mcp).
export interface ProjectPaths {
  root: string;
  // Shared with the team (committed).
  settings: string;
  // Only this user, kept out of git.
  localSettings: string;
  skillsDir: string;
  // Project-scope MCP servers, shared with the team.
  mcpJson: string;
}

export function resolveProjectPaths(root: string): ProjectPaths {
  return {
    root,
    settings: join(root, '.claude', 'settings.json'),
    localSettings: join(root, '.claude', 'settings.local.json'),
    skillsDir: join(root, '.claude', 'skills'),
    mcpJson: join(root, '.mcp.json'),
  };
}

// The project a session runs in. The home folder is not one: its .claude is the user's
// own config.
export function projectAt(paths: ClaudePaths, root: string | undefined): ProjectPaths | undefined {
  return root && resolve(root) !== resolve(paths.home) ? resolveProjectPaths(resolve(root)) : undefined;
}
