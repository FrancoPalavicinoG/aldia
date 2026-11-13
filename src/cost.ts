import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import type { ClaudePaths } from './paths.js';
import type { Skill, SkillSource } from './skills.js';
import { dirEntries } from './usage.js';

// The listing caps description + when_to_use at this many characters per skill
// (https://code.claude.com/docs/en/skills).
const LISTING_CAP = 1536;

export interface SkillCost {
  name: string;
  source: SkillSource;
  pluginId?: string;
  // Characters this skill adds to the context on every turn.
  chars: number;
  // Rough estimate: chars / 4.
  tokens: number;
}

export interface McpCost {
  // As in tool names (mcp__<name>__<tool>).
  name: string;
  tools: number;
  chars: number;
  tokens: number;
}

export interface ContextCost {
  skills: SkillCost[];
  mcpServers: McpCost[];
  // When the session the MCP numbers come from was last written, ISO.
  measuredAt?: string;
  problems: string[];
}

const tokens = (chars: number) => Math.ceil(chars / 4);

// Tool names carry the server name with anything outside [A-Za-z0-9_-] turned into "_"
// ("claude.ai Linear" -> claude_ai_Linear); instructions use the display name.
export const serverKey = (name: string) => name.replace(/[^A-Za-z0-9_-]/g, '_');

async function latestSession(projectsDir: string): Promise<{ path: string; mtime: Date } | undefined> {
  let latest: { path: string; mtime: Date } | undefined;
  for (const project of await dirEntries(projectsDir)) {
    if (!project.isDirectory()) continue;
    for (const file of await dirEntries(join(projectsDir, project.name))) {
      if (!file.isFile() || !file.name.endsWith('.jsonl')) continue;
      const path = join(projectsDir, project.name, file.name);
      const { mtime } = await stat(path);
      if (!latest || mtime > latest.mtime) latest = { path, mtime };
    }
  }
  return latest;
}

interface Delta {
  type?: unknown;
  addedNames?: unknown;
  addedBlocks?: unknown;
  removedNames?: unknown;
}

const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((v) => typeof v === 'string') : []);

// MCP tools load as names only (tool search) plus each server's instructions. A session
// records what it loaded as deltas: tool names added and removed, instructions added and
// removed. Replaying them gives what was loaded at the end. Only counts and lengths are
// kept, never the instruction text.
async function mcpLoaded(path: string): Promise<McpCost[]> {
  const tools = new Map<string, Set<string>>();
  const instructions = new Map<string, number>();
  const lines = createInterface({ input: createReadStream(path, 'utf8'), crlfDelay: Infinity });
  for await (const line of lines) {
    if (!line.includes('deferred_tools_delta') && !line.includes('mcp_instructions_delta')) continue;
    let delta: Delta | undefined;
    try {
      delta = (JSON.parse(line) as { attachment?: Delta }).attachment;
    } catch {
      continue;
    }
    if (delta?.type === 'deferred_tools_delta') {
      for (const name of strings(delta.addedNames)) {
        const server = /^mcp__(.+?)__/.exec(name)?.[1];
        if (server) tools.set(server, (tools.get(server) ?? new Set()).add(name));
      }
      for (const name of strings(delta.removedNames)) {
        const server = /^mcp__(.+?)__/.exec(name)?.[1];
        if (server) tools.get(server)?.delete(name);
      }
    } else if (delta?.type === 'mcp_instructions_delta') {
      const blocks = strings(delta.addedBlocks);
      strings(delta.addedNames).forEach((name, i) => instructions.set(serverKey(name), blocks[i]?.length ?? 0));
      for (const name of strings(delta.removedNames)) instructions.delete(serverKey(name));
    }
  }

  const servers = new Set([...tools.keys(), ...instructions.keys()]);
  return [...servers].sort().map((name) => {
    const names = [...(tools.get(name) ?? [])];
    const chars = names.reduce((sum, tool) => sum + tool.length + 1, 0) + (instructions.get(name) ?? 0);
    return { name, tools: names.length, chars, tokens: tokens(chars) };
  });
}

// What each item adds to the context of every session before the user types anything.
// A skill is listed by name with its description and when_to_use, unless only the user
// can invoke it. MCP servers are measured from the last session, the only place their
// tools are known without connecting to them.
export async function readContextCost(paths: ClaudePaths, skills: Skill[]): Promise<ContextCost> {
  const skillCosts = skills.map((skill): SkillCost => {
    const text = [skill.description, skill.whenToUse].filter(Boolean).join(' ');
    const chars = skill.modelInvocable ? skill.name.length + 2 + Math.min(text.length, LISTING_CAP) : 0;
    return { name: skill.name, source: skill.source, ...(skill.pluginId ? { pluginId: skill.pluginId } : {}), chars, tokens: tokens(chars) };
  });

  const problems: string[] = [];
  const session = await latestSession(paths.projectsDir);
  let mcpServers: McpCost[] = [];
  if (session) {
    try {
      mcpServers = await mcpLoaded(session.path);
    } catch {
      problems.push(`${session.path}: could not be read`);
    }
  }
  return {
    skills: skillCosts,
    mcpServers,
    ...(session ? { measuredAt: session.mtime.toISOString() } : {}),
    problems,
  };
}
