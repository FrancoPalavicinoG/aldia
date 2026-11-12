import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveClaudePaths } from '../src/paths.js';
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
