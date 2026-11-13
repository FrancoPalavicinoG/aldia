import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
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
