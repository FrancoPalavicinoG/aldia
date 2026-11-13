import { readContextCost, serverKey } from './cost.js';
import { readMcpServers } from './mcp.js';
import { projectAt } from './paths.js';
import { readPlugins } from './plugins.js';
import { readSkills } from './skills.js';
import { readUsage } from './usage.js';
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
    const propose = (action, target, item, origin) => proposals.push({
        action,
        target,
        tokens: item.tokens,
        ...(item.lastUsed ? { lastUsed: item.lastUsed } : {}),
        ...(origin ? { origin } : {}),
    });
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
            propose('skill-off', skill.id, skill, skill.source);
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
// The report keeps to a fixed size whatever the setup: it is read into the context too.
const MAX_LINES = 8;
const LABEL = {
    'disable-plugin': 'plugin',
    'skill-off': 'skill',
    'disable-mcp': 'MCP server',
    'disable-connector': 'connector',
    'uninstall-plugin': 'plugin',
};
const ORIGIN = {
    personal: 'personal',
    synced: 'synced from claude.ai',
    project: 'project',
};
const day = (iso) => iso.slice(0, 10);
const thousands = (n) => n.toLocaleString('en-US');
function proposalLines(title, proposals) {
    if (!proposals.length)
        return [];
    const total = proposals.reduce((sum, p) => sum + p.tokens, 0);
    const shown = proposals.slice(0, MAX_LINES).map((p) => {
        const when = p.lastUsed ? `last used ${day(p.lastUsed)}` : `not used in ${REMOVE_DAYS} days`;
        const origin = p.origin && ORIGIN[p.origin] ? ` (${ORIGIN[p.origin]})` : '';
        return `- ${LABEL[p.action]} ${p.target}${origin}: ~${thousands(p.tokens)} tokens, ${when}`;
    });
    const rest = proposals.slice(MAX_LINES);
    if (rest.length) {
        const restTokens = rest.reduce((sum, p) => sum + p.tokens, 0);
        shown.push(`- ...and ${rest.length} more (~${thousands(restTokens)} tokens)`);
    }
    return [`## ${title} (${proposals.length}, ~${thousands(total)} tokens)`, ...shown, ''];
}
// What /aldia clean shows: what to turn off or remove and what it saves. Nothing is
// changed. Skills of plugins that are off don't load, so they cost nothing.
export async function cleanReport(paths, root, { now = new Date() } = {}) {
    const project = projectAt(paths, root);
    const plugins = await readPlugins(paths, project);
    const skills = await readSkills(paths, plugins.plugins, project);
    const mcp = await readMcpServers(paths, plugins.plugins, project);
    const usage = await readUsage(paths, { now, days: REMOVE_DAYS });
    const enabled = new Set(plugins.plugins.filter((p) => p.enabled).map((p) => p.id));
    const loaded = skills.skills.filter((s) => !s.pluginId || enabled.has(s.pluginId));
    const cost = await readContextCost(paths, loaded);
    const problems = [...plugins.problems, ...skills.problems, ...mcp.problems, ...usage.problems, ...cost.problems];
    const plan = cleanPlan(usageByItem({ plugins: plugins.plugins, skills: skills.skills, servers: mcp.servers, usage, cost }), now);
    const lines = ['# aldia clean (dry run: nothing was changed)', ''];
    if (plan.lean) {
        lines.push(`Your setup is already lean: turning off what you haven't used in ${TURN_OFF_DAYS} days would save only ~${thousands(plan.savings)} tokens per request.`);
    }
    else {
        const of = (...actions) => plan.proposals.filter((p) => actions.includes(p.action));
        const measured = cost.measuredAt ? `; MCP sizes from the session of ${day(cost.measuredAt)}` : '';
        lines.push(`Turning off what you haven't used in ${TURN_OFF_DAYS} days would save ~${thousands(plan.savings)} tokens on every request.`, `Estimate: tokens ~ characters / 4, skill text before Claude Code's listing budget. Usage from ${usage.sessions} sessions since ${day(usage.since)}${measured}.`, '', ...proposalLines('Turn off', of('disable-plugin', 'skill-off', 'disable-mcp')), ...proposalLines('claude.ai connectors: turn off in Claude Code only, they stay in your account', of('disable-connector')), ...proposalLines(`Uninstall: already off and unused for ${REMOVE_DAYS} days`, of('uninstall-plugin')));
    }
    if (problems.length)
        lines.push('', `## Problems (${problems.length})`, ...problems.slice(0, MAX_LINES).map((p) => `- ${p}`));
    const text = lines.join('\n');
    return paths.home.length > 1 ? text.split(paths.home).join('~') : text;
}
