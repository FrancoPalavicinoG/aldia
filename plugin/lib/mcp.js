import { basename, join, relative, resolve, isAbsolute } from 'node:path';
import { readJson } from './json.js';
// Server configs hold credentials in headers, env, args and URL queries. Only the
// fields below are copied out; everything else is dropped here, on read.
function describe(name, config, source) {
    const transport = config.type ?? (config.url ? 'http' : 'stdio');
    let target = '';
    if (config.url) {
        try {
            target = new URL(config.url).host;
        }
        catch {
            target = 'unknown';
        }
    }
    else if (config.command) {
        target = basename(config.command);
    }
    return { name, transport, target, source };
}
function serversIn(map, source) {
    if (!map || typeof map !== 'object')
        return [];
    return Object.entries(map).map(([name, config]) => describe(name, config ?? {}, source));
}
// A server file may wrap its servers in "mcpServers" or list them at the top level.
function unwrap(file) {
    const wrapped = file?.mcpServers;
    return wrapped && typeof wrapped === 'object' ? wrapped : file;
}
// A plugin declares servers in .mcp.json at its root and in the manifest's mcpServers,
// which takes an inline map, a path to a JSON file, or an array of those. A manifest
// server replaces a .mcp.json server of the same name. Packaged .mcpb servers and
// paths outside the plugin folder are skipped.
async function pluginServerMap(root, problems) {
    const fromFile = unwrap(await readJson(join(root, '.mcp.json'), problems));
    const manifest = (await readJson(join(root, '.claude-plugin', 'plugin.json'), problems));
    const declared = manifest?.mcpServers;
    const entries = Array.isArray(declared) ? declared : declared === undefined ? [] : [declared];
    const map = { ...(fromFile && typeof fromFile === 'object' ? fromFile : {}) };
    for (const entry of entries) {
        if (typeof entry === 'string') {
            const path = resolve(root, entry);
            const inside = relative(root, path);
            if (entry.endsWith('.mcpb') || entry.endsWith('.dxt') || inside.startsWith('..') || isAbsolute(inside))
                continue;
            Object.assign(map, unwrap(await readJson(path, problems)));
        }
        else if (entry && typeof entry === 'object') {
            Object.assign(map, entry);
        }
    }
    return map;
}
export async function readMcpServers(paths, plugins = []) {
    const problems = [];
    const state = (await readJson(paths.globalState, problems));
    const servers = serversIn(state?.mcpServers, 'user');
    const seen = new Set();
    for (const plugin of plugins) {
        if (!plugin.installPath || seen.has(plugin.installPath))
            continue;
        seen.add(plugin.installPath);
        for (const server of serversIn(await pluginServerMap(plugin.installPath, problems), 'plugin')) {
            servers.push({ ...server, pluginId: plugin.id });
        }
    }
    servers.sort((a, b) => a.source.localeCompare(b.source) || (a.pluginId ?? '').localeCompare(b.pluginId ?? '') || a.name.localeCompare(b.name));
    return { servers, problems };
}
