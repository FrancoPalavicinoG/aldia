import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { detectStack } from '../src/stack.js';

const fixture = (name: string) => fileURLToPath(new URL(`../../test/fixtures/${name}`, import.meta.url));
const emptyDir = () => mkdtempSync(join(tmpdir(), 'aldia-repo-'));
const writeAt = (dir: string, rel: string, content: string) => {
  mkdirSync(join(dir, rel, '..'), { recursive: true });
  writeFileSync(join(dir, rel), content);
};
const vue = '{ "dependencies": { "vue": "3.5.0" } }';

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

test('a monorepo: each subfolder project is detected, with its path as evidence', async () => {
  const stack = await detectStack(fixture('repo-monorepo'));
  assert.deepEqual(stack.languages, ['javascript', 'python', 'typescript']);
  assert.deepEqual(stack.frameworks, ['fastapi', 'next', 'react']);
  assert.deepEqual(stack.tools, ['docker']);
  assert.equal(stack.packageManager, 'pnpm');
  assert.equal(stack.evidence.next, 'apps/web/package.json');
  assert.equal(stack.evidence.fastapi, 'services/api/pyproject.toml');
  assert.equal(stack.evidence.docker, 'services/api/Dockerfile');
  assert.equal(stack.evidence.typescript, 'package.json');
});

test('dependency, build and hidden folders are never scanned', async () => {
  const dir = emptyDir();
  for (const rel of ['node_modules/lib', 'apps/web/.next', 'dist', 'build', 'out', 'target', 'vendor', 'venv', 'coverage']) {
    writeAt(dir, `${rel}/package.json`, vue);
  }
  writeAt(dir, '.venv/lib/pyproject.toml', 'dependencies = ["django"]\n');
  writeAt(dir, 'api/__pycache__/requirements.txt', 'flask\n');
  const stack = await detectStack(dir);
  assert.deepEqual(stack.languages, []);
  assert.deepEqual(stack.frameworks, []);
});

test('the scan goes 3 folders deep and does not follow symlinks', async () => {
  const dir = emptyDir();
  writeAt(dir, 'a/b/c/package.json', '{ "dependencies": { "react": "19.0.0" } }');
  writeAt(dir, 'a/b/c/d/package.json', vue);
  const outside = emptyDir();
  writeAt(outside, 'package.json', '{ "dependencies": { "express": "5.0.0" } }');
  symlinkSync(outside, join(dir, 'linked'), 'junction');
  const stack = await detectStack(dir);
  assert.deepEqual(stack.frameworks, ['react']);
  assert.equal(stack.evidence.react, 'a/b/c/package.json');
});

test('a huge repo stops at 500 folders and says so', async () => {
  const dir = emptyDir();
  writeAt(dir, 'package.json', '{}');
  for (let i = 0; i < 600; i++) mkdirSync(join(dir, `pkg-${i}`));
  const stack = await detectStack(dir);
  assert.deepEqual(stack.languages, ['javascript']);
  assert.equal(stack.problems.length, 1);
  assert.match(stack.problems[0]!, /500 folders/);
});
