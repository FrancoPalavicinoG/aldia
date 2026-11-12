import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveClaudePaths } from '../src/paths.js';
import { readPlugins } from '../src/plugins.js';

const fixture = (name: string) => fileURLToPath(new URL(`../../test/fixtures/${name}`, import.meta.url));
const emptyHome = () => mkdtempSync(join(tmpdir(), 'aldia-home-'));

test('lists installed plugins with their enabled state', async () => {
  const paths = resolveClaudePaths({ HOME: fixture('home-basic') });
  const { plugins } = await readPlugins(paths);
  assert.deepEqual(
    plugins.map((p) => [p.id, p.name, p.marketplace, p.version, p.scope, p.enabled]),
    [
      ['code-review@official', 'code-review', 'official', '1.2.0', 'user', true],
      ['design-kit@community', 'design-kit', 'community', '0.3.1', 'user', false],
    ],
  );
});

test('a home without Claude Code config gives an empty inventory', async () => {
  const inventory = await readPlugins(resolveClaudePaths({ HOME: emptyHome() }));
  assert.deepEqual(inventory, { plugins: [], problems: [] });
});

test('a malformed config file is reported as a problem instead of crashing', async () => {
  const home = emptyHome();
  mkdirSync(join(home, '.claude', 'plugins'), { recursive: true });
  writeFileSync(join(home, '.claude', 'settings.json'), '{ "enabledPlugins": ');
  writeFileSync(join(home, '.claude', 'plugins', 'installed_plugins.json'), '{"version": 2, "plugins": {"a@m": [{"version": "1.0.0"}]}}');

  const { plugins, problems } = await readPlugins(resolveClaudePaths({ HOME: home }));

  assert.deepEqual(plugins.map((p) => [p.id, p.enabled]), [['a@m', false]]);
  assert.equal(problems.length, 1);
  assert.match(problems[0]!, /settings\.json/);
});
