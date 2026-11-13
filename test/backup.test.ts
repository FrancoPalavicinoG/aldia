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
  const saved = await backup(paths, [paths.settings, local], { now: new Date('2026-11-13T18:00:00.000Z') });
  writeFileSync(paths.settings, '{"theme":"light"}');
  mkdirSync(join(paths.home, 'project', '.claude'), { recursive: true });
  writeFileSync(local, '{"enabledPlugins":{}}');
  await saved.seal();

  const result = await restoreLatest(paths);
  assert.deepEqual(result, { restored: [paths.settings, local], skipped: [], problems: [] });
  assert.equal(readFileSync(paths.settings, 'utf8'), '{"theme":"dark"}');
  assert.equal(existsSync(local), false);
  if (posix) assert.equal(mode(paths.settings), 0o640);
  // Written to a temporary file and renamed: nothing is left beside it.
  assert.deepEqual(readdirSync(join(paths.home, '.claude')).filter((name) => name.startsWith('settings')), ['settings.json']);
});

test('each restore undoes one change, newest first, until there is nothing left', async () => {
  const paths = setup();
  const first = await backup(paths, [paths.settings], { now: new Date('2026-11-13T18:00:00.000Z') });
  writeFileSync(paths.settings, '{"theme":"light"}');
  await first.seal();
  const second = await backup(paths, [paths.settings], { now: new Date('2026-11-13T18:05:00.000Z') });
  writeFileSync(paths.settings, '{"theme":"blue"}');
  await second.seal();

  await restoreLatest(paths);
  assert.equal(readFileSync(paths.settings, 'utf8'), '{"theme":"light"}');
  await restoreLatest(paths);
  assert.equal(readFileSync(paths.settings, 'utf8'), '{"theme":"dark"}');
  assert.deepEqual(await restoreLatest(paths), { restored: [], skipped: [], problems: ['no backup to restore'] });
});

test('a file changed after aldia changed it is not overwritten: nothing is restored and the backup is kept', async () => {
  const paths = setup();
  const saved = await backup(paths, [paths.settings, paths.globalState], { now: new Date('2026-11-13T18:00:00.000Z') });
  writeFileSync(paths.settings, '{"theme":"light"}');
  writeFileSync(paths.globalState, '{"mcpServers":{}}');
  await saved.seal();
  // Claude Code writes its own state to .claude.json in the meantime.
  writeFileSync(paths.globalState, '{"mcpServers":{},"numStartups":2}');

  const result = await restoreLatest(paths);
  assert.deepEqual(result, {
    restored: [],
    skipped: [paths.globalState],
    problems: [`${paths.globalState}: changed after aldia's change; nothing restored`],
  });
  // Restoring only part of a change could leave it half undone.
  assert.equal(readFileSync(paths.settings, 'utf8'), '{"theme":"light"}');
  assert.equal(readFileSync(paths.globalState, 'utf8'), '{"mcpServers":{},"numStartups":2}');
  assert.equal(existsSync(saved.dir), true);
});

test('a change that never finished is not guessed at: nothing is restored and the backup is kept', async () => {
  const paths = setup();
  const saved = await backup(paths, [paths.settings], { now: new Date('2026-11-13T18:00:00.000Z') });
  writeFileSync(paths.settings, '{"theme":"light"}');

  const result = await restoreLatest(paths);
  assert.deepEqual(result, {
    restored: [],
    skipped: [],
    problems: ["the latest change didn't finish (backup not sealed); nothing restored"],
  });
  assert.equal(readFileSync(paths.settings, 'utf8'), '{"theme":"light"}');
  assert.equal(existsSync(saved.dir), true);
});

test('only the last 10 backups are kept', async () => {
  const paths = setup();
  for (let i = 0; i < 12; i++) {
    const saved = await backup(paths, [paths.settings], { now: new Date(Date.UTC(2026, 10, 13, 18, i)) });
    await saved.seal();
  }
  const kept = readdirSync(paths.backupsDir).sort();
  assert.equal(kept.length, 10);
  assert.equal(kept[0], '2026-11-13T18-02-00-000Z');
  assert.equal(kept.at(-1), '2026-11-13T18-11-00-000Z');
});
