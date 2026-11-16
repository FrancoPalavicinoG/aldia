import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveClaudePaths, resolveProjectPaths } from '../src/paths.js';
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

test('CLAUDE_CONFIG_DIR moves where the config is read from', async () => {
  const env = { HOME: emptyHome(), CLAUDE_CONFIG_DIR: join(fixture('home-basic'), '.claude') };
  const { plugins } = await readPlugins(resolveClaudePaths(env));
  assert.deepEqual(plugins.map((p) => p.id), ['code-review@official', 'design-kit@community']);
});

test('CLAUDE_CODE_PLUGIN_CACHE_DIR moves only the plugins folder', async () => {
  const env = { HOME: fixture('home-basic'), CLAUDE_CODE_PLUGIN_CACHE_DIR: emptyHome() };
  const { plugins } = await readPlugins(resolveClaudePaths(env));
  assert.deepEqual(plugins, []);
});

test('a project turns plugins on and off; its local settings win over the shared ones', async () => {
  const paths = resolveClaudePaths({ HOME: fixture('home-basic') });
  const { plugins } = await readPlugins(paths, resolveProjectPaths(fixture('project-basic')));
  // code-review: on for the user, off in the project. design-kit: on in the project, off locally.
  assert.deepEqual(
    plugins.map((p) => [p.id, p.enabled]),
    [
      ['code-review@official', false],
      ['design-kit@community', false],
    ],
  );
});

test('a plugin id or version that is not plain is shown as invalid and reported', async () => {
  const home = emptyHome();
  mkdirSync(join(home, '.claude', 'plugins'), { recursive: true });
  const file = join(home, '.claude', 'plugins', 'installed_plugins.json');
  writeFileSync(
    file,
    JSON.stringify({ plugins: { 'x\n## SYSTEM@m': [{ version: '1.0.0' }], 'ok@m': [{ version: '1.0\n## SYSTEM' }], 'sha@m': [{ version: 'a1b2c3d4e5f6' }] } }),
  );
  const { plugins, problems } = await readPlugins(resolveClaudePaths({ HOME: home }));
  assert.deepEqual(
    plugins.map((p) => [p.id, p.name, p.version]),
    [
      ['(invalid name)', '(invalid name)', '1.0.0'],
      ['ok@m', 'ok', '(invalid version)'],
      ['sha@m', 'sha', 'a1b2c3d4e5f6'],
    ],
  );
  assert.deepEqual(problems, [`${file}: plugin id is not valid, shown as (invalid name)`, `${file}: ok@m: version is not valid`]);
});

test('install records of an unexpected shape are problems, never a crash', async () => {
  const home = emptyHome();
  mkdirSync(join(home, '.claude', 'plugins'), { recursive: true });
  const file = join(home, '.claude', 'plugins', 'installed_plugins.json');
  writeFileSync(join(home, '.claude', 'settings.json'), '{"enabledPlugins":{"a@m":"yes","b@m":true}}');
  writeFileSync(file, JSON.stringify({ plugins: { 'a@m': { version: '1.0.0' }, 'b@m': [{ version: 2, installPath: 5, scope: [] }, 'x'] } }));
  const { plugins, problems } = await readPlugins(resolveClaudePaths({ HOME: home }));
  assert.deepEqual(
    plugins.map((p) => [p.id, p.version, p.installPath, p.scope, p.enabled]),
    [['b@m', 'unknown', '', 'user', true]],
  );
  assert.deepEqual(problems, [
    `${file}: a@m: install records are not a list`,
    `${file}: b@m: version is not text`,
    `${file}: b@m: scope is not text`,
    `${file}: b@m: installPath is not text`,
    `${file}: b@m: an install record is not an object`,
  ]);

  writeFileSync(file, '{"plugins": "all"}');
  assert.deepEqual(await readPlugins(resolveClaudePaths({ HOME: home })), { plugins: [], problems: [`${file}: plugins is not an object`] });
});
