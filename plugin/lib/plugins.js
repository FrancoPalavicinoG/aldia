import { isObject, readJson, textField } from './json.js';
import { INVALID_NAME, INVALID_VERSION, validDate, validName, validVersion } from './text.js';
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
    // Only true and false count; any other value is not a setting. Maps: an id like
    // "__proto__" stays a plain key.
    const readLayer = async (file, into) => {
        const settings = await readJson(file, problems);
        const map = isObject(settings) && isObject(settings.enabledPlugins) ? settings.enabledPlugins : {};
        for (const [id, on] of Object.entries(map))
            if (typeof on === 'boolean')
                into.set(id, on);
    };
    const user = new Map();
    const repo = new Map();
    await readLayer(paths.settings, user);
    if (project)
        for (const file of [project.settings, project.localSettings])
            await readLayer(file, repo);
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
            const userSetting = valid ? user.get(id) : undefined;
            const repoSetting = valid ? repo.get(id) : undefined;
            plugins.push({
                id,
                ...(valid ? splitId(id) : { name: INVALID_NAME, marketplace: INVALID_NAME }),
                version,
                scope: textField(record, 'scope', where, problems) ?? 'user',
                enabled: (repoSetting ?? userSetting) === true,
                ...(userSetting !== undefined ? { userSetting } : {}),
                ...(repoSetting !== undefined ? { repoSetting } : {}),
                installPath: textField(record, 'installPath', where, problems) ?? '',
                ...(validDate(record.installedAt) ? { installedAt: record.installedAt } : {}),
            });
        }
    }
    plugins.sort((a, b) => a.id.localeCompare(b.id));
    return { plugins, problems };
}
