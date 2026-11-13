import { chmod, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { readJson } from './json.js';
import type { ClaudePaths } from './paths.js';

// A backup is a folder with a copy of each file and a manifest that names them. Copies can
// hold secrets (~/.claude.json keeps MCP credentials): only the user can read them, and
// nothing here ever prints what a file says.
export interface BackupFile {
  path: string;
  // False when the file did not exist: undoing the change means removing it.
  existed: boolean;
  // Name of the copy inside the backup folder, and the file's permissions.
  copy?: string;
  mode?: number;
  // Fingerprint of the file as the change left it (sha256), null when it left none.
  after?: string | null;
}

export interface Manifest {
  createdAt: string;
  // Set once the change is written: until then it may be half done.
  sealed: boolean;
  files: BackupFile[];
}

export interface Backup {
  id: string;
  dir: string;
  // Call right after the change is written, so a restore can tell whether anyone changed
  // the files since.
  seal(): Promise<void>;
}

const PRIVATE_DIR = 0o700;
const PRIVATE_FILE = 0o600;

async function readIfAny(path: string): Promise<{ data: Buffer; mode: number } | undefined> {
  try {
    const [data, info] = await Promise.all([readFile(path), stat(path)]);
    return { data, mode: info.mode & 0o777 };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

// One folder per backup, named by time so they sort oldest first. Two backups in the same
// millisecond get a suffix instead of sharing a folder.
async function newFolder(paths: ClaudePaths, now: Date): Promise<{ id: string; dir: string }> {
  await mkdir(paths.backupsDir, { recursive: true, mode: PRIVATE_DIR });
  await chmod(paths.backupsDir, PRIVATE_DIR);
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  for (let n = 0; ; n++) {
    const id = n ? `${stamp}-${n}` : stamp;
    const dir = join(paths.backupsDir, id);
    try {
      await mkdir(dir, { mode: PRIVATE_DIR });
      await chmod(dir, PRIVATE_DIR);
      return { id, dir };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
  }
}

async function writePrivate(path: string, data: string | Buffer): Promise<void> {
  await writeFile(path, data, { mode: PRIVATE_FILE, flag: 'wx' });
}

const fingerprint = async (path: string): Promise<string | null> => {
  const current = await readIfAny(path);
  return current ? createHash('sha256').update(current.data).digest('hex') : null;
};

// Copies the files a change is about to touch, before it touches them.
export async function backup(paths: ClaudePaths, files: string[], { now = new Date() } = {}): Promise<Backup> {
  const { id, dir } = await newFolder(paths, now);
  const manifest: Manifest = { createdAt: now.toISOString(), sealed: false, files: [] };
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
  const seal = async () => {
    for (const file of manifest.files) file.after = await fingerprint(file.path);
    manifest.sealed = true;
    await replace(manifestPath, Buffer.from(JSON.stringify(manifest, null, 2)), PRIVATE_FILE);
  };
  return { id, dir, seal };
}

export interface RestoreResult {
  restored: string[];
  // Files changed after aldia's change: they are left as they are.
  skipped: string[];
  problems: string[];
}

// The newest backup folder, if any.
async function latestBackup(paths: ClaudePaths): Promise<string | undefined> {
  const entries = await readdir(paths.backupsDir, { withFileTypes: true }).catch(() => []);
  const ids = entries.filter((e) => e.isDirectory()).map((e) => e.name).sort();
  const id = ids.at(-1);
  return id && join(paths.backupsDir, id);
}

// Written beside the file and renamed over it, so the file is never left half written.
async function replace(path: string, data: Buffer, mode: number): Promise<void> {
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
export async function restoreLatest(paths: ClaudePaths): Promise<RestoreResult> {
  const result: RestoreResult = { restored: [], skipped: [], problems: [] };
  const dir = await latestBackup(paths);
  if (!dir) {
    result.problems.push('no backup to restore');
    return result;
  }
  const manifest = (await readJson(join(dir, 'manifest.json'), result.problems)) as Manifest | undefined;
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
  if (result.skipped.length) return result;
  for (const file of manifest.files) {
    if (file.existed && file.copy) await replace(file.path, await readFile(join(dir, file.copy)), file.mode ?? PRIVATE_FILE);
    else await rm(file.path, { force: true });
    result.restored.push(file.path);
  }
  await rm(dir, { recursive: true, force: true });
  return result;
}
