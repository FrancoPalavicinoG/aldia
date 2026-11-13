import { createReadStream } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
// Session files hold everything: prompts, code, command output, maybe secrets. Only tool
// names, the skill name of a Skill call and the timestamp are taken. A line that can't
// hold a tool call is skipped without parsing, and a line that isn't valid JSON (a
// session still being written) is ignored.
async function scanSession(path, counts) {
    const lines = createInterface({ input: createReadStream(path, 'utf8'), crlfDelay: Infinity });
    for await (const line of lines) {
        if (!line.includes('"tool_use"'))
            continue;
        let entry;
        try {
            entry = JSON.parse(line);
        }
        catch {
            continue;
        }
        const content = entry.message?.content;
        if (!Array.isArray(content))
            continue;
        const when = typeof entry.timestamp === 'string' ? entry.timestamp : '';
        for (const block of content) {
            if (block?.type !== 'tool_use' || typeof block.name !== 'string')
                continue;
            if (block.name === 'Skill' && typeof block.input?.skill === 'string')
                count(counts.skills, block.input.skill, when);
            const server = /^mcp__(.+?)__/.exec(block.name)?.[1];
            if (server)
                count(counts.mcpServers, server, when);
        }
    }
}
// Maps, not plain objects: a name from the history like "__proto__" stays a plain key.
function count(map, name, when) {
    const seen = map.get(name) ?? { count: 0, lastUsed: '' };
    seen.count++;
    if (when > seen.lastUsed)
        seen.lastUsed = when;
    map.set(name, seen);
}
async function entries(dir) {
    try {
        return await readdir(dir, { withFileTypes: true });
    }
    catch (error) {
        if (error.code === 'ENOENT')
            return [];
        throw error;
    }
}
export async function readUsage(paths) {
    const counts = { skills: new Map(), mcpServers: new Map() };
    const problems = [];
    let sessions = 0;
    const scan = async (path) => {
        try {
            await scanSession(path, counts);
        }
        catch {
            problems.push(`${path}: could not be read`);
        }
    };
    // projects/<project>/<session>.jsonl, and its subagents in <session>/subagents/*.jsonl.
    for (const project of await entries(paths.projectsDir)) {
        if (!project.isDirectory())
            continue;
        const projectDir = join(paths.projectsDir, project.name);
        for (const item of await entries(projectDir)) {
            if (item.isFile() && item.name.endsWith('.jsonl')) {
                sessions++;
                await scan(join(projectDir, item.name));
            }
            else if (item.isDirectory()) {
                const subagents = join(projectDir, item.name, 'subagents');
                for (const file of await entries(subagents)) {
                    if (file.isFile() && file.name.endsWith('.jsonl'))
                        await scan(join(subagents, file.name));
                }
            }
        }
    }
    return {
        sessions,
        skills: Object.fromEntries(counts.skills),
        mcpServers: Object.fromEntries(counts.mcpServers),
        problems,
    };
}
