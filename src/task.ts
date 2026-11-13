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
  problems: string[];
}

const MAX_COMMITS = 10;

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
  const context: TaskContext = { repo: false, recentCommits: [], problems: [] };

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

  return context;
}
