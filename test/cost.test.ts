import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readContextCost } from '../src/cost.js';
import { resolveClaudePaths } from '../src/paths.js';
import { readSkills } from '../src/skills.js';

const homeWithSkills = (skills: Record<string, string>) => {
  const home = mkdtempSync(join(tmpdir(), 'aldia-home-'));
  for (const [name, text] of Object.entries(skills)) {
    mkdirSync(join(home, '.claude', 'skills', name), { recursive: true });
    writeFileSync(join(home, '.claude', 'skills', name, 'SKILL.md'), text);
  }
  return home;
};

test('each skill costs its name and listing text every turn; user-only skills cost nothing', async () => {
  const home = homeWithSkills({
    short: `---\nname: short\ndescription: ${'x'.repeat(40)}\n---\nBody is not listed.\n`,
    long: `---\nname: long\ndescription: ${'d'.repeat(1000)}\nwhen_to_use: ${'w'.repeat(1000)}\n---\n`,
    manual: `---\nname: manual\ndescription: Runs only when typed.\ndisable-model-invocation: true\n---\n`,
    bare: `\n# Title line\nMore text.\n`,
  });
  const paths = resolveClaudePaths({ HOME: home });
  const { skills } = await readSkills(paths);
  const cost = await readContextCost(paths, skills);
  assert.deepEqual(
    cost.skills.map((s) => [s.name, s.chars, s.tokens]),
    [
      ['bare', 4 + 2 + '# Title line'.length, 5], // no description: the first line of the body
      ['long', 4 + 2 + 1536, 386], // description + when_to_use, capped at 1,536 characters
      ['manual', 0, 0],
      ['short', 5 + 2 + 40, 12],
    ],
  );
});
