import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveClaudePaths } from '../src/paths.js';
import { readUsage } from '../src/usage.js';

const fixture = (name: string) => fileURLToPath(new URL(`../../test/fixtures/${name}`, import.meta.url));

test('counts skill and MCP server use across sessions and subagents, with the last time used', async () => {
  const usage = await readUsage(resolveClaudePaths({ HOME: fixture('home-basic') }));
  assert.equal(usage.sessions, 2);
  assert.deepEqual(usage.skills, { 'design-kit:palette': { count: 2, lastUsed: '2026-11-08T08:00:00.000Z' } });
  assert.deepEqual(usage.mcpServers, { 'docs-search': { count: 3, lastUsed: '2026-11-06T12:00:00.000Z' } });
  assert.deepEqual(usage.problems, []);
});

test('only names and dates come out of the history: never prompts, tool input or results', async () => {
  const output = JSON.stringify(await readUsage(resolveClaudePaths({ HOME: fixture('home-basic') })));
  assert.ok(!output.includes('FAKE-SECRET'), output);
  assert.ok(!output.includes('Bash'), output);
});

test('no history gives empty usage', async () => {
  const usage = await readUsage(resolveClaudePaths({ HOME: mkdtempSync(join(tmpdir(), 'aldia-home-')) }));
  assert.deepEqual(usage, { sessions: 0, skills: {}, mcpServers: {}, problems: [] });
});
