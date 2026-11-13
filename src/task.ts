import { execFile } from 'node:child_process';
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

// Runs a read-only git command with a fixed argument list and no shell, so nothing from
// the repo can become part of a command. A failing command (not a repo, no commits...)
// gives undefined; git missing from PATH throws.
async function git(root: string, env: NodeJS.ProcessEnv, ...args: string[]): Promise<string | undefined> {
  try {
    const { stdout } = await run('git', args, { cwd: root, env, timeout: 5000, encoding: 'utf8' });
    return stdout;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw error;
    return undefined;
  }
}

export async function readTaskContext(root: string, env: NodeJS.ProcessEnv = process.env): Promise<TaskContext> {
  const context: TaskContext = { repo: false, recentCommits: [], changedFiles: [], changedTotal: 0, problems: [] };

  let inside: string | undefined;
  try {
    inside = await git(root, env, 'rev-parse', '--is-inside-work-tree');
  } catch {
    context.problems.push('git could not be run (not installed or not on PATH)');
    return context;
  }
  if (inside?.trim() !== 'true') return context;
  context.repo = true;

  const branch = (await git(root, env, 'symbolic-ref', '-q', '--short', 'HEAD'))?.trim();
  if (branch) context.branch = branch;

  // --no-show-signature: a user setting could otherwise mix signature output into the list.
  const log = await git(root, env, 'log', `-${MAX_COMMITS}`, '--no-show-signature', '--format=%s');
  context.recentCommits = log ? log.split('\n').filter(Boolean) : [];

  const changed = changedPaths((await git(root, env, 'status', '--porcelain', '-z')) ?? '');
  context.changedFiles = changed.slice(0, MAX_CHANGED);
  context.changedTotal = changed.length;

  return context;
}
