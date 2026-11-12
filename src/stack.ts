import { access } from 'node:fs/promises';
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

// Checked in order: the first lockfile found names the package manager.
const NODE_LOCKFILES: [file: string, manager: string][] = [
  ['pnpm-lock.yaml', 'pnpm'],
  ['yarn.lock', 'yarn'],
  ['bun.lock', 'bun'],
  ['bun.lockb', 'bun'],
  ['package-lock.json', 'npm'],
];

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

async function detectNode(root: string, profile: Profile): Promise<void> {
  if (!(await exists(join(root, 'package.json')))) return;
  profile.add('languages', 'javascript', 'package.json');

  const manifest = (await readJson(join(root, 'package.json'), profile.problems)) as
    | { dependencies?: Record<string, string>; devDependencies?: Record<string, string> }
    | undefined;
  const deps = { ...manifest?.dependencies, ...manifest?.devDependencies };

  if (await exists(join(root, 'tsconfig.json'))) profile.add('languages', 'typescript', 'tsconfig.json');
  else if ('typescript' in deps) profile.add('languages', 'typescript', 'package.json');

  for (const name of Object.keys(deps)) {
    const id = NODE_FRAMEWORKS[name];
    if (id) profile.add('frameworks', id, 'package.json');
  }

  for (const [file, manager] of NODE_LOCKFILES) {
    if (await exists(join(root, file))) {
      profile.packageManager = manager;
      profile.evidence[manager] = file;
      break;
    }
  }
}

export async function detectStack(root: string): Promise<StackProfile> {
  const profile = new Profile();
  await detectNode(root, profile);
  return profile.result();
}
