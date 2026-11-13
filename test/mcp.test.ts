import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveClaudePaths, resolveProjectPaths } from '../src/paths.js';
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

test('CLAUDE_CONFIG_DIR moves the global state file into that folder', async () => {
  const configDir = emptyHome();
  writeFileSync(join(configDir, '.claude.json'), JSON.stringify({ mcpServers: { moved: { type: 'http', url: 'https://moved.example.com' } } }));
  const { servers } = await readMcpServers(resolveClaudePaths({ HOME: fixture('home-basic'), CLAUDE_CONFIG_DIR: configDir }));
  assert.deepEqual(servers.map((s) => s.name), ['moved']);
});

test('project servers from .mcp.json and local ones from .claude.json; on a name clash local beats project beats user', async () => {
  const project = resolveProjectPaths(fixture('project-basic'));
  const home = emptyHome();
  writeFileSync(
    join(home, '.claude.json'),
    JSON.stringify({
      mcpServers: { shared: { url: 'https://user.example.com' }, docs: { url: 'https://docs.example.com' } },
      projects: {
        [project.root]: {
          mcpServers: { shared: { url: 'https://local.example.com' } },
          lastSessionFirstPrompt: 'FAKE-SECRET-PROMPT',
        },
        '/some/other/project': { mcpServers: { elsewhere: { url: 'https://other.example.com' } } },
      },
    }),
  );
  const result = await readMcpServers(resolveClaudePaths({ HOME: home }), [], project);
  assert.deepEqual(
    result.servers.map((s) => [s.name, s.source, s.target]),
    [
      ['shared', 'local', 'local.example.com'],
      ['db', 'project', 'pg-mcp'],
      ['tickets', 'project', 'tickets.example.com'],
      ['docs', 'user', 'docs.example.com'],
    ],
  );
  const output = JSON.stringify(result);
  for (const secret of ['FAKE-SECRET', 'Bearer']) assert.ok(!output.includes(secret), `output leaks ${secret}`);
});
