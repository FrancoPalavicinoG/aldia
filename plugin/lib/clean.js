import { readContextCost, serverKey } from './cost.js';
import { readMcpServers } from './mcp.js';
import { projectAt } from './paths.js';
import { readPluginParts } from './components.js';
import { readPlugins } from './plugins.js';
import { readSkills } from './skills.js';
import { INVALID_NAME, line, oneLine, validName } from './text.js';
import { readUsage } from './usage.js';
const CONNECTOR_PREFIX = 'claude_ai_';
// The most recent of some ISO dates; undefined when there is none.
const latest = (dates) => dates.reduce((max, d) => (d && (!max || d > max) ? d : max), undefined);
const lastUse = (...uses) => latest(uses.map((use) => use?.lastUsed));
// Uses whose name starts with a prefix: everything of a plugin, whatever its parts are called.
const usesStarting = (uses, prefix) => Object.entries(uses).filter(([name]) => name.startsWith(prefix)).map(([, use]) => use);
const withLastUsed = (item, lastUsed) => lastUsed ? { ...item, lastUsed } : item;
// One entry per plugin: installed in two scopes, it is still one plugin to turn off. It
// counts as installed since the first of its installs.
export function uniquePlugins(plugins) {
    const byId = new Map();
    for (const plugin of plugins) {
        const seen = byId.get(plugin.id);
        if (!seen)
            byId.set(plugin.id, plugin);
        else if (plugin.installedAt && (!seen.installedAt || plugin.installedAt < seen.installedAt)) {
            byId.set(plugin.id, { ...seen, installedAt: plugin.installedAt });
        }
    }
    return [...byId.values()];
}
// Joins the inventory with usage and cost, which name things the way the session history
// does: a plugin skill or command as "plugin:name" (as a Skill call or a /plugin:name
// command), a plugin agent as "plugin:agent", a plugin's server as plugin_<plugin>_<server>,
// a connector as claude_ai_<Name>. Anything else measured (servers the Claude app
// provides) is not the user's and is left out.
export function usageByItem({ plugins, parts, skills, servers, usage, cost }) {
    const skillTokens = new Map(cost.skills.map((s) => [`${s.pluginId ?? s.source}/${s.name}`, s.tokens]));
    const mcpTokens = new Map(cost.mcpServers.map((s) => [s.name, s.tokens]));
    const skillUse = (skill, key) => withLastUsed({ id: skill.name, tokens: skillTokens.get(`${skill.pluginId ?? skill.source}/${skill.name}`) ?? 0 }, lastUse(usage.skills[key], usage.commands[`/${key}`]));
    const serverUse = (key) => ({ tokens: mcpTokens.get(key) ?? 0, lastUsed: lastUse(usage.mcpServers[key]) });
    const unique = uniquePlugins(plugins);
    const on = unique.filter((p) => p.enabled || p.userSetting === true || p.repoSetting === true);
    const pluginUses = unique.map((plugin) => {
        const own = skills.filter((s) => s.pluginId === plugin.id).map((s) => skillUse(s, `${plugin.name}:${s.name}`));
        const ownServers = servers
            .filter((s) => s.pluginId === plugin.id)
            .map((s) => serverUse(serverKey(`plugin_${plugin.name}_${s.name}`)));
        const tokens = [...own, ...ownServers].reduce((sum, item) => sum + item.tokens, 0);
        const lastUsed = latest([
            ...[...own, ...ownServers].map((item) => item.lastUsed),
            lastUse(...usesStarting(usage.skills, `${plugin.name}:`), ...usesStarting(usage.commands, `/${plugin.name}:`), ...usesStarting(usage.agents ?? {}, `${plugin.name}:`), ...usesStarting(usage.mcpServers, serverKey(`plugin_${plugin.name}_`))),
        ]);
        const neededBy = on.filter((other) => parts?.get(other.id)?.dependencies.includes(plugin.id)).map((other) => other.id);
        const pluginParts = parts?.get(plugin.id);
        return {
            ...withLastUsed({ id: plugin.id, tokens }, lastUsed),
            plugin,
            skills: own,
            ...(pluginParts ? { parts: pluginParts } : {}),
            ...(neededBy.length ? { neededBy } : {}),
        };
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
            .map((s) => withLastUsed({ id: validName(s.name) ? s.name.slice(CONNECTOR_PREFIX.length).replace(/_/g, ' ') : INVALID_NAME, tokens: s.tokens }, lastUse(usage.mcpServers[s.name])))
            .sort((a, b) => a.id.localeCompare(b.id)),
        ...(usage.historyFrom ? { historyFrom: usage.historyFrom } : {}),
    };
}
const DAY = 24 * 60 * 60 * 1000;
export const TURN_OFF_DAYS = 30;
// Claude Code deletes sessions after 30 days by default, so the history rarely covers the
// whole window: three weeks is the least that tells "unused" apart from "not used lately".
export const MIN_HISTORY_DAYS = 21;
export const REMOVE_DAYS = 90;
const LEAN_TOKENS = 500;
const daysSince = (iso, now) => (iso ? Math.max(0, Math.floor((now.getTime() - Date.parse(iso)) / DAY)) : 0);
// Why a plugin that looks unused can't be proposed; undefined when it can.
function whyNot(plugin, now) {
    if (plugin.plugin.repoSetting === true)
        return 'turned on by this repo';
    if (plugin.plugin.userSetting !== true)
        return 'not set in ~/.claude/settings.json';
    if (!plugin.parts)
        return 'its parts could not be read';
    if (plugin.parts.unmeasured.length)
        return `has ${plugin.parts.unmeasured.join(', ')}`;
    if (plugin.neededBy)
        return `needed by ${plugin.neededBy.join(', ')}`;
    const installed = daysSince(plugin.plugin.installedAt, now);
    if (!plugin.plugin.installedAt || installed < MIN_HISTORY_DAYS)
        return plugin.plugin.installedAt ? `installed ${installed} days ago` : 'install date unknown';
    return undefined;
}
// A plugin is proposed only when every part of it can be measured, the user turned it on,
// nothing that is on needs it, and the history covers long enough to say it went unused.
// Anything else that looks unused is listed with the reason. Skills, MCP servers and
// connectors are shown with how to turn them off by hand; removing a plugin, only when the
// history covers 90 days.
export function cleanPlan(use, now) {
    const cutoff = (days) => new Date(now.getTime() - days * DAY).toISOString();
    const unused = (item, days = TURN_OFF_DAYS) => !item.lastUsed || item.lastUsed < cutoff(days);
    const historyDays = Math.min(daysSince(use.historyFrom, now), REMOVE_DAYS);
    const shortHistory = historyDays < MIN_HISTORY_DAYS;
    const proposals = [];
    const byHand = [];
    const skipped = [];
    // Something shown as INVALID_NAME can't be told apart or named in a command: never proposed.
    const add = (list, action, target, item, origin) => !target.includes(INVALID_NAME) &&
        list.push({
            action,
            target,
            tokens: item.tokens,
            ...(item.lastUsed ? { lastUsed: item.lastUsed } : {}),
            ...(origin ? { origin } : {}),
        });
    if (!shortHistory) {
        for (const plugin of use.plugins) {
            const off = plugin.plugin.userSetting === false && plugin.plugin.repoSetting !== true;
            if (off) {
                if (historyDays >= REMOVE_DAYS && unused(plugin, REMOVE_DAYS))
                    add(byHand, 'uninstall-plugin', plugin.id, plugin);
            }
            else if (unused(plugin)) {
                if (plugin.tokens === 0)
                    continue;
                const reason = whyNot(plugin, now);
                if (!reason)
                    add(proposals, 'disable-plugin', plugin.id, plugin);
                else if (!plugin.id.includes(INVALID_NAME))
                    skipped.push({ target: plugin.id, reason });
            }
            else {
                for (const skill of plugin.skills) {
                    if (skill.tokens > 0 && unused(skill))
                        add(byHand, 'skill-off', `${plugin.plugin.name}:${skill.id}`, skill);
                }
            }
        }
        for (const skill of use.skills)
            if (skill.tokens > 0 && unused(skill))
                add(byHand, 'skill-off', skill.id, skill, skill.source);
        // A server that loaded nothing in the last session (off, failing) has nothing to save.
        for (const server of use.mcpServers)
            if (server.tokens > 0 && unused(server))
                add(byHand, 'disable-mcp', server.id, server);
        for (const connector of use.connectors) {
            if (connector.tokens > 0 && unused(connector))
                add(byHand, 'disable-connector', connector.id, connector);
        }
    }
    const order = (a, b) => b.tokens - a.tokens || a.target.localeCompare(b.target);
    proposals.sort(order);
    byHand.sort(order);
    skipped.sort((a, b) => a.target.localeCompare(b.target));
    const savings = [...proposals, ...byHand].reduce((sum, p) => sum + p.tokens, 0);
    return { proposals, byHand, skipped, historyDays, shortHistory, savings, lean: savings < LEAN_TOKENS };
}
// The report is markdown laid out to be read at a glance: the saving first, then one
// table per group with the biggest items and a count of the rest, so its size stays small
// whatever the setup. How it was measured goes last. The skill shows it as is.
const MAX_ROWS = 5;
// Where an item comes from, so the reader knows what saying yes touches.
const ORIGIN = {
    personal: 'yours (~/.claude)',
    synced: 'claude.ai account',
    project: 'this repo',
};
const ACTION_ORIGIN = {
    'disable-plugin': 'plugin',
    'disable-mcp': 'MCP server',
    'skill-off': 'plugin',
};
const day = (iso) => iso.slice(0, 10);
const thousands = (n) => n.toLocaleString('en-US');
const total = (proposals) => proposals.reduce((sum, p) => sum + p.tokens, 0);
// Names come from local config: a line break or a "|" would break the table.
const cell = (text) => oneLine(text).replace(/\|/g, '\\|');
function table(title, proposals) {
    if (!proposals.length)
        return [];
    const rows = proposals
        .slice(0, MAX_ROWS)
        .map((p) => `| ${cell(p.target)} | ${(p.origin && ORIGIN[p.origin]) || ACTION_ORIGIN[p.action] || ''} | ${thousands(p.tokens)} |`);
    const rest = proposals.slice(MAX_ROWS);
    if (rest.length)
        rows.push(`| and ${rest.length} more | | ~${thousands(total(rest))} |`);
    return [`${title} · ${proposals.length} items · ~${thousands(total(proposals))} tok`, '| Item | Origin | Tok |', '|---|---|---|', ...rows, ''];
}
// Few items with nothing else to say: names on one line.
function inline(title, proposals, tokens) {
    if (!proposals.length)
        return [];
    const shown = proposals.slice(0, MAX_ROWS).map((p) => (tokens ? line `${p.target} ${thousands(p.tokens)}` : oneLine(p.target)));
    if (proposals.length > MAX_ROWS)
        shown.push(`and ${proposals.length - MAX_ROWS} more`);
    return [title, shown.join(' · '), ''];
}
function skippedLine(skipped) {
    if (!skipped.length)
        return [];
    const shown = skipped.slice(0, MAX_ROWS).map((s) => line `${s.target} (${s.reason})`);
    if (skipped.length > MAX_ROWS)
        shown.push(`and ${skipped.length - MAX_ROWS} more`);
    return ['Not proposed · may be unused, but aldia cannot tell or must not touch it', shown.join(' · '), ''];
}
// What /aldia clean shows: the plugins to turn off and what it saves, what to turn off by
// hand, and what may be unused but isn't proposed. Nothing is changed. Skills of plugins
// that are off don't load, so they cost nothing.
export async function cleanReport(paths, root, { now = new Date() } = {}) {
    const project = projectAt(paths, root);
    const plugins = await readPlugins(paths, project);
    const unique = uniquePlugins(plugins.plugins);
    const skills = await readSkills(paths, unique, project);
    const mcp = await readMcpServers(paths, unique, project);
    const usage = await readUsage(paths, { now, days: REMOVE_DAYS });
    const partProblems = [];
    const parts = new Map();
    for (const plugin of unique)
        parts.set(plugin.id, await readPluginParts(plugin, partProblems));
    // A plugin with no setting anywhere may be on (the docs) or off (the CLI): it is counted.
    const loads = new Set(unique.filter((p) => p.enabled || (p.userSetting === undefined && p.repoSetting === undefined)).map((p) => p.id));
    const loaded = skills.skills.filter((s) => !s.pluginId || loads.has(s.pluginId));
    const cost = await readContextCost(paths, loaded);
    const problems = [...plugins.problems, ...skills.problems, ...mcp.problems, ...partProblems, ...usage.problems, ...cost.problems];
    const plan = cleanPlan(usageByItem({ plugins: unique, parts, skills: skills.skills, servers: mcp.servers, usage, cost }), now);
    const lines = ['aldia clean · proposal only, nothing changed', ''];
    const history = `${usage.sessions} sessions covering ${plan.historyDays} days`;
    if (plan.shortHistory) {
        lines.push(`Not enough history to tell what is unused: ${plan.historyDays} days (needs ${MIN_HISTORY_DAYS}).`);
    }
    else if (plan.lean) {
        lines.push(`Already lean: only ~${thousands(plan.savings)} tokens per request to save`, '', ...skippedLine(plan.skipped));
    }
    else {
        const of = (...actions) => plan.byHand.filter((p) => actions.includes(p.action));
        const connectors = of('disable-connector');
        const mcpNote = cost.measuredAt ? ` MCP measured in the latest session (${day(cost.measuredAt)}), varies by where Claude Code runs.` : '';
        const byHand = table('By hand · aldia does not change these', of('skill-off', 'disable-mcp'));
        lines.push(`Possible saving: ~${thousands(plan.savings)} tokens per request`, '', ...table('Turn off', plan.proposals), ...(byHand.length ? [...byHand.slice(0, -1), 'How: skills in /skills, MCP servers in /mcp.', ''] : []), ...inline(`claude.ai connectors · turn off in /mcp, Claude Code only · ~${thousands(total(connectors))} tok`, connectors, true), ...inline(`Uninstall by hand · off and unused for ${REMOVE_DAYS} days · claude plugin uninstall <id> --keep-data`, of('uninstall-plugin'), false), ...skippedLine(plan.skipped), `Rule: a plugin unused for ${TURN_OFF_DAYS} days is turned off, only if aldia can measure all of it.`, `Estimate (chars/4, skills before listing budget) over ${history}.${mcpNote}`);
    }
    if (problems.length)
        lines.push(line `Problems: ${problems.slice(0, MAX_ROWS).join('; ')}`);
    const text = lines.join('\n') + '\n';
    return paths.home.length > 1 ? text.split(paths.home).join('~') : text;
}
