import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

// What the user is working on right now, read from git: names and commit subjects only,
// never file contents or diffs.
export interface TaskContext {
  repo: boolean;
  // Undefined on a detached HEAD.
  branch?: string;
  // Subjects of the latest commits, newest first.
  recentCommits: string[];
  // Uncommitted changes (staged, unstaged and new files), capped; changedTotal is the real count.
  changedFiles: string[];
  changedTotal: number;
  problems: string[];
}

const MAX_COMMITS = 10;
const MAX_CHANGED = 50;

// `git status --porcelain -z`: entries split by NUL, each "XY path". A rename or copy
// (X or Y is R or C) is followed by one extra entry with the old path, which is skipped.
function changedPaths(status: string): string[] {
  const entries = status.split('\0');
  const paths: string[] = [];
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]!;
    if (entry.length < 4) continue;
    paths.push(entry.slice(3));
    if (/[RC]/.test(entry.slice(0, 2))) i++;
  }
  return paths;
}

// git reads the repo's own config, and some of it runs commands: fsmonitor, filters (run
// when status compares contents), hooks, a bare repo's config committed in a subfolder,
// submodules' configs. Settings passed through the environment win over the repo's, and
// a value given there never becomes part of an argument, whatever the repo names it.
// A folder that is never created: no hook can be found there.
const NO_HOOKS = join(tmpdir(), `aldia-no-hooks-${randomUUID()}`);
const SAFE_CONFIG: [string, string][] = [
  ['core.fsmonitor', 'false'],
  ['core.hooksPath', NO_HOOKS],
  ['safe.bareRepository', 'explicit'],
];

function withConfig(env: NodeJS.ProcessEnv, settings: [string, string][]): NodeJS.ProcessEnv {
  const start = Number(env.GIT_CONFIG_COUNT) || 0;
  const added: NodeJS.ProcessEnv = { GIT_CONFIG_COUNT: String(start + settings.length) };
  settings.forEach(([key, value], i) => {
    added[`GIT_CONFIG_KEY_${start + i}`] = key;
    added[`GIT_CONFIG_VALUE_${start + i}`] = value;
  });
  return { ...env, ...added };
}

type GitResult = { ok: true; stdout: string } | { ok: false; exitCode?: number };

// Runs a read-only git command with a fixed argument list and no shell, so nothing from
// the repo can become part of a command. --no-optional-locks: git doesn't rewrite the
// index. git missing from PATH throws.
async function git(root: string, env: NodeJS.ProcessEnv, ...args: string[]): Promise<GitResult> {
  try {
    const { stdout } = await run('git', ['--no-pager', '--no-optional-locks', ...args], {
      cwd: root,
      env,
      timeout: 5000,
      encoding: 'utf8',
    });
    return { ok: true, stdout };
  } catch (error) {
    const failure = error as NodeJS.ErrnoException & { code?: string | number };
    if (failure.code === 'ENOENT') throw error;
    return typeof failure.code === 'number' ? { ok: false, exitCode: failure.code } : { ok: false };
  }
}

const output = (result: GitResult) => (result.ok ? result.stdout : undefined);

// Every filter the repo's config names, turned off. Names come NUL-separated (-z), so no
// name can pass for two. Undefined when they can't be read: then status must not run.
async function filtersOff(root: string, env: NodeJS.ProcessEnv): Promise<[string, string][] | undefined> {
  const result = await git(root, env, 'config', '-z', '--name-only', '--get-regexp', '^filter\\.');
  // Exit 1: no filter at all.
  if (!result.ok) return result.exitCode === 1 ? [] : undefined;
  const names = new Set(
    result.stdout
      .split('\0')
      .filter(Boolean)
      .map((key) => key.slice('filter.'.length, key.lastIndexOf('.'))),
  );
  return [...names].flatMap((name): [string, string][] => [
    [`filter.${name}.clean`, ''],
    [`filter.${name}.smudge`, ''],
    [`filter.${name}.process`, ''],
    [`filter.${name}.required`, 'false'],
  ]);
}

export async function readTaskContext(root: string, env: NodeJS.ProcessEnv = process.env): Promise<TaskContext> {
  const context: TaskContext = { repo: false, recentCommits: [], changedFiles: [], changedTotal: 0, problems: [] };
  const safe = withConfig(env, SAFE_CONFIG);

  let inside: GitResult;
  try {
    inside = await git(root, safe, 'rev-parse', '--is-inside-work-tree');
  } catch {
    context.problems.push('git could not be run (not installed or not on PATH)');
    return context;
  }
  if (output(inside)?.trim() !== 'true') return context;
  context.repo = true;

  const branch = output(await git(root, safe, 'symbolic-ref', '-q', '--short', 'HEAD'))?.trim();
  if (branch) context.branch = branch;

  // --no-show-signature: a user setting could otherwise mix signature output into the list
  // and run the signature program.
  const log = output(await git(root, safe, 'log', `-${MAX_COMMITS}`, '--no-show-signature', '--format=%s'));
  context.recentCommits = log ? log.split('\n').filter(Boolean) : [];

  const filters = await filtersOff(root, safe);
  if (!filters) {
    context.problems.push("git filters couldn't be read; uncommitted changes not checked");
    return context;
  }
  const status = await git(root, withConfig(safe, filters), 'status', '--porcelain', '-z', '--ignore-submodules=all');
  const changed = changedPaths(output(status) ?? '');
  context.changedFiles = changed.slice(0, MAX_CHANGED);
  context.changedTotal = changed.length;

  return context;
}
