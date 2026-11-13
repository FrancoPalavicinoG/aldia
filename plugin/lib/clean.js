import { serverKey } from './cost.js';
const CONNECTOR_PREFIX = 'claude_ai_';
// The most recent of some ISO dates; undefined when there is none.
const latest = (dates) => dates.reduce((max, d) => (d && (!max || d > max) ? d : max), undefined);
const lastUse = (...uses) => latest(uses.map((use) => use?.lastUsed));
const withLastUsed = (item, lastUsed) => lastUsed ? { ...item, lastUsed } : item;
// Joins the inventory with usage and cost, which name things the way the session history
// does: a plugin skill as "plugin:skill" (as a Skill call or a /plugin:skill command), a
// plugin's server as plugin_<plugin>_<server>, a connector as claude_ai_<Name>. Anything
// else measured (servers the Claude app provides) is not the user's and is left out.
export function usageByItem({ plugins, skills, servers, usage, cost }) {
    const skillTokens = new Map(cost.skills.map((s) => [`${s.pluginId ?? s.source}/${s.name}`, s.tokens]));
    const mcpTokens = new Map(cost.mcpServers.map((s) => [s.name, s.tokens]));
    const skillUse = (skill, key) => withLastUsed({ id: skill.name, tokens: skillTokens.get(`${skill.pluginId ?? skill.source}/${skill.name}`) ?? 0 }, lastUse(usage.skills[key], usage.commands[`/${key}`]));
    const serverUse = (key) => ({ tokens: mcpTokens.get(key) ?? 0, lastUsed: lastUse(usage.mcpServers[key]) });
    const pluginUses = plugins.map((plugin) => {
        const own = skills.filter((s) => s.pluginId === plugin.id).map((s) => skillUse(s, `${plugin.name}:${s.name}`));
        const ownServers = servers
            .filter((s) => s.pluginId === plugin.id)
            .map((s) => serverUse(serverKey(`plugin_${plugin.name}_${s.name}`)));
        const all = [...own, ...ownServers];
        const tokens = all.reduce((sum, item) => sum + item.tokens, 0);
        return { ...withLastUsed({ id: plugin.id, tokens }, latest(all.map((item) => item.lastUsed))), plugin, skills: own };
    });
    return {
        plugins: pluginUses,
        skills: skills
            .filter((s) => !s.pluginId)
            .map((s) => ({ ...skillUse(s, s.name), source: s.source })),
        mcpServers: servers
            .filter((s) => !s.pluginId)
            .map((s) => {
            const { tokens, lastUsed } = serverUse(serverKey(s.name));
            return { ...withLastUsed({ id: s.name, tokens }, lastUsed), source: s.source };
        }),
        connectors: cost.mcpServers
            .filter((s) => s.name.startsWith(CONNECTOR_PREFIX))
            .map((s) => withLastUsed({ id: s.name.slice(CONNECTOR_PREFIX.length).replace(/_/g, ' '), tokens: s.tokens }, lastUse(usage.mcpServers[s.name])))
            .sort((a, b) => a.id.localeCompare(b.id)),
    };
}
const DAY = 24 * 60 * 60 * 1000;
export const TURN_OFF_DAYS = 30;
export const REMOVE_DAYS = 90;
const LEAN_TOKENS = 500;
// Turning off is reversible at once, so it comes first: anything unused for 30 days is
// turned off; only a plugin already off and unused for 90 days is proposed for removal.
// Of a plugin that is used, only its unused skills are turned off. Connectors are turned
// off in Claude Code only: they belong to the claude.ai account.
export function cleanPlan(use, now) {
    const cutoff = (days) => new Date(now.getTime() - days * DAY).toISOString();
    const unused = (item, days = TURN_OFF_DAYS) => !item.lastUsed || item.lastUsed < cutoff(days);
    const proposals = [];
    const propose = (action, target, item) => proposals.push({ action, target, tokens: item.tokens, ...(item.lastUsed ? { lastUsed: item.lastUsed } : {}) });
    for (const plugin of use.plugins) {
        if (!plugin.plugin.enabled) {
            if (unused(plugin, REMOVE_DAYS))
                propose('uninstall-plugin', plugin.id, plugin);
        }
        else if (unused(plugin)) {
            propose('disable-plugin', plugin.id, plugin);
        }
        else {
            for (const skill of plugin.skills) {
                if (skill.tokens > 0 && unused(skill))
                    propose('skill-off', `${plugin.plugin.name}:${skill.id}`, skill);
            }
        }
    }
    for (const skill of use.skills)
        if (skill.tokens > 0 && unused(skill))
            propose('skill-off', skill.id, skill);
    // A server that loaded nothing in the last session (off, failing) has nothing to save.
    for (const server of use.mcpServers)
        if (server.tokens > 0 && unused(server))
            propose('disable-mcp', server.id, server);
    for (const connector of use.connectors) {
        if (connector.tokens > 0 && unused(connector))
            propose('disable-connector', connector.id, connector);
    }
    proposals.sort((a, b) => b.tokens - a.tokens || a.target.localeCompare(b.target));
    const savings = proposals.reduce((sum, p) => sum + p.tokens, 0);
    return { proposals, savings, lean: savings < LEAN_TOKENS };
}
