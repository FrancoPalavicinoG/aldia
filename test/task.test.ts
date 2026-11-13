import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readTaskContext } from '../src/task.js';
import { emptyDir, env, git, newRepo } from './git-env.js';

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

test('uncommitted changes: modified, deleted, renamed and new files, by path only', async () => {
  const dir = newRepo();
  for (const file of ['a.ts', 'b.ts', 'old.ts']) writeFileSync(join(dir, file), `${file}\n`);
  git(dir, 'add', '.');
  git(dir, 'commit', '-q', '-m', 'chore: start');
  writeFileSync(join(dir, 'a.ts'), 'changed\n');
  git(dir, 'rm', '-q', 'b.ts');
  git(dir, 'mv', 'old.ts', 'new name.ts');
  writeFileSync(join(dir, 'my notes.md'), 'draft\n');
  const context = await readTaskContext(dir, env);
  assert.deepEqual([...context.changedFiles].sort(), ['a.ts', 'b.ts', 'my notes.md', 'new name.ts']);
  assert.equal(context.changedTotal, 4);
});

test('the list stops at 50 files and keeps the real total', async () => {
  const dir = newRepo();
  for (let i = 0; i < 60; i++) writeFileSync(join(dir, `file-${i}.txt`), '');
  const context = await readTaskContext(dir, env);
  assert.equal(context.changedFiles.length, 50);
  assert.equal(context.changedTotal, 60);
});
