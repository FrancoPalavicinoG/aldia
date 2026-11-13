import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveClaudePaths } from '../src/paths.js';
import { readUsage } from '../src/usage.js';

const fixture = (name: string) => fileURLToPath(new URL(`../../test/fixtures/${name}`, import.meta.url));
const now = new Date('2026-11-10T00:00:00.000Z');

test('counts skill and MCP server use across sessions and subagents, with the last time used', async () => {
  const usage = await readUsage(resolveClaudePaths({ HOME: fixture('home-basic') }), { now });
  assert.equal(usage.sessions, 2);
  assert.deepEqual(usage.skills, { 'design-kit:palette': { count: 2, lastUsed: '2026-11-08T08:00:00.000Z' } });
  assert.deepEqual(usage.mcpServers, { 'docs-search': { count: 3, lastUsed: '2026-11-06T12:00:00.000Z' } });
  assert.deepEqual(usage.problems, []);
});

test('counts slash commands the user typed, not ones quoted in a reply', async () => {
  const usage = await readUsage(resolveClaudePaths({ HOME: fixture('home-basic') }), { now });
  assert.deepEqual(usage.commands, { '/court': { count: 1, lastUsed: '2026-11-02T10:00:00.000Z' } });
});

test('only the last days count: older entries are left out and older files are not opened', async () => {
  const late = new Date('2026-11-20T00:00:00.000Z');
  const usage = await readUsage(resolveClaudePaths({ HOME: fixture('home-basic') }), { now: late, days: 14 });
  assert.equal(usage.since, '2026-11-06T00:00:00.000Z');
  assert.deepEqual(usage.skills, { 'design-kit:palette': { count: 1, lastUsed: '2026-11-08T08:00:00.000Z' } });
  assert.deepEqual(usage.mcpServers, { 'docs-search': { count: 1, lastUsed: '2026-11-06T12:00:00.000Z' } });
  assert.deepEqual(usage.commands, {});

  // A file untouched since before the window is skipped, whatever it says inside.
  const home = mkdtempSync(join(tmpdir(), 'aldia-home-'));
  const dir = join(home, '.claude', 'projects', '-repo');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, 'old.jsonl');
  writeFileSync(file, JSON.stringify({ type: 'assistant', timestamp: '2026-11-09T00:00:00.000Z', message: { content: [{ type: 'tool_use', name: 'mcp__x__y' }] } }));
  utimesSync(file, new Date('2026-01-01'), new Date('2026-01-01'));
  const old = await readUsage(resolveClaudePaths({ HOME: home }), { now });
  assert.equal(old.sessions, 0);
  assert.deepEqual(old.mcpServers, {});
});

test('only names and dates come out of the history: never prompts, tool input or results', async () => {
  const output = JSON.stringify(await readUsage(resolveClaudePaths({ HOME: fixture('home-basic') }), { now }));
  assert.ok(!output.includes('FAKE-SECRET'), output);
  assert.ok(!output.includes('Bash'), output);
});

test('no history gives empty usage', async () => {
  const usage = await readUsage(resolveClaudePaths({ HOME: mkdtempSync(join(tmpdir(), 'aldia-home-')) }), { now });
  assert.deepEqual(usage, { since: '2026-10-11T00:00:00.000Z', sessions: 0, skills: {}, mcpServers: {}, commands: {}, problems: [] });
});
