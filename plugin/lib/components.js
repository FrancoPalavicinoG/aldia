import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { isObject, readJson } from './json.js';
import { validName } from './text.js';
// Each part the history can't measure: where it is by default, and the manifest keys that
// declare it. Skills, commands, agents and MCP servers are measured, so they aren't here.
const UNMEASURED = [
    { part: 'hooks', path: 'hooks/hooks.json', keys: ['hooks'] },
    { part: 'LSP servers', path: '.lsp.json', keys: ['lspServers'] },
    { part: 'monitors', path: 'monitors/monitors.json', keys: ['monitors', 'experimental.monitors'] },
    { part: 'programs (bin/)', path: 'bin', keys: [] },
    { part: 'output styles', path: 'output-styles', keys: ['outputStyles'] },
    { part: 'workflows', path: 'workflows', keys: ['workflows'] },
    { part: 'themes', path: 'themes', keys: ['themes', 'experimental.themes'] },
    { part: 'channels', keys: ['channels'] },
];
const exists = async (path) => {
    try {
        await stat(path);
        return true;
    }
    catch {
        return false;
    }
};
function declares(manifest, key) {
    const [first, second] = key.split('.');
    const value = second ? (isObject(manifest[first]) ? manifest[first][second] : undefined) : manifest[first];
    return value !== undefined;
}
// A dependency is "name", "name@marketplace" or { name, marketplace? }; a bare name is in
// the plugin's own marketplace.
function dependencyId(entry, marketplace) {
    const text = typeof entry === 'string' ? entry : isObject(entry) && typeof entry.name === 'string' ? entry.name : undefined;
    if (text === undefined)
        return undefined;
    const at = text.indexOf('@');
    const name = at < 0 ? text : text.slice(0, at);
    const from = at < 0 ? (isObject(entry) && typeof entry.marketplace === 'string' ? entry.marketplace : marketplace) : text.slice(at + 1);
    return validName(name) && validName(from) ? `${name}@${from}` : undefined;
}
// Undefined when the manifest can't be read: without plugin.json the marketplace entry is
// the manifest, and it can declare any part.
export async function readPluginParts(plugin, problems) {
    if (!plugin.installPath)
        return undefined;
    const file = join(plugin.installPath, '.claude-plugin', 'plugin.json');
    const manifest = await readJson(file, problems);
    if (!isObject(manifest))
        return undefined;
    const unmeasured = [];
    for (const { part, path, keys } of UNMEASURED) {
        if (keys.some((key) => declares(manifest, key)) || (path && (await exists(join(plugin.installPath, path)))))
            unmeasured.push(part);
    }
    const dependencies = [];
    const declared = manifest.dependencies;
    if (declared !== undefined && !Array.isArray(declared))
        problems.push(`${file}: dependencies is not a list`);
    for (const entry of Array.isArray(declared) ? declared : []) {
        const id = dependencyId(entry, plugin.marketplace);
        if (id)
            dependencies.push(id);
        else
            problems.push(`${file}: a dependency is not valid`);
    }
    return { unmeasured, dependencies };
}
