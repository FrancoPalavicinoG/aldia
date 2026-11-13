import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from 'node:fs';
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

const attachment = (attachment: object) => JSON.stringify({ type: 'attachment', attachment });

test('MCP cost comes from the last session: tool names and server instructions it loaded', async () => {
  const home = mkdtempSync(join(tmpdir(), 'aldia-home-'));
  const dir = join(home, '.claude', 'projects', '-repo');
  mkdirSync(dir, { recursive: true });
  const latest = join(dir, 'latest.jsonl');
  writeFileSync(
    latest,
    [
      attachment({
        type: 'deferred_tools_delta',
        addedNames: ['mcp__docs-search__search', 'mcp__docs-search__fetch', 'mcp__claude_ai_Linear__get_issue', 'WebFetch'],
        removedNames: [],
      }),
      attachment({
        type: 'mcp_instructions_delta',
        addedNames: ['docs-search', 'claude.ai Linear'],
        addedBlocks: [`FAKE-SECRET-INSTRUCTIONS ${'i'.repeat(75)}`, 'L'.repeat(50)],
        removedNames: [],
      }),
      attachment({ type: 'deferred_tools_delta', addedNames: [], removedNames: ['mcp__docs-search__fetch'] }),
    ].join('\n'),
  );
  const older = join(dir, 'older.jsonl');
  writeFileSync(older, attachment({ type: 'deferred_tools_delta', addedNames: ['mcp__old-server__x'], removedNames: [] }));
  utimesSync(older, new Date('2026-11-01'), new Date('2026-11-01'));
  utimesSync(latest, new Date('2026-11-09'), new Date('2026-11-09'));

  const cost = await readContextCost(resolveClaudePaths({ HOME: home }), []);
  assert.equal(cost.measuredAt, '2026-11-09T00:00:00.000Z');
  assert.deepEqual(
    cost.mcpServers.map((s) => [s.name, s.tools, s.chars]),
    [
      ['claude_ai_Linear', 1, 'mcp__claude_ai_Linear__get_issue'.length + 1 + 50],
      ['docs-search', 1, 'mcp__docs-search__search'.length + 1 + 100],
    ],
  );
  assert.ok(!JSON.stringify(cost).includes('FAKE-SECRET'));
});

test('without session history there is no MCP measurement', async () => {
  const cost = await readContextCost(resolveClaudePaths({ HOME: mkdtempSync(join(tmpdir(), 'aldia-home-')) }), []);
  assert.deepEqual(cost, { skills: [], mcpServers: [], problems: [] });
});
