import { readJson } from './json.js';
function splitId(id) {
    const at = id.lastIndexOf('@');
    return at > 0 ? { name: id.slice(0, at), marketplace: id.slice(at + 1) } : { name: id, marketplace: '' };
}
// With a project, `enabled` is the value in effect there: the project's shared settings
// override the user's, and its local settings override both, plugin by plugin.
export async function readPlugins(paths, project) {
    const problems = [];
    const installed = (await readJson(paths.installedPlugins, problems));
    const layers = project ? [paths.settings, project.settings, project.localSettings] : [paths.settings];
    const enabled = {};
    for (const file of layers)
        Object.assign(enabled, (await readJson(file, problems))?.enabledPlugins);
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
