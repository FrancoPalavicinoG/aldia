import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveClaudePaths, resolveProjectPaths } from '../src/paths.js';
import { readPlugins } from '../src/plugins.js';
import { readSkills } from '../src/skills.js';

const fixture = (name: string) => fileURLToPath(new URL(`../../test/fixtures/${name}`, import.meta.url));
const emptyHome = () => mkdtempSync(join(tmpdir(), 'aldia-home-'));

test('lists personal skills with name and description', async () => {
  const { skills } = await readSkills(resolveClaudePaths({ HOME: fixture('home-basic') }));
  const personal = skills.filter((s) => s.source === 'personal');
  assert.deepEqual(
    personal.map((s) => [s.name, s.description]),
    [['reviewer', 'Reviews a diff for bugs before merging.']],
  );
});

test('folders without SKILL.md and hidden folders are not skills; an unreadable SKILL.md is a problem', async () => {
  const { skills, problems } = await readSkills(resolveClaudePaths({ HOME: fixture('home-basic') }));
  const names = skills.map((s) => s.name);
  assert.ok(!names.includes('scratch'));
  assert.ok(!names.includes('old-skill'));
  assert.equal(problems.length, 1);
  assert.match(problems[0]!, /broken/);
});

test('a home without skills gives an empty inventory', async () => {
  assert.deepEqual(await readSkills(resolveClaudePaths({ HOME: emptyHome() })), { skills: [], problems: [] });
});

test('skills synced from claude.ai are listed as synced, and their folder is not a skill', async () => {
  const { skills } = await readSkills(resolveClaudePaths({ HOME: fixture('home-basic') }));
  assert.deepEqual(
    skills.map((s) => [s.source, s.name]),
    [['personal', 'reviewer'], ['synced', 'pdf-tools']],
  );
});

test('skills from installed plugins carry the plugin id, once per install folder', async () => {
  const home = emptyHome();
  const installPath = fixture('plugin-design-kit');
  mkdirSync(join(home, '.claude', 'plugins'), { recursive: true });
  writeFileSync(
    join(home, '.claude', 'plugins', 'installed_plugins.json'),
    JSON.stringify({
      version: 2,
      plugins: {
        'design-kit@community': [
          { scope: 'user', installPath, version: '0.3.1' },
          { scope: 'project', installPath, version: '0.3.1' },
        ],
      },
    }),
  );
  const paths = resolveClaudePaths({ HOME: home });
  const { plugins } = await readPlugins(paths);
  const { skills } = await readSkills(paths, plugins);
  assert.deepEqual(
    skills.map((s) => [s.source, s.name, s.pluginId]),
    [['plugin', 'palette', 'design-kit@community']],
  );
});

test('a project adds its own skills from .claude/skills', async () => {
  const paths = resolveClaudePaths({ HOME: fixture('home-basic') });
  const { skills } = await readSkills(paths, [], resolveProjectPaths(fixture('project-basic')));
  const project = skills.filter((s) => s.source === 'project');
  assert.deepEqual(
    project.map((s) => [s.name, s.description]),
    [['deploy', 'Deploys this service to staging.']],
  );
  assert.ok(skills.some((s) => s.source === 'personal' && s.name === 'reviewer'));
});
