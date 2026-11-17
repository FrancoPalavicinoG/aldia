import { isObject, readJson, textField } from './json.js';
import { INVALID_NAME, INVALID_VERSION, validName, validVersion } from './text.js';
function splitId(id) {
    const at = id.lastIndexOf('@');
    return at > 0 ? { name: id.slice(0, at), marketplace: id.slice(at + 1) } : { name: id, marketplace: '' };
}
// name@marketplace, each part a plain name.
function validId(id) {
    const { name, marketplace } = splitId(id);
    return validName(name) && validName(marketplace);
}
// With a project, `enabled` is the value in effect there: the project's shared settings
// override the user's, and its local settings override both, plugin by plugin.
export async function readPlugins(paths, project) {
    const problems = [];
    const file = paths.installedPlugins;
    const installed = await readJson(file, problems);
    const layers = project ? [paths.settings, project.settings, project.localSettings] : [paths.settings];
    // Only true and false count; any other value is not a setting.
    const enabled = {};
    for (const layer of layers) {
        const settings = await readJson(layer, problems);
        const map = isObject(settings) && isObject(settings.enabledPlugins) ? settings.enabledPlugins : {};
        for (const [id, on] of Object.entries(map))
            if (typeof on === 'boolean')
                enabled[id] = on;
    }
    const plugins = [];
    const all = isObject(installed) ? installed.plugins : undefined;
    if (all !== undefined && !isObject(all))
        problems.push(`${file}: plugins is not an object`);
    for (const [key, records] of Object.entries(isObject(all) ? all : {})) {
        const valid = validId(key);
        if (!valid)
            problems.push(`${file}: plugin id is not valid, shown as ${INVALID_NAME}`);
        const id = valid ? key : INVALID_NAME;
        if (!Array.isArray(records)) {
            problems.push(`${file}: ${id}: install records are not a list`);
            continue;
        }
        for (const record of records) {
            if (!isObject(record)) {
                problems.push(`${file}: ${id}: an install record is not an object`);
                continue;
            }
            const where = `${file}: ${id}`;
            let version = textField(record, 'version', where, problems) ?? 'unknown';
            if (!validVersion(version)) {
                problems.push(`${where}: version is not valid`);
                version = INVALID_VERSION;
            }
            plugins.push({
                id,
                ...(valid ? splitId(id) : { name: INVALID_NAME, marketplace: INVALID_NAME }),
                version,
                scope: textField(record, 'scope', where, problems) ?? 'user',
                enabled: valid && enabled[id] === true,
                installPath: textField(record, 'installPath', where, problems) ?? '',
            });
        }
    }
    plugins.sort((a, b) => a.id.localeCompare(b.id));
    return { plugins, problems };
}
