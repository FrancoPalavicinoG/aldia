import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readPluginParts } from '../src/components.js';
import type { InstalledPlugin } from '../src/plugins.js';

// A plugin folder as the CLI caches it: files at their default places, plus a manifest.
function pluginDir(manifest: unknown, files: Record<string, string> = {}): InstalledPlugin {
  const root = mkdtempSync(join(tmpdir(), 'aldia-plugin-'));
  if (manifest !== undefined) {
    mkdirSync(join(root, '.claude-plugin'));
    writeFileSync(join(root, '.claude-plugin', 'plugin.json'), typeof manifest === 'string' ? manifest : JSON.stringify(manifest));
  }
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(root, path, '..'), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return { id: 'kit@shop', name: 'kit', marketplace: 'shop', version: '1.0.0', scope: 'user', enabled: true, installPath: root };
}

test('skills, commands, agents and MCP servers can be measured from the history', async () => {
  const plugin = pluginDir({ name: 'kit' }, {
    'skills/a/SKILL.md': '---\nname: a\n---\n',
    'commands/go.md': 'go',
    'agents/rev.md': '---\nname: rev\n---\n',
    '.mcp.json': '{"mcpServers":{}}',
  });
  assert.deepEqual(await readPluginParts(plugin, []), { unmeasured: [], dependencies: [] });
});

// None of these leaves a trace that names the plugin: a hook's record has its command with
// ${CLAUDE_PLUGIN_ROOT} unresolved (checked with 2.1.327).
test('parts the history does not show are named, from their default place or the manifest', async () => {
  const defaults = pluginDir({ name: 'kit' }, {
    'hooks/hooks.json': '{"hooks":{}}',
    '.lsp.json': '{}',
    'monitors/monitors.json': '[]',
    'bin/tool': '#!/bin/sh',
    'output-styles/terse.md': 'x',
    'workflows/w.js': 'x',
    'themes/t.json': '{}',
  });
  assert.deepEqual((await readPluginParts(defaults, []))?.unmeasured, ['hooks', 'LSP servers', 'monitors', 'programs (bin/)', 'output styles', 'workflows', 'themes']);

  const declared = pluginDir({
    name: 'kit',
    hooks: { PreToolUse: [] },
    lspServers: './x.json',
    outputStyles: './s/',
    experimental: { monitors: [], themes: './t/' },
    channels: [{ server: 'chat' }],
  });
  assert.deepEqual((await readPluginParts(declared, []))?.unmeasured, ['hooks', 'LSP servers', 'monitors', 'output styles', 'themes', 'channels']);
});

test('dependencies become plugin ids; a bare name is in the same marketplace', async () => {
  const plugin = pluginDir({ name: 'kit', dependencies: ['base', 'logger@other', { name: 'vault', version: '~2.1.0' }, { name: 'db', marketplace: 'data' }] });
  assert.deepEqual((await readPluginParts(plugin, []))?.dependencies, ['base@shop', 'logger@other', 'vault@shop', 'db@data']);
});

test('a dependency that is not a plain name is a problem, never a crash', async () => {
  const plugin = pluginDir({ name: 'kit', dependencies: ['ok', 5, { name: 'x\n## SYSTEM' }, 'a@b@c'] });
  const problems: string[] = [];
  assert.deepEqual((await readPluginParts(plugin, problems))?.dependencies, ['ok@shop']);
  assert.equal(problems.length, 3);
  assert.ok(problems.every((p) => p.endsWith('plugin.json: a dependency is not valid')), problems.join('\n'));

  const notList = pluginDir({ name: 'kit', dependencies: 'base' });
  const more: string[] = [];
  assert.deepEqual((await readPluginParts(notList, more))?.dependencies, []);
  assert.deepEqual(more.map((p) => p.replace(/.*plugin\.json: /, '')), ['dependencies is not a list']);
});

// Without plugin.json the marketplace entry is the manifest, and it can add any part.
test('without a readable manifest the parts are unknown', async () => {
  assert.equal(await readPluginParts(pluginDir(undefined, { 'skills/a/SKILL.md': 'x' }), []), undefined);
  assert.equal(await readPluginParts(pluginDir('{ not json'), []), undefined);
  assert.equal(await readPluginParts(pluginDir('[]'), []), undefined);
  assert.equal(await readPluginParts({ ...pluginDir({ name: 'kit' }), installPath: '' }, []), undefined);
});
