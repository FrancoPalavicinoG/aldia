import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { commandFor, runOperation } from '../src/claude-cli.js';

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

// A stand-in for the claude CLI: it writes down its arguments and folder, then answers as
// FAKE_CLAUDE says. The real CLI never runs in tests.
const FAKE = `
const { writeFileSync } = require('node:fs');
writeFileSync(process.env.FAKE_LOG, JSON.stringify({ args: process.argv.slice(2), cwd: process.cwd() }));
const answer = {
  ok: () => { console.log(JSON.stringify({ outcome: 'success' })); process.exit(0); },
  failed: () => { console.log(JSON.stringify({ outcome: 'failed', failureCode: 'not_installed', message: 'FAKE-SECRET' })); console.error('FAKE-SECRET'); process.exit(1); },
  already: () => { console.log(JSON.stringify({ outcome: 'failed', failureCode: 'already_in_goal_state', alreadyInGoalState: true })); process.exit(1); },
  plain: () => { console.error('No MCP server named FAKE-SECRET'); process.exit(1); },
  hang: () => setTimeout(() => {}, 60000),
};
answer[process.env.FAKE_CLAUDE]();
`;

function fakeClaude(answer: string) {
  const dir = mkdtempSync(join(tmpdir(), 'aldia-cli-'));
  const script = join(dir, 'claude.cjs');
  writeFileSync(script, FAKE);
  const log = join(dir, 'log.json');
  return {
    options: { claude: [process.execPath, script], env: { ...process.env, FAKE_CLAUDE: answer, FAKE_LOG: log } },
    called: () => JSON.parse(readFileSync(log, 'utf8')) as { args: string[]; cwd: string },
  };
}

test('an operation runs the official CLI with its fixed arguments; local scope runs in the project folder', async () => {
  const fake = fakeClaude('ok');
  assert.deepEqual(await runOperation({ kind: 'disable-plugin', plugin: 'notes@community', scope: 'user' }, fake.options), { ok: true });
  assert.deepEqual(fake.called().args, ['plugin', 'disable', 'notes@community', '--scope', 'user', '--json']);

  const project = realpathSync(mkdtempSync(join(tmpdir(), 'aldia-project-')));
  await runOperation({ kind: 'remove-mcp', server: 'docs-search', scope: 'local' }, { ...fake.options, cwd: project });
  assert.equal(realpathSync(fake.called().cwd), project);
  await assert.rejects(runOperation({ kind: 'remove-mcp', server: 'docs-search', scope: 'local' }, fake.options), /refused/);
});

test('a failure gives a short reason, never what the CLI printed; already done counts as done', async () => {
  const op = { kind: 'uninstall-plugin', plugin: 'notes@community', scope: 'user' } as const;
  assert.deepEqual(await runOperation(op, fakeClaude('failed').options), {
    ok: false,
    problem: 'claude plugin uninstall notes@community failed: not_installed',
  });
  assert.deepEqual(await runOperation(op, fakeClaude('already').options), { ok: true });
  assert.deepEqual(await runOperation({ kind: 'remove-mcp', server: 'db', scope: 'user' }, fakeClaude('plain').options), {
    ok: false,
    problem: 'claude mcp remove db failed (exit 1)',
  });
});

test('a missing claude or one that hangs is reported, not waited on forever', async () => {
  const op = { kind: 'disable-plugin', plugin: 'notes@community', scope: 'user' } as const;
  assert.deepEqual(await runOperation(op, { claude: [join(tmpdir(), 'no-such-claude')] }), {
    ok: false,
    problem: 'claude could not be run (not installed or not on PATH)',
  });
  assert.deepEqual(await runOperation(op, { ...fakeClaude('hang').options, timeout: 500 }), {
    ok: false,
    problem: 'claude plugin disable notes@community timed out',
  });
});
