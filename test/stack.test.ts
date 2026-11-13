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

test('a Python repo: dependencies from pyproject.toml', async () => {
  const stack = await detectStack(fixture('repo-python'));
  assert.deepEqual(stack.languages, ['python']);
  assert.deepEqual(stack.frameworks, ['fastapi', 'pytest', 'sqlalchemy']);
  assert.equal(stack.evidence.fastapi, 'pyproject.toml');
});

test('a Python repo: requirements.txt and Poetry-style tables', async () => {
  const dir = emptyDir();
  writeFileSync(join(dir, 'requirements.txt'), '# web\nDjango==5.1 ; python_version >= "3.10"\n-r dev.txt\npandas\n');
  writeFileSync(join(dir, 'pyproject.toml'), '[tool.poetry.dependencies]\npython = "^3.12"\nflask = "^3.0"\n');
  const stack = await detectStack(dir);
  assert.deepEqual(stack.languages, ['python']);
  assert.deepEqual(stack.frameworks, ['django', 'flask', 'pandas']);
  assert.equal(stack.evidence.django, 'requirements.txt');
});

test('other languages and tools: Go, Docker and GitHub Actions together', async () => {
  const stack = await detectStack(fixture('repo-polyglot'));
  assert.deepEqual(stack.languages, ['go']);
  assert.deepEqual(stack.tools, ['docker', 'github-actions']);
  assert.equal(stack.evidence.docker, 'Dockerfile');
  assert.equal(stack.evidence['github-actions'], '.github/workflows');
});

test('Rust, Ruby on Rails, Java and PHP are recognized by their manifests', async () => {
  const dir = emptyDir();
  writeFileSync(join(dir, 'Cargo.toml'), '[package]\nname = "cli"\n');
  writeFileSync(join(dir, 'Gemfile'), "source 'https://rubygems.org'\ngem 'rails', '~> 8.0'\n");
  writeFileSync(join(dir, 'build.gradle.kts'), 'plugins { java }\n');
  writeFileSync(join(dir, 'composer.json'), '{}\n');
  writeFileSync(join(dir, 'compose.yaml'), 'services: {}\n');
  const stack = await detectStack(dir);
  assert.deepEqual(stack.languages, ['java', 'php', 'ruby', 'rust']);
  assert.deepEqual(stack.frameworks, ['rails']);
  assert.deepEqual(stack.tools, ['docker']);
});
