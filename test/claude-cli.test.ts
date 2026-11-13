import { test } from 'node:test';
import assert from 'node:assert/strict';
import { commandFor } from '../src/claude-cli.js';

test('each operation becomes a fixed list of arguments for the official CLI', () => {
  assert.deepEqual(commandFor({ kind: 'disable-plugin', plugin: 'notes@community', scope: 'user' }), [
    'plugin', 'disable', 'notes@community', '--scope', 'user', '--json',
  ]);
  assert.deepEqual(commandFor({ kind: 'uninstall-plugin', plugin: 'notes@community', scope: 'local' }), [
    'plugin', 'uninstall', 'notes@community', '--scope', 'local', '--json',
  ]);
  assert.deepEqual(commandFor({ kind: 'remove-mcp', server: 'docs-search', scope: 'user' }), [
    'mcp', 'remove', 'docs-search', '--scope', 'user',
  ]);
});

test('names that could pass as options or shell text, and the team scope, are refused', () => {
  const refused = [
    { kind: 'disable-plugin', plugin: '--scope@project', scope: 'user' },
    { kind: 'disable-plugin', plugin: 'notes', scope: 'user' },
    { kind: 'disable-plugin', plugin: 'x; rm -rf ~@m', scope: 'user' },
    { kind: 'uninstall-plugin', plugin: 'notes@community', scope: 'project' },
    { kind: 'remove-mcp', server: '-s', scope: 'user' },
    { kind: 'remove-mcp', server: '$(whoami)', scope: 'user' },
    { kind: 'remove-mcp', server: 'docs-search', scope: 'project' },
  ] as const;
  for (const op of refused) assert.throws(() => commandFor(op as never), /refused/, JSON.stringify(op));
});
