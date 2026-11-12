import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveClaudePaths } from '../src/paths.js';
import { inventoryReport } from '../src/inventory.js';

const fixture = (name: string) => fileURLToPath(new URL(`../../test/fixtures/${name}`, import.meta.url));

test('the inventory lists plugins, skills by origin, MCP servers and problems', async () => {
  const report = await inventoryReport(resolveClaudePaths({ HOME: fixture('home-basic') }));
  for (const line of [
    '## Plugins (2: 1 enabled, 1 disabled)',
    '- code-review@official 1.2.0 (enabled)',
    '- design-kit@community 0.3.1 (disabled)',
    '## Skills (2)',
    '- personal (1): reviewer',
    '- synced from claude.ai (1): pdf-tools',
    '## MCP servers (2)',
    '- docs-search: http, docs.example.com (user)',
    '- local-db: stdio, db-mcp (user)',
    '## Problems (1)',
  ]) {
    assert.ok(report.includes(line), `missing line: ${line}\n\n${report}`);
  }
});

test('paths in problems start at ~, and secrets never appear', async () => {
  const home = fixture('home-basic');
  const report = await inventoryReport(resolveClaudePaths({ HOME: home }));
  assert.match(report, /- ~[\\/]\.claude[\\/]skills[\\/]broken[\\/]SKILL\.md: could not be read/);
  assert.ok(!report.includes(home));
  assert.ok(!/FAKE-SECRET|Bearer/.test(report));
});

test('an empty setup says so in every section', async () => {
  const report = await inventoryReport(resolveClaudePaths({ HOME: mkdtempSync(join(tmpdir(), 'aldia-home-')) }));
  for (const line of ['## Plugins (0)', '## Skills (0)', '## MCP servers (0)', '## Problems (0)']) {
    assert.ok(report.includes(line), `missing line: ${line}\n\n${report}`);
  }
  assert.equal(report.match(/- none/g)?.length, 4);
});
