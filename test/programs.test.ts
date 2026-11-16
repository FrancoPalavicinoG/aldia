import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { findProgram } from '../src/programs.js';
import { emptyDir } from './git-env.js';

const windows = process.platform === 'win32';

// A folder holding a program with that name, as this OS would find it.
function folderWith(name: string, file = windows ? `${name}.exe` : name): string {
  const dir = emptyDir();
  writeFileSync(join(dir, file), '', { mode: 0o755 });
  return dir;
}

test('a program is found by its absolute path in PATH', () => {
  const dir = folderWith('git');
  assert.deepEqual(findProgram('git', { PATH: dir }), { path: join(dir, windows ? 'git.exe' : 'git') });
});

test('PATH entries that are relative, empty or inside the repo are skipped', () => {
  const repo = emptyDir();
  mkdirSync(join(repo, 'bin'));
  writeFileSync(join(repo, 'bin', windows ? 'git.exe' : 'git'), '', { mode: 0o755 });
  writeFileSync(join(repo, windows ? 'git.exe' : 'git'), '', { mode: 0o755 });
  const real = folderWith('git');
  // "." and "" mean the current folder, which is the repo when aldia runs there.
  const PATH = ['.', '', 'bin', join(repo, 'bin'), real].join(delimiter);
  assert.deepEqual(findProgram('git', { PATH }, [repo]), { path: join(real, windows ? 'git.exe' : 'git') });
  assert.equal(findProgram('git', { PATH: ['.', join(repo, 'bin')].join(delimiter) }, [repo]).path, undefined);
});

test('on Windows a program only installed as a .cmd script is reported: it needs a shell', { skip: !windows }, () => {
  const dir = folderWith('claude', 'claude.cmd');
  assert.deepEqual(findProgram('claude', { Path: dir }), {
    problem: 'claude is installed as a .cmd script, which aldia runs without a shell and cannot start',
  });
});
