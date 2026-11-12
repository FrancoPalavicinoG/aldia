import { readFile } from 'node:fs/promises';
import type { ClaudePaths } from './paths.js';

export interface InstalledPlugin {
  id: string;
  name: string;
  marketplace: string;
  version: string;
  scope: string;
  enabled: boolean;
}

export interface PluginInventory {
  plugins: InstalledPlugin[];
  problems: string[];
}

interface InstallRecord {
  scope?: string;
  version?: string;
}

async function readJson(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

function splitId(id: string): { name: string; marketplace: string } {
  const at = id.lastIndexOf('@');
  return at > 0 ? { name: id.slice(0, at), marketplace: id.slice(at + 1) } : { name: id, marketplace: '' };
}

export async function readPlugins(paths: ClaudePaths): Promise<PluginInventory> {
  const installed = (await readJson(paths.installedPlugins)) as { plugins?: Record<string, InstallRecord[]> } | undefined;
  const settings = (await readJson(paths.settings)) as { enabledPlugins?: Record<string, boolean> } | undefined;
  const enabled = settings?.enabledPlugins ?? {};

  const plugins: InstalledPlugin[] = [];
  for (const [id, records] of Object.entries(installed?.plugins ?? {})) {
    for (const record of records) {
      plugins.push({
        id,
        ...splitId(id),
        version: record.version ?? 'unknown',
        scope: record.scope ?? 'user',
        enabled: enabled[id] === true,
      });
    }
  }
  plugins.sort((a, b) => a.id.localeCompare(b.id));
  return { plugins, problems: [] };
}
