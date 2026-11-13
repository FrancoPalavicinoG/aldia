import { readdir, readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { parseFrontmatter } from './frontmatter.js';
import type { ClaudePaths, ProjectPaths } from './paths.js';
import type { InstalledPlugin } from './plugins.js';

export type SkillSource = 'personal' | 'synced' | 'project' | 'plugin';

export interface Skill {
  name: string;
  description: string;
  source: SkillSource;
  pluginId?: string;
  path: string;
}

export interface SkillInventory {
  skills: Skill[];
  problems: string[];
}

async function subfolders(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory() && !e.name.startsWith('.')).map((e) => join(dir, e.name));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

// Each subfolder holding a SKILL.md is one skill. Folders without it are skipped.
async function scanSkills(dir: string, source: SkillSource, problems: string[], skip: string[] = []): Promise<Skill[]> {
  const skills: Skill[] = [];
  for (const folder of await subfolders(dir)) {
    if (skip.includes(basename(folder))) continue;
    const path = join(folder, 'SKILL.md');
    let text: string;
    try {
      text = await readFile(path, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      problems.push(`${path}: could not be read`);
      continue;
    }
    const fields = parseFrontmatter(text) ?? {};
    skills.push({ name: fields.name ?? basename(folder), description: fields.description ?? '', source, path });
  }
  return skills;
}

export async function readSkills(
  paths: ClaudePaths,
  plugins: InstalledPlugin[] = [],
  project?: ProjectPaths,
): Promise<SkillInventory> {
  const problems: string[] = [];
  const syncedDir = join(paths.skillsDir, 'synced');
  const skills = await scanSkills(paths.skillsDir, 'personal', problems, ['synced']);
  // claude.ai keeps synced skills one level deeper, in one folder per sync bucket.
  for (const bucket of await subfolders(syncedDir)) {
    skills.push(...(await scanSkills(bucket, 'synced', problems)));
  }
  if (project) skills.push(...(await scanSkills(project.skillsDir, 'project', problems)));
  // A plugin installed in several scopes can share one install folder: read it once.
  const seen = new Set<string>();
  for (const plugin of plugins) {
    if (!plugin.installPath || seen.has(plugin.installPath)) continue;
    seen.add(plugin.installPath);
    for (const skill of await scanSkills(join(plugin.installPath, 'skills'), 'plugin', problems)) {
      skills.push({ ...skill, pluginId: plugin.id });
    }
  }
  skills.sort((a, b) => a.source.localeCompare(b.source) || a.name.localeCompare(b.name));
  return { skills, problems };
}
