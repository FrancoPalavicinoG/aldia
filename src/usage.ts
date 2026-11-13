import { createReadStream } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import type { ClaudePaths } from './paths.js';

export interface UseCount {
  count: number;
  // ISO timestamp of the latest use.
  lastUsed: string;
}

// What the user actually used in the last days, read from Claude Code's session
// history. Names are as the history writes them: skills as "plugin:skill" or "skill",
// MCP servers by the name in their tool names (mcp__<server>__<tool>), commands as typed.
export interface Usage {
  // Start of the window, ISO.
  since: string;
  sessions: number;
  skills: Record<string, UseCount>;
  mcpServers: Record<string, UseCount>;
  commands: Record<string, UseCount>;
  problems: string[];
}

export interface UsageOptions {
  now?: Date;
  days?: number;
}

interface Entry {
  type?: unknown;
  timestamp?: unknown;
  message?: { content?: unknown };
}

type Counts = Record<'skills' | 'mcpServers' | 'commands', Map<string, UseCount>>;

// The command the user typed is recorded as <command-name>/name</command-name> in their
// message, followed by its arguments, which are not read.
const COMMAND = /<command-name>(\/[^<\s]{1,100})<\/command-name>/;

// Session files hold everything: prompts, code, command output, maybe secrets. Only tool
// names, the skill name of a Skill call, the command name and the timestamp are taken.
// A line that can't hold either is skipped without parsing, a line that isn't valid JSON
// (a session still being written) is ignored, and so is anything before `since`.
async function scanSession(path: string, since: string, counts: Counts) {
  const lines = createInterface({ input: createReadStream(path, 'utf8'), crlfDelay: Infinity });
  for await (const line of lines) {
    if (!line.includes('"tool_use"') && !line.includes('<command-name>')) continue;
    let entry: Entry;
    try {
      entry = JSON.parse(line) as Entry;
    } catch {
      continue;
    }
    const when = typeof entry.timestamp === 'string' ? entry.timestamp : '';
    if (when < since) continue;
    const content = entry.message?.content;
    if (entry.type === 'user' && typeof content === 'string') {
      const command = COMMAND.exec(content)?.[1];
      if (command) count(counts.commands, command, when);
    }
    if (!Array.isArray(content)) continue;
    for (const block of content as { type?: unknown; name?: unknown; input?: { skill?: unknown } }[]) {
      if (block?.type !== 'tool_use' || typeof block.name !== 'string') continue;
      if (block.name === 'Skill' && typeof block.input?.skill === 'string') count(counts.skills, block.input.skill, when);
      const server = /^mcp__(.+?)__/.exec(block.name)?.[1];
      if (server) count(counts.mcpServers, server, when);
    }
  }
}

// Maps, not plain objects: a name from the history like "__proto__" stays a plain key.
function count(map: Map<string, UseCount>, name: string, when: string): void {
  const seen = map.get(name) ?? { count: 0, lastUsed: '' };
  seen.count++;
  if (when > seen.lastUsed) seen.lastUsed = when;
  map.set(name, seen);
}

export async function dirEntries(dir: string) {
  try {
    return await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

const DAY = 24 * 60 * 60 * 1000;

export async function readUsage(paths: ClaudePaths, { now = new Date(), days = 30 }: UsageOptions = {}): Promise<Usage> {
  const since = new Date(now.getTime() - days * DAY).toISOString();
  const counts: Counts = { skills: new Map(), mcpServers: new Map(), commands: new Map() };
  const problems: string[] = [];
  let sessions = 0;

  // A file last written before the window can't hold anything inside it: not opened.
  // Returns whether the file was scanned.
  const scan = async (path: string): Promise<boolean> => {
    try {
      if ((await stat(path)).mtime.toISOString() < since) return false;
      await scanSession(path, since, counts);
      return true;
    } catch {
      problems.push(`${path}: could not be read`);
      return false;
    }
  };

  // projects/<project>/<session>.jsonl, and its subagents in <session>/subagents/*.jsonl.
  for (const project of await dirEntries(paths.projectsDir)) {
    if (!project.isDirectory()) continue;
    const projectDir = join(paths.projectsDir, project.name);
    for (const item of await dirEntries(projectDir)) {
      if (item.isFile() && item.name.endsWith('.jsonl')) {
        if (await scan(join(projectDir, item.name))) sessions++;
      } else if (item.isDirectory()) {
        const subagents = join(projectDir, item.name, 'subagents');
        for (const file of await dirEntries(subagents)) {
          if (file.isFile() && file.name.endsWith('.jsonl')) await scan(join(subagents, file.name));
        }
      }
    }
  }

  return {
    since,
    sessions,
    skills: Object.fromEntries(counts.skills),
    mcpServers: Object.fromEntries(counts.mcpServers),
    commands: Object.fromEntries(counts.commands),
    problems,
  };
}
