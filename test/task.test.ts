import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { delimiter } from 'node:path';
import { join } from 'node:path';
import { readTaskContext } from '../src/task.js';
import { emptyDir, env, git, newRepo, witness } from './git-env.js';

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

// A repo whose file changed but kept its size and an old time: git has to compare its
// content, which is when it runs filters.
function changedRepo(): string {
  const dir = newRepo();
  writeFileSync(join(dir, 'a.txt'), 'one\n');
  git(dir, 'add', '.');
  git(dir, 'commit', '-q', '-m', 'chore: start');
  writeFileSync(join(dir, 'a.txt'), 'two\n');
  utimesSync(join(dir, 'a.txt'), new Date('2020-01-01'), new Date('2020-01-01'));
  return dir;
}

test("the repo's git config can't run commands: fsmonitor, filters, signatures", async () => {
  const cases: [string, (dir: string, command: string) => void][] = [
    ['fsmonitor', (dir, command) => git(dir, 'config', 'core.fsmonitor', command)],
    ['filter in .gitattributes', (dir, command) => {
      git(dir, 'config', 'filter.x.clean', command);
      writeFileSync(join(dir, '.gitattributes'), '*.txt filter=x\n');
    }],
    ['filter in .git/info/attributes', (dir, command) => {
      git(dir, 'config', 'filter.x.process', command);
      git(dir, 'config', 'filter.x.required', 'true');
      writeFileSync(join(dir, '.git', 'info', 'attributes'), '*.txt filter=x\n');
    }],
    // A "=" would split a -c argument; names reach git through the environment instead.
    ['filter with "=" in its name', (dir, command) => {
      git(dir, 'config', 'filter.x=y.clean', command);
      writeFileSync(join(dir, '.gitattributes'), '*.txt filter=x=y\n');
    }],
    ['signature check', (dir, command) => {
      git(dir, 'config', 'log.showSignature', 'true');
      git(dir, 'config', 'gpg.program', command);
    }],
  ];
  const ran: string[] = [];
  const missed: string[] = [];
  for (const [name, arm] of cases) {
    const dir = changedRepo();
    const mark = witness();
    arm(dir, mark.command);
    const context = await readTaskContext(dir, env);
    if (mark.ran()) ran.push(name);
    if (!context.changedFiles.includes('a.txt')) missed.push(name);
  }
  assert.deepEqual({ ran, missed }, { ran: [], missed: [] });
});

// A partial clone fetches the objects it lacks when a command needs them, the way the
// repo's config says: through its ssh command, or through any program (an ext:: remote).
test("a repo that lacks objects can't make git fetch them through a command", async () => {
  const cases: [string, (dir: string, mark: ReturnType<typeof witness>) => void][] = [
    ['ssh command', (dir, mark) => {
      git(dir, 'config', 'remote.origin.url', 'ssh://example.invalid/repo');
      git(dir, 'config', 'core.sshCommand', mark.command);
    }],
    // In an ext:: address "% " is a space inside one word.
    ['ext remote', (dir, mark) => {
      const word = (text: string) => text.replace(/ /g, '% ');
      git(dir, 'config', 'remote.origin.url', `ext::${word(mark.program)} ${word(mark.script)}`);
      git(dir, 'config', 'protocol.ext.allow', 'always');
    }],
  ];
  const ran: string[] = [];
  for (const [name, arm] of cases) {
    const dir = changedRepo();
    const tree = git(dir, 'rev-parse', 'HEAD^{tree}').toString().trim();
    rmSync(join(dir, '.git', 'objects', tree.slice(0, 2), tree.slice(2)), { force: true });
    git(dir, 'config', 'extensions.partialClone', 'origin');
    git(dir, 'config', 'remote.origin.promisor', 'true');
    const mark = witness({ exits: true });
    arm(dir, mark);
    await readTaskContext(dir, env);
    if (mark.ran()) ran.push(name);
  }
  assert.deepEqual(ran, []);
});

test('reading the repo never rewrites its index', async () => {
  // A file touched but not changed: a plain git status would refresh the index.
  const dir = newRepo();
  writeFileSync(join(dir, 'a.txt'), 'one\n');
  git(dir, 'add', '.');
  git(dir, 'commit', '-q', '-m', 'chore: start');
  utimesSync(join(dir, 'a.txt'), new Date('2030-01-01'), new Date('2030-01-01'));
  const index = join(dir, '.git', 'index');
  const before = readFileSync(index);
  await readTaskContext(dir, env);
  assert.deepEqual(readFileSync(index), before);
});

test("a folder shaped like a bare repo inside the project is not used as git's config", async () => {
  const outer = newRepo();
  const bare = join(outer, 'vendor', 'repo.git');
  mkdirSync(bare, { recursive: true });
  git(bare, 'init', '-q', '--bare');
  const mark = witness();
  git(bare, 'config', 'core.bare', 'false');
  git(bare, 'config', 'core.worktree', '..');
  git(bare, 'config', 'core.fsmonitor', mark.command);
  const context = await readTaskContext(bare, env);
  assert.equal(mark.ran(), false);
  assert.equal(context.repo, false);
});

test("a submodule's own config can't run commands", async () => {
  const sub = changedRepo();
  const dir = newRepo();
  git(dir, 'commit', '-q', '--allow-empty', '-m', 'chore: start');
  git(dir, '-c', 'protocol.file.allow=always', 'submodule', 'add', '-q', sub, 'sub');
  writeFileSync(join(dir, 'sub', 'a.txt'), 'three\n');
  const mark = witness();
  git(join(dir, 'sub'), 'config', 'core.fsmonitor', mark.command);
  await readTaskContext(dir, env);
  assert.equal(mark.ran(), false);
});

// Windows looks for a program in the folder it runs in before PATH: a git.exe committed at
// the repo root would run. The stand-in there is a copy of node: it can't read git's
// arguments, so if it ran instead of git the folder wouldn't be seen as a repo. Elsewhere
// a bin/git in the repo, put on PATH (as direnv does), leaves a mark if it runs.
test('a git committed in the repo is never run: not at its root, nor in a PATH entry inside it', async () => {
  const dir = newRepo();
  const mark = witness();
  let testEnv: NodeJS.ProcessEnv;
  if (process.platform === 'win32') {
    copyFileSync(process.execPath, join(dir, 'git.exe'));
    testEnv = env;
  } else {
    mkdirSync(join(dir, 'bin'));
    writeFileSync(join(dir, 'bin', 'git'), `#!/bin/sh\n${mark.command}\n`, { mode: 0o755 });
    testEnv = { ...env, PATH: [join(dir, 'bin'), process.env.PATH].join(delimiter) };
  }
  const context = await readTaskContext(dir, testEnv);
  assert.equal(mark.ran(), false, 'the repo\'s git ran');
  assert.equal(context.repo, true, 'the repo\'s git ran instead of git');
});
