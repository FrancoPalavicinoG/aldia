import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { backup, restoreLatest } from '../src/backup.js';
import { resolveClaudePaths, type ClaudePaths } from '../src/paths.js';

const SECRET = '{"mcpServers":{"db":{"env":{"TOKEN":"FAKE-SECRET"}}}}';
const posix = process.platform !== 'win32';

// A temporary home with a user settings file and a .claude.json holding a secret.
function setup(): ClaudePaths {
  const home = mkdtempSync(join(tmpdir(), 'aldia-home-'));
  mkdirSync(join(home, '.claude'));
  writeFileSync(join(home, '.claude', 'settings.json'), '{"theme":"dark"}');
  writeFileSync(join(home, '.claude.json'), SECRET);
  return resolveClaudePaths({ HOME: home });
}

const mode = (path: string) => statSync(path).mode & 0o777;

test('a backup keeps an exact private copy of each file, and notes the ones that did not exist', async () => {
  const paths = setup();
  const missing = join(paths.home, 'project', '.claude', 'settings.local.json');
  const saved = await backup(paths, [paths.settings, paths.globalState, missing], { now: new Date('2026-11-13T18:02:11.123Z') });

  assert.equal(saved.dir, join(paths.backupsDir, '2026-11-13T18-02-11-123Z'));
  const manifest = JSON.parse(readFileSync(join(saved.dir, 'manifest.json'), 'utf8'));
  assert.deepEqual(
    manifest.files.map((f: { path: string; existed: boolean }) => [f.path, f.existed]),
    [
      [paths.settings, true],
      [paths.globalState, true],
      [missing, false],
    ],
  );
  const copies = manifest.files.filter((f: { copy?: string }) => f.copy).map((f: { copy: string }) => readFileSync(join(saved.dir, f.copy), 'utf8'));
  assert.deepEqual(copies, ['{"theme":"dark"}', SECRET]);
  // The manifest names files, it never holds what they say.
  assert.ok(!JSON.stringify(manifest).includes('FAKE-SECRET'));

  if (posix) {
    assert.equal(mode(paths.backupsDir), 0o700);
    assert.equal(mode(saved.dir), 0o700);
    for (const name of readdirSync(saved.dir)) assert.equal(mode(join(saved.dir, name)), 0o600, name);
  }
});

test('restoring the latest backup puts each file back as it was, and removes the ones that did not exist', async () => {
  const paths = setup();
  const local = join(paths.home, 'project', '.claude', 'settings.local.json');
  if (posix) chmodSync(paths.settings, 0o640);
  await backup(paths, [paths.settings, local], { now: new Date('2026-11-13T18:00:00.000Z') });
  writeFileSync(paths.settings, '{"theme":"light"}');
  mkdirSync(join(paths.home, 'project', '.claude'), { recursive: true });
  writeFileSync(local, '{"enabledPlugins":{}}');

  const result = await restoreLatest(paths);
  assert.deepEqual(result, { restored: [paths.settings, local], problems: [] });
  assert.equal(readFileSync(paths.settings, 'utf8'), '{"theme":"dark"}');
  assert.equal(existsSync(local), false);
  if (posix) assert.equal(mode(paths.settings), 0o640);
  // Written to a temporary file and renamed: nothing is left beside it.
  assert.deepEqual(readdirSync(join(paths.home, '.claude')).filter((name) => name.startsWith('settings')), ['settings.json']);
});

test('each restore undoes one change, newest first, until there is nothing left', async () => {
  const paths = setup();
  await backup(paths, [paths.settings], { now: new Date('2026-11-13T18:00:00.000Z') });
  writeFileSync(paths.settings, '{"theme":"light"}');
  await backup(paths, [paths.settings], { now: new Date('2026-11-13T18:05:00.000Z') });
  writeFileSync(paths.settings, '{"theme":"blue"}');

  await restoreLatest(paths);
  assert.equal(readFileSync(paths.settings, 'utf8'), '{"theme":"light"}');
  await restoreLatest(paths);
  assert.equal(readFileSync(paths.settings, 'utf8'), '{"theme":"dark"}');
  assert.deepEqual(await restoreLatest(paths), { restored: [], problems: ['no backup to restore'] });
});
