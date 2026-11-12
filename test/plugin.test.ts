import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
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

test('the skill is /aldia, runs only when the user asks, and every file it points to ships', () => {
  const text = readFileSync(join(plugin, 'skills', 'aldia', 'SKILL.md'), 'utf8');
  const fields = parseFrontmatter(text);
  assert.equal(fields?.name, 'aldia');
  assert.equal(fields?.['disable-model-invocation'], 'true');
  const referenced = [...text.matchAll(/\$\{CLAUDE_PLUGIN_ROOT\}\/([\w./-]+)/g)].map((m) => m[1]!);
  assert.ok(referenced.length > 0);
  for (const file of referenced) assert.ok(existsSync(join(plugin, file)), `missing ${file}`);
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
