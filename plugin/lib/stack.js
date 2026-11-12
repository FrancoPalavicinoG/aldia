import { access, readFile } from 'node:fs/promises';
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
// Python distribution name (lowercase) → framework id.
const PYTHON_FRAMEWORKS = {
    django: 'django',
    fastapi: 'fastapi',
    flask: 'flask',
    pytest: 'pytest',
    pandas: 'pandas',
    sqlalchemy: 'sqlalchemy',
    streamlit: 'streamlit',
};
// Checked in order: the first lockfile found names the package manager.
const NODE_LOCKFILES = [
    ['pnpm-lock.yaml', 'pnpm'],
    ['yarn.lock', 'yarn'],
    ['bun.lock', 'bun'],
    ['bun.lockb', 'bun'],
    ['package-lock.json', 'npm'],
];
async function readText(path) {
    try {
        return await readFile(path, 'utf8');
    }
    catch (error) {
        if (error.code === 'ENOENT')
            return undefined;
        throw error;
    }
}
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
const NAME = /^([A-Za-z0-9][A-Za-z0-9._-]*)/;
// requirements.txt: one requirement per line, name first. Comments and pip options skipped.
function requirementNames(text) {
    return text
        .split(/\r?\n/)
        .map((line) => line.replace(/#.*/, '').trim())
        .filter((line) => line && !line.startsWith('-'))
        .map((line) => NAME.exec(line)?.[1] ?? '');
}
// pyproject.toml without a TOML parser: names that open a quoted requirement
// ("fastapi>=0.1", PEP 621) or a key line (flask = "^3.0", Poetry). Other strings and
// keys it picks up, like the project name, simply match no framework.
function pyprojectNames(text) {
    const quoted = [...text.matchAll(/["']([A-Za-z0-9][A-Za-z0-9._-]*)/g)].map((m) => m[1]);
    const keys = [...text.matchAll(/^\s*([A-Za-z0-9][A-Za-z0-9._-]*)\s*=/gm)].map((m) => m[1]);
    return [...quoted, ...keys];
}
async function detectPython(root, profile) {
    const sources = [
        ['pyproject.toml', pyprojectNames],
        ['requirements.txt', requirementNames],
    ];
    for (const [file, names] of sources) {
        const text = await readText(join(root, file));
        if (text === undefined)
            continue;
        profile.add('languages', 'python', file);
        for (const name of names(text)) {
            const id = PYTHON_FRAMEWORKS[name.toLowerCase().replace(/_/g, '-')];
            if (id)
                profile.add('frameworks', id, file);
        }
    }
}
export async function detectStack(root) {
    const profile = new Profile();
    await detectNode(root, profile);
    await detectPython(root, profile);
    return profile.result();
}
