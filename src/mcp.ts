import { basename, join, relative, resolve, isAbsolute } from 'node:path';
import { isObject, readJson, textField } from './json.js';
import type { ClaudePaths, ProjectPaths } from './paths.js';
import type { InstalledPlugin } from './plugins.js';
import { INVALID_NAME, validName } from './text.js';

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

// The transports Claude Code documents; any other type is shown as "other".
const TRANSPORTS = new Set(['stdio', 'http', 'sse', 'ws']);

// Server configs hold credentials in headers, env, args and URL queries. Only the
// fields below are copied out; everything else is dropped here, on read.
// A field of another type is a problem, and the server is still listed without it.
function describe(name: string, config: unknown, source: McpSource, file: string, problems: string[]): McpServer {
  const where = `${file}: MCP server ${name}`;
  if (!isObject(config)) problems.push(`${where}: not an object`);
  const fields = isObject(config) ? config : {};
  const [type, url, command] = ['type', 'url', 'command'].map((field) => textField(fields, field, where, problems));
  const declared = type ?? (url ? 'http' : 'stdio');
  const transport = TRANSPORTS.has(declared) ? declared : 'other';
  let target = '';
  if (url) {
    try {
      target = new URL(url).host;
    } catch {
      target = 'unknown';
    }
  } else if (command) {
    target = basename(command);
  }
  return { name, transport, target, source };
}

// `file` is where the servers were declared, for problems.
function serversIn(map: unknown, source: McpSource, file: string, problems: string[]): McpServer[] {
  if (!map || typeof map !== 'object') return [];
  return Object.entries(map).map(([name, config]) => {
    if (validName(name)) return describe(name, config, source, file, problems);
    problems.push(`${file}: MCP server name is not valid, shown as ${INVALID_NAME}`);
    return describe(INVALID_NAME, config, source, file, problems);
  });
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

  // No prototype: a server named "__proto__" is copied as a server, instead of
  // replacing the map's prototype and hiding what it holds.
  const map: Record<string, unknown> = Object.assign(Object.create(null), fromFile && typeof fromFile === 'object' ? fromFile : {});
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
    ...(project ? serversIn(state?.projects?.[project.root]?.mcpServers, 'local', paths.globalState, problems) : []),
    ...(project ? serversIn(unwrap(await readJson(project.mcpJson, problems)), 'project', project.mcpJson, problems) : []),
    ...serversIn(state?.mcpServers, 'user', paths.globalState, problems),
  ];
  const names = new Set<string>();
  const servers = scoped.filter((server) => server.name === INVALID_NAME || (!names.has(server.name) && names.add(server.name)));

  const seen = new Set<string>();
  for (const plugin of plugins) {
    if (!plugin.installPath || seen.has(plugin.installPath)) continue;
    seen.add(plugin.installPath);
    for (const server of serversIn(await pluginServerMap(plugin.installPath, problems), 'plugin', plugin.installPath, problems)) {
      servers.push({ ...server, pluginId: plugin.id });
    }
  }

  servers.sort(
    (a, b) =>
      a.source.localeCompare(b.source) || (a.pluginId ?? '').localeCompare(b.pluginId ?? '') || a.name.localeCompare(b.name),
  );
  return { servers, problems };
}
