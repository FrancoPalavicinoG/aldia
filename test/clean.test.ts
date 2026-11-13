import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanPlan, usageByItem, type PluginUse, type SetupData } from '../src/clean.js';
import type { InstalledPlugin } from '../src/plugins.js';
import type { Skill } from '../src/skills.js';

const plugin = (id: string, enabled = true): InstalledPlugin => {
  const [name = '', marketplace = ''] = id.split('@');
  return { id, name, marketplace, version: '1.0.0', scope: 'user', enabled, installPath: `/cache/${name}` };
};
const skill = (name: string, source: Skill['source'], pluginId?: string): Skill => ({
  name,
  description: '',
  whenToUse: '',
  modelInvocable: true,
  source,
  ...(pluginId ? { pluginId } : {}),
  path: `/${name}/SKILL.md`,
});
const used = (lastUsed: string) => ({ count: 1, lastUsed });

// A setup with a plugin used through one of its skills, a plugin used through its MCP
// server, personal and synced skills (one used as a /command), a user MCP server, two
// claude.ai connectors and a server the Claude app provides.
const setup: SetupData = {
  plugins: [plugin('design-kit@community'), plugin('notes@community')],
  skills: [
    skill('palette', 'plugin', 'design-kit@community'),
    skill('sketch', 'plugin', 'design-kit@community'),
    skill('court', 'personal'),
    skill('reviewer', 'personal'),
    skill('pdf-tools', 'synced'),
  ],
  servers: [
    { name: 'docs-search', transport: 'http', target: 'docs.example.com', source: 'user' },
    { name: 'notes-db', transport: 'stdio', target: 'notes', source: 'plugin', pluginId: 'notes@community' },
  ],
  usage: {
    since: '2026-08-12T00:00:00.000Z',
    sessions: 9,
    skills: { 'design-kit:palette': used('2026-11-08T00:00:00.000Z') },
    mcpServers: {
      'plugin_notes_notes-db': used('2026-11-06T00:00:00.000Z'),
      claude_ai_Linear: used('2026-11-09T00:00:00.000Z'),
    },
    commands: { '/court': used('2026-11-02T00:00:00.000Z') },
    problems: [],
  },
  cost: {
    skills: [
      { name: 'palette', source: 'plugin', pluginId: 'design-kit@community', chars: 400, tokens: 100 },
      { name: 'sketch', source: 'plugin', pluginId: 'design-kit@community', chars: 200, tokens: 50 },
      { name: 'court', source: 'personal', chars: 80, tokens: 20 },
      { name: 'reviewer', source: 'personal', chars: 120, tokens: 30 },
      { name: 'pdf-tools', source: 'synced', chars: 160, tokens: 40 },
    ],
    mcpServers: [
      { name: 'docs-search', tools: 3, chars: 800, tokens: 200 },
      { name: 'plugin_notes_notes-db', tools: 4, chars: 1200, tokens: 300 },
      { name: 'claude_ai_Linear', tools: 70, chars: 5600, tokens: 1400 },
      { name: 'claude_ai_Google_Drive', tools: 8, chars: 4800, tokens: 1200 },
      { name: 'ccd_session', tools: 5, chars: 2000, tokens: 500 },
    ],
    measuredAt: '2026-11-09T00:00:00.000Z',
    problems: [],
  },
};

test('each installed item gets its cost and when it was last used, whatever name the history uses', () => {
  const items = usageByItem(setup);
  assert.deepEqual(
    items.plugins.map((p) => [p.id, p.tokens, p.lastUsed, p.skills.map((s) => [s.id, s.tokens, s.lastUsed])]),
    [
      ['design-kit@community', 150, '2026-11-08T00:00:00.000Z', [['palette', 100, '2026-11-08T00:00:00.000Z'], ['sketch', 50, undefined]]],
      ['notes@community', 300, '2026-11-06T00:00:00.000Z', []],
    ],
  );
  assert.deepEqual(
    items.skills.map((s) => [s.id, s.source, s.tokens, s.lastUsed]),
    [
      ['court', 'personal', 20, '2026-11-02T00:00:00.000Z'],
      ['reviewer', 'personal', 30, undefined],
      ['pdf-tools', 'synced', 40, undefined],
    ],
  );
  assert.deepEqual(items.mcpServers.map((s) => [s.id, s.source, s.tokens, s.lastUsed]), [['docs-search', 'user', 200, undefined]]);
  // Connectors come from the claude.ai account; servers the Claude app provides (ccd_*) are not the user's.
  assert.deepEqual(
    items.connectors.map((c) => [c.id, c.tokens, c.lastUsed]),
    [
      ['Google Drive', 1200, undefined],
      ['Linear', 1400, '2026-11-09T00:00:00.000Z'],
    ],
  );
});

const now = new Date('2026-11-10T00:00:00.000Z');

test('unused for 30 days: whole plugins, single skills of used plugins, servers and connectors are turned off', () => {
  const plan = cleanPlan(usageByItem(setup), now);
  assert.deepEqual(
    plan.proposals.map((p) => [p.action, p.target, p.tokens]),
    [
      ['disable-connector', 'Google Drive', 1200],
      ['disable-mcp', 'docs-search', 200],
      ['skill-off', 'design-kit:sketch', 50],
      ['skill-off', 'pdf-tools', 40],
      ['skill-off', 'reviewer', 30],
    ],
  );
  assert.equal(plan.savings, 1520);
  assert.equal(plan.lean, false);
});

test('a plugin already off is uninstalled only after 90 days unused; under ~500 tokens the setup is lean', () => {
  const off = (id: string, lastUsed?: string): PluginUse => ({
    id,
    tokens: 0,
    ...(lastUsed ? { lastUsed } : {}),
    plugin: { id, name: id.split('@')[0]!, marketplace: 'm', version: '1.0.0', scope: 'user', enabled: false, installPath: '' },
    skills: [],
  });
  const idle: PluginUse = {
    id: 'idle@m',
    tokens: 100,
    plugin: { id: 'idle@m', name: 'idle', marketplace: 'm', version: '1.0.0', scope: 'user', enabled: true, installPath: '' },
    skills: [
      { id: 'a', tokens: 60 },
      { id: 'b', tokens: 40 },
    ],
  };
  const plan = cleanPlan(
    { plugins: [off('old@m'), off('recent@m', '2026-09-15T00:00:00.000Z'), idle], skills: [], mcpServers: [], connectors: [] },
    now,
  );
  assert.deepEqual(
    plan.proposals.map((p) => [p.action, p.target, p.tokens]),
    [
      ['disable-plugin', 'idle@m', 100],
      ['uninstall-plugin', 'old@m', 0],
    ],
  );
  assert.equal(plan.lean, true);
});
