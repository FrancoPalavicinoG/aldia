import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { readJson } from './json.js';
// npm package name → framework id.
const NODE_FRAMEWORKS = {
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
const NODE_LOCKFILES = [
    ['pnpm-lock.yaml', 'pnpm'],
    ['yarn.lock', 'yarn'],
    ['bun.lock', 'bun'],
    ['bun.lockb', 'bun'],
    ['package-lock.json', 'npm'],
];
async function exists(path) {
    try {
        await access(path);
        return true;
    }
    catch {
        return false;
    }
}
class Profile {
    languages = new Set();
    frameworks = new Set();
    tools = new Set();
    packageManager;
    evidence = {};
    problems = [];
    add(kind, id, file) {
        this[kind].add(id);
        this.evidence[id] ??= file;
    }
    result() {
        const sorted = (set) => [...set].sort();
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
async function detectNode(root, profile) {
    if (!(await exists(join(root, 'package.json'))))
        return;
    profile.add('languages', 'javascript', 'package.json');
    const manifest = (await readJson(join(root, 'package.json'), profile.problems));
    const deps = { ...manifest?.dependencies, ...manifest?.devDependencies };
    if (await exists(join(root, 'tsconfig.json')))
        profile.add('languages', 'typescript', 'tsconfig.json');
    else if ('typescript' in deps)
        profile.add('languages', 'typescript', 'package.json');
    for (const name of Object.keys(deps)) {
        const id = NODE_FRAMEWORKS[name];
        if (id)
            profile.add('frameworks', id, 'package.json');
    }
    for (const [file, manager] of NODE_LOCKFILES) {
        if (await exists(join(root, file))) {
            profile.packageManager = manager;
            profile.evidence[manager] = file;
            break;
        }
    }
}
export async function detectStack(root) {
    const profile = new Profile();
    await detectNode(root, profile);
    return profile.result();
}
