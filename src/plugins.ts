import { readJson } from './json.js';
import type { ClaudePaths, ProjectPaths } from './paths.js';
import { INVALID_NAME, INVALID_VERSION, validName, validVersion } from './text.js';

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

// name@marketplace, each part a plain name.
function validId(id: string): boolean {
  const { name, marketplace } = splitId(id);
  return validName(name) && validName(marketplace);
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
  for (const [key, records] of Object.entries(installed?.plugins ?? {})) {
    const valid = validId(key);
    if (!valid) problems.push(`${paths.installedPlugins}: plugin id is not valid, shown as ${INVALID_NAME}`);
    const id = valid ? key : INVALID_NAME;
    for (const record of records) {
      let version = record.version ?? 'unknown';
      if (!validVersion(version)) {
        problems.push(`${paths.installedPlugins}: ${id}: version is not valid`);
        version = INVALID_VERSION;
      }
      plugins.push({
        id,
        ...(valid ? splitId(id) : { name: INVALID_NAME, marketplace: INVALID_NAME }),
        version,
        scope: record.scope ?? 'user',
        enabled: valid && enabled[id] === true,
        installPath: record.installPath ?? '',
      });
    }
  }
  plugins.sort((a, b) => a.id.localeCompare(b.id));
  return { plugins, problems };
}
