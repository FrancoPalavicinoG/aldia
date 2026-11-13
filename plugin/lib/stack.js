import { access, readdir, readFile } from 'node:fs/promises';
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
// A manifest file that, on its own, tells the language.
const LANGUAGE_FILES = [
    ['go.mod', 'go'],
    ['Cargo.toml', 'rust'],
    ['Gemfile', 'ruby'],
    ['pom.xml', 'java'],
    ['build.gradle', 'java'],
    ['build.gradle.kts', 'java'],
    ['composer.json', 'php'],
];
// A file or folder that tells a tool is in use.
const TOOL_FILES = [
    ['Dockerfile', 'docker'],
    ['docker-compose.yml', 'docker'],
    ['docker-compose.yaml', 'docker'],
    ['compose.yml', 'docker'],
    ['compose.yaml', 'docker'],
    ['.github/workflows', 'github-actions'],
];
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
// Evidence paths always use '/', so they read the same on every OS.
const at = (folder, file) => (folder.rel ? `${folder.rel}/${file}` : file);
async function detectNode(folder, profile) {
    if (!(await exists(join(folder.path, 'package.json'))))
        return;
    profile.add('languages', 'javascript', at(folder, 'package.json'));
    const manifest = (await readJson(join(folder.path, 'package.json'), profile.problems));
    const deps = { ...manifest?.dependencies, ...manifest?.devDependencies };
    if (await exists(join(folder.path, 'tsconfig.json')))
        profile.add('languages', 'typescript', at(folder, 'tsconfig.json'));
    else if ('typescript' in deps)
        profile.add('languages', 'typescript', at(folder, 'package.json'));
    for (const name of Object.keys(deps)) {
        const id = NODE_FRAMEWORKS[name];
        if (id)
            profile.add('frameworks', id, at(folder, 'package.json'));
    }
    // Folders are visited root first, so the root lockfile wins in a monorepo.
    if (profile.packageManager)
        return;
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
async function detectPython(folder, profile) {
    const sources = [
        ['pyproject.toml', pyprojectNames],
        ['requirements.txt', requirementNames],
    ];
    for (const [file, names] of sources) {
        const text = await readText(join(folder.path, file));
        if (text === undefined)
            continue;
        profile.add('languages', 'python', at(folder, file));
        for (const name of names(text)) {
            const id = PYTHON_FRAMEWORKS[name.toLowerCase().replace(/_/g, '-')];
            if (id)
                profile.add('frameworks', id, at(folder, file));
        }
    }
}
async function detectOthers(folder, profile) {
    for (const [file, language] of LANGUAGE_FILES) {
        if (await exists(join(folder.path, file)))
            profile.add('languages', language, at(folder, file));
    }
    const gemfile = await readText(join(folder.path, 'Gemfile'));
    if (gemfile && /^\s*gem\s+["']rails["']/m.test(gemfile))
        profile.add('frameworks', 'rails', at(folder, 'Gemfile'));
    for (const [path, tool] of TOOL_FILES) {
        if (await exists(join(folder.path, path)))
            profile.add('tools', tool, at(folder, path));
    }
}
// Dependencies, build output and caches: their manifests are not the user's project.
// Hidden folders (.git, .next, .venv...) are skipped too.
const SKIPPED_FOLDERS = new Set(['node_modules', 'dist', 'build', 'out', 'target', 'vendor', 'venv', '__pycache__', 'coverage']);
const MAX_DEPTH = 3;
const MAX_FOLDERS = 500;
// The root and the folders below it, root first (breadth-first). Only folder names are
// read here. Symlinks are not followed. An unreadable folder counts as empty, like a
// missing file.
async function folders(root, problems) {
    const found = [{ path: root, rel: '' }];
    for (let i = 0; i < found.length; i++) {
        const folder = found[i];
        const depth = folder.rel ? folder.rel.split('/').length : 0;
        if (depth === MAX_DEPTH)
            continue;
        const entries = await readdir(folder.path, { withFileTypes: true }).catch(() => []);
        for (const entry of entries) {
            if (!entry.isDirectory() || entry.name.startsWith('.') || SKIPPED_FOLDERS.has(entry.name))
                continue;
            if (found.length === MAX_FOLDERS) {
                problems.push(`stopped after ${MAX_FOLDERS} folders; deeper projects were not scanned`);
                return found;
            }
            found.push({ path: join(folder.path, entry.name), rel: at(folder, entry.name) });
        }
    }
    return found;
}
export async function detectStack(root) {
    const profile = new Profile();
    for (const folder of await folders(root, profile.problems)) {
        await detectNode(folder, profile);
        await detectPython(folder, profile);
        await detectOthers(folder, profile);
    }
    return profile.result();
}
