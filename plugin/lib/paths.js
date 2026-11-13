import { homedir } from 'node:os';
import { join } from 'node:path';
// Claude Code moves its config with CLAUDE_CONFIG_DIR, .claude.json included, and the
// plugins folder alone with CLAUDE_CODE_PLUGIN_CACHE_DIR
// (https://code.claude.com/docs/en/claude-directory, .../plugins/loading).
export function resolveClaudePaths(env = process.env) {
    const home = env.HOME || homedir();
    const configDir = env.CLAUDE_CONFIG_DIR || join(home, '.claude');
    const pluginsDir = env.CLAUDE_CODE_PLUGIN_CACHE_DIR || join(configDir, 'plugins');
    return {
        home,
        settings: join(configDir, 'settings.json'),
        installedPlugins: join(pluginsDir, 'installed_plugins.json'),
        skillsDir: join(configDir, 'skills'),
        globalState: env.CLAUDE_CONFIG_DIR ? join(env.CLAUDE_CONFIG_DIR, '.claude.json') : join(home, '.claude.json'),
    };
}
export function resolveProjectPaths(root) {
    return {
        root,
        settings: join(root, '.claude', 'settings.json'),
        localSettings: join(root, '.claude', 'settings.local.json'),
        skillsDir: join(root, '.claude', 'skills'),
    };
}
