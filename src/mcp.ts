import { basename } from 'node:path';
import { readJson } from './json.js';
import type { ClaudePaths } from './paths.js';

export type McpSource = 'user';

export interface McpServer {
  name: string;
  transport: string;
  // Where it connects: the URL host for remote servers, the command name for local ones.
  target: string;
  source: McpSource;
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

export async function readMcpServers(paths: ClaudePaths): Promise<McpInventory> {
  const problems: string[] = [];
  const state = (await readJson(paths.globalState, problems)) as { mcpServers?: unknown } | undefined;
  const servers = serversIn(state?.mcpServers, 'user');
  servers.sort((a, b) => a.source.localeCompare(b.source) || a.name.localeCompare(b.name));
  return { servers, problems };
}
