import { readFile } from 'node:fs/promises';
import type { ClaudePaths } from './paths.js';

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

async function readJson(path: string, problems: string[]): Promise<unknown> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
  try {
    return JSON.parse(text);
  } catch {
    problems.push(`${path}: not valid JSON`);
    return undefined;
  }
}

function splitId(id: string): { name: string; marketplace: string } {
  const at = id.lastIndexOf('@');
  return at > 0 ? { name: id.slice(0, at), marketplace: id.slice(at + 1) } : { name: id, marketplace: '' };
}

export async function readPlugins(paths: ClaudePaths): Promise<PluginInventory> {
  const problems: string[] = [];
  const installed = (await readJson(paths.installedPlugins, problems)) as { plugins?: Record<string, InstallRecord[]> } | undefined;
  const settings = (await readJson(paths.settings, problems)) as { enabledPlugins?: Record<string, boolean> } | undefined;
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
        installPath: record.installPath ?? '',
      });
    }
  }
  plugins.sort((a, b) => a.id.localeCompare(b.id));
  return { plugins, problems };
}
