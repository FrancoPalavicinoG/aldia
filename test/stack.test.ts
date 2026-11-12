import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { detectStack } from '../src/stack.js';

const fixture = (name: string) => fileURLToPath(new URL(`../../test/fixtures/${name}`, import.meta.url));
const emptyDir = () => mkdtempSync(join(tmpdir(), 'aldia-repo-'));

test('a Next.js + Tailwind + TypeScript repo on pnpm', async () => {
  const stack = await detectStack(fixture('repo-next'));
  assert.deepEqual(stack.languages, ['javascript', 'typescript']);
  assert.deepEqual(stack.frameworks, ['next', 'playwright', 'react', 'tailwindcss']);
  assert.equal(stack.packageManager, 'pnpm');
  assert.equal(stack.evidence.next, 'package.json');
  assert.equal(stack.evidence.pnpm, 'pnpm-lock.yaml');
  assert.equal(stack.evidence.typescript, 'tsconfig.json');
});

test('an empty folder detects nothing; a malformed package.json is a problem', async () => {
  assert.deepEqual(await detectStack(emptyDir()), {
    languages: [],
    frameworks: [],
    tools: [],
    evidence: {},
    problems: [],
  });

  const dir = emptyDir();
  writeFileSync(join(dir, 'package.json'), '{ "dependencies": ');
  const stack = await detectStack(dir);
  assert.deepEqual(stack.languages, ['javascript']);
  assert.equal(stack.problems.length, 1);
  assert.match(stack.problems[0]!, /package\.json/);
});
