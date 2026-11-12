import { readFile } from 'node:fs/promises';
// Reads a JSON file. A missing file gives undefined; a file that isn't valid JSON is
// added to `problems` (by path only, never its content) and also gives undefined.
export async function readJson(path, problems) {
    let text;
    try {
        text = await readFile(path, 'utf8');
    }
    catch (error) {
        if (error.code === 'ENOENT')
            return undefined;
        throw error;
    }
    try {
        return JSON.parse(text);
    }
    catch {
        problems.push(`${path}: not valid JSON`);
        return undefined;
    }
}
