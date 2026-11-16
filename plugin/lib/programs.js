import { accessSync, constants, realpathSync, statSync } from 'node:fs';
import { delimiter, isAbsolute, join, relative, resolve } from 'node:path';
const windows = process.platform === 'win32';
const real = (path) => {
    try {
        return realpathSync(path);
    }
    catch {
        return resolve(path);
    }
};
function inside(folder, root) {
    const rel = relative(real(root), real(folder));
    return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}
function runnable(path) {
    try {
        if (!statSync(path).isFile())
            return false;
        if (!windows)
            accessSync(path, constants.X_OK);
        return true;
    }
    catch {
        return false;
    }
}
// Finds a program in PATH and gives its absolute path, so that what runs never depends on
// the folder it runs in. Run by name, Windows looks in that folder first; and a relative
// or empty PATH entry ("." or "") is that folder anywhere. Entries inside the given
// folders (the repo: direnv adds <repo>/bin) are skipped too: a program committed there
// could run. On Windows only .exe counts: a .cmd needs a shell.
export function findProgram(name, env, avoid = []) {
    const key = Object.keys(env).find((k) => k.toUpperCase() === 'PATH');
    const entries = (key ? env[key] ?? '' : '')
        .split(delimiter)
        .filter((entry) => entry && isAbsolute(entry) && !avoid.some((root) => inside(entry, root)));
    for (const entry of entries) {
        const path = join(entry, windows ? `${name}.exe` : name);
        if (runnable(path))
            return { path };
    }
    if (windows && entries.some((entry) => runnable(join(entry, `${name}.cmd`)))) {
        return { problem: `${name} is installed as a .cmd script, which aldia runs without a shell and cannot start` };
    }
    return {};
}
