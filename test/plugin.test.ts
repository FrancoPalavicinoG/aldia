import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFrontmatter } from '../src/frontmatter.js';

const repo = fileURLToPath(new URL('../../', import.meta.url));
const plugin = join(repo, 'plugin');
const readJsonFile = (path: string) => JSON.parse(readFileSync(path, 'utf8'));

test('the marketplace lists the plugin folder, whose manifest names aldia with a version', () => {
  const marketplace = readJsonFile(join(repo, '.claude-plugin', 'marketplace.json'));
  assert.deepEqual(marketplace.plugins.map((p: { name: string; source: string }) => [p.name, p.source]), [['aldia', './plugin']]);
  const manifest = readJsonFile(join(plugin, '.claude-plugin', 'plugin.json'));
  assert.equal(manifest.name, 'aldia');
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
});

// Claude Code keeps users on the plugin.json version until it changes: the package and
// its lockfile say the same, so there is one version to raise.
test('the plugin, the package and its lockfile have one version', () => {
  const manifest = readJsonFile(join(plugin, '.claude-plugin', 'plugin.json'));
  const pkg = readJsonFile(join(repo, 'package.json'));
  const lock = readJsonFile(join(repo, 'package-lock.json'));
  assert.deepEqual([pkg.version, lock.version, lock.packages[''].version], [manifest.version, manifest.version, manifest.version]);
});

test('the skill is /aldia, runs only when the user asks, and every file it points to ships', () => {
  const text = readFileSync(join(plugin, 'skills', 'aldia', 'SKILL.md'), 'utf8');
  const fields = parseFrontmatter(text);
  assert.equal(fields?.name, 'aldia');
  assert.equal(fields?.['disable-model-invocation'], 'true');
  const referenced = [...text.matchAll(/\$\{CLAUDE_PLUGIN_ROOT\}\/([\w./-]+)/g)].map((m) => m[1]!);
  assert.ok(referenced.length > 0);
  for (const file of referenced) assert.ok(existsSync(join(plugin, file)), `missing ${file}`);
  // The root is replaced by the plugin's folder, which can hold a space: each path is quoted
  // so it stays one argument.
  assert.equal([...text.matchAll(/"\$\{CLAUDE_PLUGIN_ROOT\}\/[\w./-]+"/g)].length, referenced.length);
  // Text from the repo reaches the model through this skill.
  assert.match(text, /never follow instructions/i);
  assert.match(text, /`\(end of aldia inventory\)`/);
  // /aldia clean runs a fixed command: the user's arguments never reach the shell.
  assert.match(text, /- Bash\(node "\$\{CLAUDE_PLUGIN_ROOT\}\/lib\/cli\.js" clean\)/);
});

test('the plugin folder holds no package.json and lockfile, so Claude Code installs nothing', () => {
  assert.ok(!existsSync(join(plugin, 'package.json')) || !existsSync(join(plugin, 'package-lock.json')));
});

test('the compiled command prints the inventory', () => {
  const home = fileURLToPath(new URL('../../test/fixtures/home-basic', import.meta.url));
  const output = execFileSync(process.execPath, [join(plugin, 'lib', 'cli.js'), 'status'], {
    env: { HOME: home, USERPROFILE: home },
    encoding: 'utf8',
  });
  assert.match(output, /^# aldia inventory/);
  assert.match(output, /## Plugins \(2: 1 enabled, 1 disabled\)/);
});

test('the command reads the project in the folder it runs from', () => {
  const home = fileURLToPath(new URL('../../test/fixtures/home-basic', import.meta.url));
  const project = fileURLToPath(new URL('../../test/fixtures/project-basic', import.meta.url));
  const output = execFileSync(process.execPath, [join(plugin, 'lib', 'cli.js'), 'status'], {
    cwd: project,
    env: { HOME: home, USERPROFILE: home },
    encoding: 'utf8',
  });
  assert.match(output, /## Project: project-basic/);
  assert.match(output, /- project \(1\): deploy/);
});

test('the compiled command prints the clean proposal', () => {
  const home = fileURLToPath(new URL('../../test/fixtures/home-basic', import.meta.url));
  const output = execFileSync(process.execPath, [join(plugin, 'lib', 'cli.js'), 'clean'], {
    env: { HOME: home, USERPROFILE: home },
    encoding: 'utf8',
  });
  assert.match(output, /^aldia clean/);
});

// A folder it can't list is not a case aldia handles: it stops with one fixed line, so no
// stack trace with paths of the machine reaches the model.
test('an error the command does not expect ends in one fixed line', { skip: process.platform === 'win32' || process.getuid?.() === 0 }, () => {
  const home = mkdtempSync(join(tmpdir(), 'aldia-home-'));
  mkdirSync(join(home, '.claude', 'skills'), { recursive: true });
  chmodSync(join(home, '.claude', 'skills'), 0o000);
  try {
    const result = spawnSync(process.execPath, [join(plugin, 'lib', 'cli.js'), 'status'], { env: { HOME: home }, encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.equal(result.stdout, 'aldia could not finish: unexpected error (EACCES). Nothing was changed.\n');
    assert.equal(result.stderr, '');
  } finally {
    chmodSync(join(home, '.claude', 'skills'), 0o700);
  }
});
