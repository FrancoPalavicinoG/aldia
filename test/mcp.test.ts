import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveClaudePaths } from '../src/paths.js';
import { readMcpServers } from '../src/mcp.js';
import { readPlugins } from '../src/plugins.js';

const fixture = (name: string) => fileURLToPath(new URL(`../../test/fixtures/${name}`, import.meta.url));
const emptyHome = () => mkdtempSync(join(tmpdir(), 'aldia-home-'));

test('lists user MCP servers with their transport and target', async () => {
  const { servers } = await readMcpServers(resolveClaudePaths({ HOME: fixture('home-basic') }));
  assert.deepEqual(
    servers.map((s) => [s.name, s.transport, s.target, s.source]),
    [
      ['docs-search', 'http', 'docs.example.com', 'user'],
      ['local-db', 'stdio', 'db-mcp', 'user'],
    ],
  );
});

test('never exposes headers, env, args or URL query values', async () => {
  const result = await readMcpServers(resolveClaudePaths({ HOME: fixture('home-basic') }));
  const output = JSON.stringify(result);
  for (const secret of ['FAKE-SECRET-QUERY', 'FAKE-SECRET-HEADER', 'FAKE-SECRET-ARG', 'FAKE-SECRET-ENV', 'Bearer']) {
    assert.ok(!output.includes(secret), `output leaks ${secret}`);
  }
});

test('a missing global state gives no servers; a malformed one is a problem', async () => {
  assert.deepEqual(await readMcpServers(resolveClaudePaths({ HOME: emptyHome() })), { servers: [], problems: [] });

  const home = emptyHome();
  writeFileSync(join(home, '.claude.json'), '{ "mcpServers": ');
  const { servers, problems } = await readMcpServers(resolveClaudePaths({ HOME: home }));
  assert.deepEqual(servers, []);
  assert.equal(problems.length, 1);
  assert.match(problems[0]!, /\.claude\.json/);
});

test('MCP servers bundled with plugins: .mcp.json in both shapes, and the manifest, which wins on a name clash', async () => {
  const home = emptyHome();
  mkdirSync(join(home, '.claude', 'plugins'), { recursive: true });
  writeFileSync(
    join(home, '.claude', 'plugins', 'installed_plugins.json'),
    JSON.stringify({
      version: 2,
      plugins: {
        'design-kit@community': [{ scope: 'user', installPath: fixture('plugin-design-kit'), version: '0.3.1' }],
        'notes@community': [{ scope: 'user', installPath: fixture('plugin-notes'), version: '1.0.0' }],
      },
    }),
  );
  const paths = resolveClaudePaths({ HOME: home });
  const { plugins } = await readPlugins(paths);
  const result = await readMcpServers(paths, plugins);
  assert.deepEqual(
    result.servers.map((s) => [s.name, s.transport, s.target, s.pluginId]),
    [
      ['figma', 'stdio', 'figma-local', 'design-kit@community'],
      ['icons', 'http', 'icons.example.com', 'design-kit@community'],
      ['calendar', 'sse', 'calendar.example.com', 'notes@community'],
      ['notes', 'stdio', 'node', 'notes@community'],
    ],
  );
  assert.ok(!JSON.stringify(result).includes('FAKE-SECRET-PLUGIN'));
});
