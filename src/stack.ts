import { access, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { readJson } from './json.js';

// What a project is built with, read from its manifest files (never its source code).
// Ids are lowercase slugs, meant to double as catalog tags.
export interface StackProfile {
  languages: string[];
  frameworks: string[];
  tools: string[];
  packageManager?: string;
  // Which file each id was detected from, so a recommendation can say why.
  evidence: Record<string, string>;
  problems: string[];
}

// npm package name → framework id.
const NODE_FRAMEWORKS: Record<string, string> = {
  next: 'next',
  react: 'react',
  vue: 'vue',
  svelte: 'svelte',
  '@angular/core': 'angular',
  express: 'express',
  '@nestjs/core': 'nestjs',
  vite: 'vite',
  tailwindcss: 'tailwindcss',
  prisma: 'prisma',
  '@prisma/client': 'prisma',
  vitest: 'vitest',
  jest: 'jest',
  '@playwright/test': 'playwright',
};

// Python distribution name (lowercase) → framework id.
const PYTHON_FRAMEWORKS: Record<string, string> = {
  django: 'django',
  fastapi: 'fastapi',
  flask: 'flask',
  pytest: 'pytest',
  pandas: 'pandas',
  sqlalchemy: 'sqlalchemy',
  streamlit: 'streamlit',
};

// A manifest file that, on its own, tells the language.
const LANGUAGE_FILES: [file: string, language: string][] = [
  ['go.mod', 'go'],
  ['Cargo.toml', 'rust'],
  ['Gemfile', 'ruby'],
  ['pom.xml', 'java'],
  ['build.gradle', 'java'],
  ['build.gradle.kts', 'java'],
  ['composer.json', 'php'],
];

// A file or folder that tells a tool is in use.
const TOOL_FILES: [path: string, tool: string][] = [
  ['Dockerfile', 'docker'],
  ['docker-compose.yml', 'docker'],
  ['docker-compose.yaml', 'docker'],
  ['compose.yml', 'docker'],
  ['compose.yaml', 'docker'],
  ['.github/workflows', 'github-actions'],
];

// Checked in order: the first lockfile found names the package manager.
const NODE_LOCKFILES: [file: string, manager: string][] = [
  ['pnpm-lock.yaml', 'pnpm'],
  ['yarn.lock', 'yarn'],
  ['bun.lock', 'bun'],
  ['bun.lockb', 'bun'],
  ['package-lock.json', 'npm'],
];

async function readText(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

class Profile {
  readonly languages = new Set<string>();
  readonly frameworks = new Set<string>();
  readonly tools = new Set<string>();
  packageManager: string | undefined;
  readonly evidence: Record<string, string> = {};
  readonly problems: string[] = [];

  add(kind: 'languages' | 'frameworks' | 'tools', id: string, file: string): void {
    this[kind].add(id);
    this.evidence[id] ??= file;
  }

  result(): StackProfile {
    const sorted = (set: Set<string>) => [...set].sort();
    return {
      languages: sorted(this.languages),
      frameworks: sorted(this.frameworks),
      tools: sorted(this.tools),
      ...(this.packageManager ? { packageManager: this.packageManager } : {}),
      evidence: this.evidence,
      problems: this.problems,
    };
  }
}

// A folder to inspect: where it is on disk and its path from the repo root ('' for the root).
interface Folder {
  path: string;
  rel: string;
}

// Evidence paths always use '/', so they read the same on every OS.
const at = (folder: Folder, file: string) => (folder.rel ? `${folder.rel}/${file}` : file);

async function detectNode(folder: Folder, profile: Profile): Promise<void> {
  if (!(await exists(join(folder.path, 'package.json')))) return;
  profile.add('languages', 'javascript', at(folder, 'package.json'));

  const manifest = (await readJson(join(folder.path, 'package.json'), profile.problems)) as
    | { dependencies?: Record<string, string>; devDependencies?: Record<string, string> }
    | undefined;
  const deps = { ...manifest?.dependencies, ...manifest?.devDependencies };

  if (await exists(join(folder.path, 'tsconfig.json'))) profile.add('languages', 'typescript', at(folder, 'tsconfig.json'));
  else if ('typescript' in deps) profile.add('languages', 'typescript', at(folder, 'package.json'));

  for (const name of Object.keys(deps)) {
    const id = NODE_FRAMEWORKS[name];
    if (id) profile.add('frameworks', id, at(folder, 'package.json'));
  }

  // Folders are visited root first, so the root lockfile wins in a monorepo.
  if (profile.packageManager) return;
  for (const [file, manager] of NODE_LOCKFILES) {
    if (await exists(join(folder.path, file))) {
      profile.packageManager = manager;
      profile.evidence[manager] = at(folder, file);
      break;
    }
  }
}

const NAME = /^([A-Za-z0-9][A-Za-z0-9._-]*)/;

// requirements.txt: one requirement per line, name first. Comments and pip options skipped.
function requirementNames(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/#.*/, '').trim())
    .filter((line) => line && !line.startsWith('-'))
    .map((line) => NAME.exec(line)?.[1] ?? '');
}

// pyproject.toml without a TOML parser: names that open a quoted requirement
// ("fastapi>=0.1", PEP 621) or a key line (flask = "^3.0", Poetry). Other strings and
// keys it picks up, like the project name, simply match no framework.
function pyprojectNames(text: string): string[] {
  const quoted = [...text.matchAll(/["']([A-Za-z0-9][A-Za-z0-9._-]*)/g)].map((m) => m[1]!);
  const keys = [...text.matchAll(/^\s*([A-Za-z0-9][A-Za-z0-9._-]*)\s*=/gm)].map((m) => m[1]!);
  return [...quoted, ...keys];
}

async function detectPython(folder: Folder, profile: Profile): Promise<void> {
  const sources: [file: string, names: (text: string) => string[]][] = [
    ['pyproject.toml', pyprojectNames],
    ['requirements.txt', requirementNames],
  ];
  for (const [file, names] of sources) {
    const text = await readText(join(folder.path, file));
    if (text === undefined) continue;
    profile.add('languages', 'python', at(folder, file));
    for (const name of names(text)) {
      const id = PYTHON_FRAMEWORKS[name.toLowerCase().replace(/_/g, '-')];
      if (id) profile.add('frameworks', id, at(folder, file));
    }
  }
}

async function detectOthers(folder: Folder, profile: Profile): Promise<void> {
  for (const [file, language] of LANGUAGE_FILES) {
    if (await exists(join(folder.path, file))) profile.add('languages', language, at(folder, file));
  }
  const gemfile = await readText(join(folder.path, 'Gemfile'));
  if (gemfile && /^\s*gem\s+["']rails["']/m.test(gemfile)) profile.add('frameworks', 'rails', at(folder, 'Gemfile'));

  for (const [path, tool] of TOOL_FILES) {
    if (await exists(join(folder.path, path))) profile.add('tools', tool, at(folder, path));
  }
}

// The root and every folder below it, root first (breadth-first). Only folder names
// are read here. An unreadable folder counts as empty, like a missing file.
async function folders(root: string): Promise<Folder[]> {
  const found: Folder[] = [{ path: root, rel: '' }];
  for (let i = 0; i < found.length; i++) {
    const folder = found[i]!;
    const entries = await readdir(folder.path, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (entry.isDirectory()) found.push({ path: join(folder.path, entry.name), rel: at(folder, entry.name) });
    }
  }
  return found;
}

export async function detectStack(root: string): Promise<StackProfile> {
  const profile = new Profile();
  for (const folder of await folders(root)) {
    await detectNode(folder, profile);
    await detectPython(folder, profile);
    await detectOthers(folder, profile);
  }
  return profile.result();
}
