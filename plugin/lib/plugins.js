import { readJson } from './json.js';
function splitId(id) {
    const at = id.lastIndexOf('@');
    return at > 0 ? { name: id.slice(0, at), marketplace: id.slice(at + 1) } : { name: id, marketplace: '' };
}
export async function readPlugins(paths) {
    const problems = [];
    const installed = (await readJson(paths.installedPlugins, problems));
    const settings = (await readJson(paths.settings, problems));
    const enabled = settings?.enabledPlugins ?? {};
    const plugins = [];
    for (const [id, records] of Object.entries(installed?.plugins ?? {})) {
        for (const record of records) {
            plugins.push({
                id,
                ...splitId(id),
                version: record.version ?? 'unknown',
                scope: record.scope ?? 'user',
                enabled: enabled[id] === true,
                installPath: record.installPath ?? '',
            });
        }
    }
    plugins.sort((a, b) => a.id.localeCompare(b.id));
    return { plugins, problems };
}
