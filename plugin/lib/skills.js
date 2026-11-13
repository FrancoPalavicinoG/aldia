import { readdir, readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { parseFrontmatter } from './frontmatter.js';
async function subfolders(dir) {
    try {
        const entries = await readdir(dir, { withFileTypes: true });
        return entries.filter((e) => e.isDirectory() && !e.name.startsWith('.')).map((e) => join(dir, e.name));
    }
    catch (error) {
        if (error.code === 'ENOENT')
            return [];
        throw error;
    }
}
// Without a description, Claude Code uses the first non-empty line of the markdown body.
function firstContentLine(text) {
    const body = text.replace(/\r\n?/g, '\n').replace(/^---\n[\s\S]*?\n---(\n|$)/, '');
    return body.split('\n').find((line) => line.trim())?.trim() ?? '';
}
// Each subfolder holding a SKILL.md is one skill. Folders without it are skipped.
async function scanSkills(dir, source, problems, skip = []) {
    const skills = [];
    for (const folder of await subfolders(dir)) {
        if (skip.includes(basename(folder)))
            continue;
        const path = join(folder, 'SKILL.md');
        let text;
        try {
            text = await readFile(path, 'utf8');
        }
        catch (error) {
            if (error.code === 'ENOENT')
                continue;
            problems.push(`${path}: could not be read`);
            continue;
        }
        const fields = parseFrontmatter(text) ?? {};
        skills.push({
            name: fields.name ?? basename(folder),
            description: fields.description ?? firstContentLine(text),
            whenToUse: fields.when_to_use ?? '',
            modelInvocable: fields['disable-model-invocation'] !== 'true',
            source,
            path,
        });
    }
    return skills;
}
export async function readSkills(paths, plugins = [], project) {
    const problems = [];
    const syncedDir = join(paths.skillsDir, 'synced');
    const skills = await scanSkills(paths.skillsDir, 'personal', problems, ['synced']);
    // claude.ai keeps synced skills one level deeper, in one folder per sync bucket.
    for (const bucket of await subfolders(syncedDir)) {
        skills.push(...(await scanSkills(bucket, 'synced', problems)));
    }
    if (project)
        skills.push(...(await scanSkills(project.skillsDir, 'project', problems)));
    // A plugin installed in several scopes can share one install folder: read it once.
    const seen = new Set();
    for (const plugin of plugins) {
        if (!plugin.installPath || seen.has(plugin.installPath))
            continue;
        seen.add(plugin.installPath);
        for (const skill of await scanSkills(join(plugin.installPath, 'skills'), 'plugin', problems)) {
            skills.push({ ...skill, pluginId: plugin.id });
        }
    }
    skills.sort((a, b) => a.source.localeCompare(b.source) || a.name.localeCompare(b.name));
    return { skills, problems };
}
