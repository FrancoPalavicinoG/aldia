import { readJson } from './json.js';
import type { ClaudePaths, ProjectPaths } from './paths.js';

export interface InstalledPlugin {
  id: string;
  name: string;
  marketplace: string;
  version: string;
  scope: string;
  enabled: boolean;
  installPath: string;
}

export interface PluginInventory {
  plugins: InstalledPlugin[];
  problems: string[];
}

interface InstallRecord {
  scope?: string;
  version?: string;
  installPath?: string;
}

function splitId(id: string): { name: string; marketplace: string } {
  const at = id.lastIndexOf('@');
  return at > 0 ? { name: id.slice(0, at), marketplace: id.slice(at + 1) } : { name: id, marketplace: '' };
}

type Settings = { enabledPlugins?: Record<string, boolean> } | undefined;

// With a project, `enabled` is the value in effect there: the project's shared settings
// override the user's, and its local settings override both, plugin by plugin.
export async function readPlugins(paths: ClaudePaths, project?: ProjectPaths): Promise<PluginInventory> {
  const problems: string[] = [];
  const installed = (await readJson(paths.installedPlugins, problems)) as { plugins?: Record<string, InstallRecord[]> } | undefined;
  const layers = project ? [paths.settings, project.settings, project.localSettings] : [paths.settings];
  const enabled: Record<string, boolean> = {};
  for (const file of layers) Object.assign(enabled, ((await readJson(file, problems)) as Settings)?.enabledPlugins);

  const plugins: InstalledPlugin[] = [];
  for (const [id, records] of Object.entries(installed?.plugins ?? {})) {
    for (const record of records) {
      plugins.push({
        id,
        ...splitId(id),
        version: record.version ?? 'unknown',
        scope: record.scope ?? 'user',
        enabled: enabled[id] === true,
        installPath: record.installPath ?? '',
      });
    }
  }
  plugins.sort((a, b) => a.id.localeCompare(b.id));
  return { plugins, problems };
}
