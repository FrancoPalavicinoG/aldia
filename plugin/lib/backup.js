import { chmod, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { readJson } from './json.js';
const KEEP = 10;
const PRIVATE_DIR = 0o700;
const PRIVATE_FILE = 0o600;
async function readIfAny(path) {
    try {
        const [data, info] = await Promise.all([readFile(path), stat(path)]);
        return { data, mode: info.mode & 0o777 };
    }
    catch (error) {
        if (error.code === 'ENOENT')
            return undefined;
        throw error;
    }
}
// One folder per backup, named by time so they sort oldest first. Two backups in the same
// millisecond get a suffix instead of sharing a folder.
async function newFolder(paths, now) {
    await mkdir(paths.backupsDir, { recursive: true, mode: PRIVATE_DIR });
    await chmod(paths.backupsDir, PRIVATE_DIR);
    const stamp = now.toISOString().replace(/[:.]/g, '-');
    for (let n = 0;; n++) {
        const id = n ? `${stamp}-${n}` : stamp;
        const dir = join(paths.backupsDir, id);
        try {
            await mkdir(dir, { mode: PRIVATE_DIR });
            await chmod(dir, PRIVATE_DIR);
            return { id, dir };
        }
        catch (error) {
            if (error.code !== 'EEXIST')
                throw error;
        }
    }
}
async function writePrivate(path, data) {
    await writeFile(path, data, { mode: PRIVATE_FILE, flag: 'wx' });
}
const fingerprint = async (path) => {
    const current = await readIfAny(path);
    return current ? createHash('sha256').update(current.data).digest('hex') : null;
};
// Copies the files a change is about to touch, before it touches them.
export async function backup(paths, files, { now = new Date() } = {}) {
    const { id, dir } = await newFolder(paths, now);
    const manifest = { createdAt: now.toISOString(), sealed: false, files: [] };
    for (const [i, path] of files.entries()) {
        const current = await readIfAny(path);
        if (!current) {
            manifest.files.push({ path, existed: false });
            continue;
        }
        const copy = `file-${i}`;
        await writePrivate(join(dir, copy), current.data);
        manifest.files.push({ path, existed: true, copy, mode: current.mode });
    }
    const manifestPath = join(dir, 'manifest.json');
    await writePrivate(manifestPath, JSON.stringify(manifest, null, 2));
    // Only the latest ones are worth undoing; older copies would just keep old secrets around.
    for (const old of (await backupIds(paths)).slice(0, -KEEP))
        await rm(join(paths.backupsDir, old), { recursive: true, force: true });
    const seal = async () => {
        for (const file of manifest.files)
            file.after = await fingerprint(file.path);
        manifest.sealed = true;
        await replace(manifestPath, Buffer.from(JSON.stringify(manifest, null, 2)), PRIVATE_FILE);
    };
    return { id, dir, seal };
}
// Backup folders, oldest first.
async function backupIds(paths) {
    const entries = await readdir(paths.backupsDir, { withFileTypes: true }).catch(() => []);
    return entries.filter((e) => e.isDirectory()).map((e) => e.name).sort();
}
// Written beside the file and renamed over it, so the file is never left half written.
async function replace(path, data, mode) {
    const temp = `${path}.aldia-${process.pid}.tmp`;
    await writeFile(temp, data, { mode });
    await chmod(temp, mode);
    await rename(temp, path);
}
// Undoes the latest change: each file goes back to its copy, a file that did not exist is
// removed. The backup is then dropped, so the next restore undoes the change before it.
// If any file changed after aldia's change (the user or Claude Code wrote to it), or the
// change never finished, nothing is restored: that would overwrite someone else's work or
// leave the change half undone. The backup is kept.
export async function restoreLatest(paths) {
    const result = { restored: [], skipped: [], problems: [] };
    const id = (await backupIds(paths)).at(-1);
    const dir = id && join(paths.backupsDir, id);
    if (!dir) {
        result.problems.push('no backup to restore');
        return result;
    }
    const manifest = (await readJson(join(dir, 'manifest.json'), result.problems));
    if (!manifest) {
        result.problems.push(`${dir}: backup has no manifest; nothing restored`);
        return result;
    }
    if (!manifest.sealed) {
        result.problems.push("the latest change didn't finish (backup not sealed); nothing restored");
        return result;
    }
    for (const file of manifest.files) {
        if ((await fingerprint(file.path)) !== file.after) {
            result.skipped.push(file.path);
            result.problems.push(`${file.path}: changed after aldia's change; nothing restored`);
        }
    }
    if (result.skipped.length)
        return result;
    for (const file of manifest.files) {
        if (file.existed && file.copy)
            await replace(file.path, await readFile(join(dir, file.copy)), file.mode ?? PRIVATE_FILE);
        else
            await rm(file.path, { force: true });
        result.restored.push(file.path);
    }
    await rm(dir, { recursive: true, force: true });
    return result;
}
