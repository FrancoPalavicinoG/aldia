import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const emptyDir = () => mkdtempSync(join(tmpdir(), 'aldia-task-'));

// git with an empty global config and no system config, so the user's ~/.gitconfig
// (identity, default branch, signing, hooks) never changes what the tests see.
const globalConfig = join(emptyDir(), 'gitconfig');
writeFileSync(globalConfig, '');
export const env = { ...process.env, GIT_CONFIG_GLOBAL: globalConfig, GIT_CONFIG_NOSYSTEM: '1' };

export const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-c', 'user.name=aldia', '-c', 'user.email=aldia@example.com', ...args], { cwd, env });

export const newRepo = () => {
  const dir = emptyDir();
  git(dir, 'init', '-q', '-b', 'main');
  return dir;
};

// A command for a repo's git config that leaves a mark when git runs it, and passes its
// input through (a filter must). Paths use '/', which git's shell reads on every OS.
// With `exits`, it ends at once instead: git waits on a transport that keeps its input open.
export function witness({ exits = false } = {}): { command: string; program: string; script: string; ran: () => boolean } {
  const dir = emptyDir();
  const mark = join(dir, 'ran');
  const script = join(dir, 'witness.cjs');
  const then = exits ? 'process.exit(1);' : 'process.stdin.pipe(process.stdout);';
  writeFileSync(script, `require('fs').writeFileSync(${JSON.stringify(mark)}, ''); ${then}`);
  const slash = (path: string) => path.replace(/\\/g, '/');
  const [program, file] = [slash(process.execPath), slash(script)];
  return { command: `"${program}" "${file}"`, program, script: file, ran: () => existsSync(mark) };
}
