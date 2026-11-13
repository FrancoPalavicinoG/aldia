import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readTaskContext } from '../src/task.js';

const emptyDir = () => mkdtempSync(join(tmpdir(), 'aldia-task-'));

// git with an empty global config and no system config, so the user's ~/.gitconfig
// (identity, default branch, signing, hooks) never changes what the tests see.
const globalConfig = join(emptyDir(), 'gitconfig');
writeFileSync(globalConfig, '');
const env = { ...process.env, GIT_CONFIG_GLOBAL: globalConfig, GIT_CONFIG_NOSYSTEM: '1' };

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-c', 'user.name=aldia', '-c', 'user.email=aldia@example.com', ...args], { cwd, env });

const newRepo = () => {
  const dir = emptyDir();
  git(dir, 'init', '-q', '-b', 'main');
  return dir;
};

test('the current branch and the last 10 commit subjects, newest first', async () => {
  const dir = newRepo();
  git(dir, 'commit', '-q', '--allow-empty', '-m', 'chore: start');
  git(dir, 'checkout', '-q', '-b', 'feat/login');
  for (let i = 1; i <= 10; i++) git(dir, 'commit', '-q', '--allow-empty', '-m', `feat: step ${i}`, '-m', 'body is never read');
  const context = await readTaskContext(dir, env);
  assert.equal(context.repo, true);
  assert.equal(context.branch, 'feat/login');
  assert.equal(context.recentCommits.length, 10);
  assert.equal(context.recentCommits[0], 'feat: step 10');
  assert.ok(!context.recentCommits.includes('chore: start'));
  assert.ok(!context.recentCommits.some((subject) => subject.includes('body')));
});

test('a new repo has a branch but no commits; a detached HEAD has no branch', async () => {
  const dir = newRepo();
  const fresh = await readTaskContext(dir, env);
  assert.equal(fresh.branch, 'main');
  assert.deepEqual(fresh.recentCommits, []);

  git(dir, 'commit', '-q', '--allow-empty', '-m', 'chore: start');
  git(dir, 'checkout', '-q', '--detach');
  const detached = await readTaskContext(dir, env);
  assert.equal(detached.branch, undefined);
  assert.deepEqual(detached.recentCommits, ['chore: start']);
});

test('a folder outside git is not a repo', async () => {
  const context = await readTaskContext(emptyDir(), env);
  assert.equal(context.repo, false);
  assert.deepEqual(context.problems, []);
});

test('without git installed it is reported, not thrown', async () => {
  // PATH pointing at an empty folder (an unset PATH falls back to /usr/bin, which has git).
  const withoutGit = Object.fromEntries(Object.entries(env).filter(([key]) => key.toUpperCase() !== 'PATH'));
  withoutGit.PATH = emptyDir();
  const context = await readTaskContext(newRepo(), withoutGit);
  assert.equal(context.repo, false);
  assert.equal(context.problems.length, 1);
  assert.match(context.problems[0]!, /git/);
});
