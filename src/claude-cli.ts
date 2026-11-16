import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

// Changes to plugins and MCP servers go through Claude Code's own CLI, which knows its
// files (installed_plugins.json, the plugin cache, ~/.claude.json). Only the operations
// listed here can run, each built from a fixed list of arguments.

// The user's own config only: "project" would write the team's files in the repo
// (.claude/settings.json, .mcp.json). "local" is this user in the current project.
export type Scope = 'user' | 'local';

export type Operation =
  | { kind: 'disable-plugin'; plugin: string; scope: Scope }
  | { kind: 'uninstall-plugin'; plugin: string; scope: Scope }
  | { kind: 'remove-mcp'; server: string; scope: Scope };

const SCOPES = new Set<string>(['user', 'local']);
// Starts with a letter or digit, so it can never pass as an option ("-s", "--scope").
const NAME = '[A-Za-z0-9][A-Za-z0-9._-]*';
const PLUGIN_ID = new RegExp(`^${NAME}@${NAME}$`);
const SERVER = new RegExp(`^${NAME}$`);

function check(ok: boolean, what: string): void {
  if (!ok) throw new Error(`refused: ${what}`);
}

export function commandFor(op: Operation): string[] {
  check(SCOPES.has(op.scope), `scope must be user or local, not ${JSON.stringify(op.scope)}`);
  switch (op.kind) {
    case 'disable-plugin':
    case 'uninstall-plugin':
      check(PLUGIN_ID.test(op.plugin), `not a plugin id (name@marketplace): ${JSON.stringify(op.plugin)}`);
      return ['plugin', op.kind === 'disable-plugin' ? 'disable' : 'uninstall', op.plugin, '--scope', op.scope, '--json'];
    case 'remove-mcp':
      check(SERVER.test(op.server), `not an MCP server name: ${JSON.stringify(op.server)}`);
      return ['mcp', 'remove', op.server, '--scope', op.scope];
  }
}

export interface RunOptions {
  // The project folder: required for local scope, which belongs to it.
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  // How to start the CLI; tests point it at a stand-in.
  claude?: string[];
  timeout?: number;
}

export interface RunResult {
  ok: boolean;
  problem?: string;
}

// The --json result line the plugin commands print on stdout.
interface CliResult {
  failureCode?: unknown;
  alreadyInGoalState?: unknown;
}

function cliResult(stdout: string): CliResult | undefined {
  for (const line of stdout.split('\n')) {
    if (!line.startsWith('{')) continue;
    try {
      return JSON.parse(line) as CliResult;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

// Runs one operation with no shell: the arguments reach the CLI as they are, so no name
// can become part of a command. Of what the CLI prints only its failure code is kept: its
// messages can carry paths or values.
export async function runOperation(op: Operation, options: RunOptions = {}): Promise<RunResult> {
  const args = commandFor(op);
  check(op.scope !== 'local' || !!options.cwd, 'local scope needs the project folder');
  const [bin = 'claude', ...prefix] = options.claude ?? ['claude'];
  const what = `claude ${args.slice(0, 3).join(' ')}`;
  try {
    await run(bin, [...prefix, ...args], {
      ...(options.cwd ? { cwd: options.cwd } : {}),
      env: options.env ?? process.env,
      timeout: options.timeout ?? 60_000,
      encoding: 'utf8',
    });
    return { ok: true };
  } catch (error) {
    const failure = error as NodeJS.ErrnoException & { stdout?: string; killed?: boolean; code?: string | number };
    if (failure.code === 'ENOENT') return { ok: false, problem: 'claude could not be run (not installed or not on PATH)' };
    if (failure.killed) return { ok: false, problem: `${what} timed out` };
    const result = cliResult(failure.stdout ?? '');
    // Already disabled or already gone: the goal is met.
    if (result?.alreadyInGoalState === true) return { ok: true };
    const code = typeof result?.failureCode === 'string' && /^[a-z_]+$/.test(result.failureCode) ? result.failureCode : undefined;
    return { ok: false, problem: code ? `${what} failed: ${code}` : `${what} failed (exit ${failure.code ?? '?'})` };
  }
}
