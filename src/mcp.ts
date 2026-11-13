import { basename, join, relative, resolve, isAbsolute } from 'node:path';
import { readJson } from './json.js';
import type { ClaudePaths, ProjectPaths } from './paths.js';
import type { InstalledPlugin } from './plugins.js';

export type McpSource = 'local' | 'project' | 'user' | 'plugin';

export interface McpServer {
  name: string;
  transport: string;
  // Where it connects: the URL host for remote servers, the command name for local ones.
  target: string;
  source: McpSource;
  pluginId?: string;
}

export interface McpInventory {
  servers: McpServer[];
  problems: string[];
}

interface ServerConfig {
  type?: string;
  url?: string;
  command?: string;
}

// Server configs hold credentials in headers, env, args and URL queries. Only the
// fields below are copied out; everything else is dropped here, on read.
function describe(name: string, config: ServerConfig, source: McpSource): McpServer {
  const transport = config.type ?? (config.url ? 'http' : 'stdio');
  let target = '';
  if (config.url) {
    try {
      target = new URL(config.url).host;
    } catch {
      target = 'unknown';
    }
  } else if (config.command) {
    target = basename(config.command);
  }
  return { name, transport, target, source };
}

function serversIn(map: unknown, source: McpSource): McpServer[] {
  if (!map || typeof map !== 'object') return [];
  return Object.entries(map as Record<string, ServerConfig>).map(([name, config]) => describe(name, config ?? {}, source));
}

// A server file may wrap its servers in "mcpServers" or list them at the top level.
function unwrap(file: unknown): unknown {
  const wrapped = (file as { mcpServers?: unknown } | undefined)?.mcpServers;
  return wrapped && typeof wrapped === 'object' ? wrapped : file;
}

// A plugin declares servers in .mcp.json at its root and in the manifest's mcpServers,
// which takes an inline map, a path to a JSON file, or an array of those. A manifest
// server replaces a .mcp.json server of the same name. Packaged .mcpb servers and
// paths outside the plugin folder are skipped.
async function pluginServerMap(root: string, problems: string[]): Promise<Record<string, unknown>> {
  const fromFile = unwrap(await readJson(join(root, '.mcp.json'), problems));
  const manifest = (await readJson(join(root, '.claude-plugin', 'plugin.json'), problems)) as { mcpServers?: unknown } | undefined;
  const declared = manifest?.mcpServers;
  const entries = Array.isArray(declared) ? declared : declared === undefined ? [] : [declared];

  const map: Record<string, unknown> = { ...(fromFile && typeof fromFile === 'object' ? fromFile : {}) };
  for (const entry of entries) {
    if (typeof entry === 'string') {
      const path = resolve(root, entry);
      const inside = relative(root, path);
      if (entry.endsWith('.mcpb') || entry.endsWith('.dxt') || inside.startsWith('..') || isAbsolute(inside)) continue;
      Object.assign(map, unwrap(await readJson(path, problems)));
    } else if (entry && typeof entry === 'object') {
      Object.assign(map, entry);
    }
  }
  return map;
}

interface GlobalState {
  mcpServers?: unknown;
  // Per-project state keyed by absolute path. It also holds prompts and costs: only
  // mcpServers is read from it.
  projects?: Record<string, { mcpServers?: unknown } | undefined>;
}

// With a project, its local servers (in .claude.json, under the project's path) and its
// .mcp.json join the user's. Claude Code connects once per name, taking local over
// project over user (https://code.claude.com/docs/en/mcp), so only that one is kept.
export async function readMcpServers(
  paths: ClaudePaths,
  plugins: InstalledPlugin[] = [],
  project?: ProjectPaths,
): Promise<McpInventory> {
  const problems: string[] = [];
  const state = (await readJson(paths.globalState, problems)) as GlobalState | undefined;
  const scoped = [
    ...(project ? serversIn(state?.projects?.[project.root]?.mcpServers, 'local') : []),
    ...(project ? serversIn(unwrap(await readJson(project.mcpJson, problems)), 'project') : []),
    ...serversIn(state?.mcpServers, 'user'),
  ];
  const names = new Set<string>();
  const servers = scoped.filter((server) => !names.has(server.name) && names.add(server.name));

  const seen = new Set<string>();
  for (const plugin of plugins) {
    if (!plugin.installPath || seen.has(plugin.installPath)) continue;
    seen.add(plugin.installPath);
    for (const server of serversIn(await pluginServerMap(plugin.installPath, problems), 'plugin')) {
      servers.push({ ...server, pluginId: plugin.id });
    }
  }

  servers.sort(
    (a, b) =>
      a.source.localeCompare(b.source) || (a.pluginId ?? '').localeCompare(b.pluginId ?? '') || a.name.localeCompare(b.name),
  );
  return { servers, problems };
}
