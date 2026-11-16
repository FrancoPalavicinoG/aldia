import { open } from 'node:fs/promises';
// Files aldia reads can be anything: a folder where a file should be, a huge file, the
// wrong types. None of that stops a report: it becomes a problem, named by path only,
// never by content.
const MB = 1024 * 1024;
// Text files: SKILL.md and the manifests in a repo.
const MAX_TEXT = MB;
// ~/.claude.json keeps per-project state and grows with use.
const MAX_JSON = 32 * MB;
// A missing file gives undefined, without a problem.
export async function readText(path, problems, max = MAX_TEXT) {
    let file;
    try {
        file = await open(path, 'r');
    }
    catch (error) {
        const code = error.code;
        // Windows refuses to open a folder; elsewhere it opens and stat says what it is.
        if (code === 'EISDIR')
            problems.push(`${path}: not a file`);
        else if (code !== 'ENOENT')
            problems.push(`${path}: could not be read`);
        return undefined;
    }
    try {
        const info = await file.stat();
        if (!info.isFile()) {
            problems.push(`${path}: not a file`);
            return undefined;
        }
        if (info.size > max) {
            problems.push(`${path}: too big to read (over ${max / MB} MB)`);
            return undefined;
        }
        return await file.readFile('utf8');
    }
    catch {
        problems.push(`${path}: could not be read`);
        return undefined;
    }
    finally {
        await file.close();
    }
}
// A file that isn't valid JSON is a problem and gives undefined.
export async function readJson(path, problems) {
    const text = await readText(path, problems, MAX_JSON);
    if (text === undefined)
        return undefined;
    try {
        return JSON.parse(text);
    }
    catch {
        problems.push(`${path}: not valid JSON`);
        return undefined;
    }
}
// Small checks for what JSON.parse gives: a value of another type becomes a problem
// instead of a crash further on.
export const isObject = (value) => !!value && typeof value === 'object' && !Array.isArray(value);
// A field that should hold text: missing gives undefined; any other type is a problem.
export function textField(object, field, where, problems) {
    const value = object[field];
    if (value === undefined || typeof value === 'string')
        return value;
    problems.push(`${where}: ${field} is not text`);
    return undefined;
}
