import { chmod, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
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
// Copies the files a change is about to touch, before it touches them.
export async function backup(paths, files, { now = new Date() } = {}) {
    const { id, dir } = await newFolder(paths, now);
    const manifest = { createdAt: now.toISOString(), files: [] };
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
    await writePrivate(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2));
    return { id, dir };
}
