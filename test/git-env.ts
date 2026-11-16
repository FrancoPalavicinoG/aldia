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
export function witness(): { command: string; ran: () => boolean } {
  const dir = emptyDir();
  const mark = join(dir, 'ran');
  const script = join(dir, 'witness.cjs');
  writeFileSync(script, `require('fs').writeFileSync(${JSON.stringify(mark)}, ''); process.stdin.pipe(process.stdout);`);
  const slash = (path: string) => path.replace(/\\/g, '/');
  return { command: `"${slash(process.execPath)}" "${slash(script)}"`, ran: () => existsSync(mark) };
}
