import { readContextCost, serverKey, type ContextCost } from './cost.js';
import { readMcpServers, type McpServer, type McpSource } from './mcp.js';
import { projectAt, type ClaudePaths } from './paths.js';
import { readPlugins, type InstalledPlugin } from './plugins.js';
import { readSkills, type Skill, type SkillSource } from './skills.js';
import { readUsage, type Usage, type UseCount } from './usage.js';

export interface SetupData {
  plugins: InstalledPlugin[];
  skills: Skill[];
  servers: McpServer[];
  usage: Usage;
  cost: ContextCost;
}

export interface ItemUse {
  id: string;
  // Context added to every request (estimate).
  tokens: number;
  // Latest use in the history window, ISO; undefined when not used in it.
  lastUsed?: string;
}

export interface PluginUse extends ItemUse {
  plugin: InstalledPlugin;
  skills: ItemUse[];
}

export interface SetupUse {
  plugins: PluginUse[];
  // Skills that don't come with a plugin.
  skills: (ItemUse & { source: SkillSource })[];
  // Servers the user configured (user, project, local); plugin servers count in their plugin.
  mcpServers: (ItemUse & { source: McpSource })[];
  // claude.ai connectors: they come from the user's account, not from local config.
  connectors: ItemUse[];
}

const CONNECTOR_PREFIX = 'claude_ai_';

// The most recent of some ISO dates; undefined when there is none.
const latest = (dates: (string | undefined)[]): string | undefined =>
  dates.reduce<string | undefined>((max, d) => (d && (!max || d > max) ? d : max), undefined);
const lastUse = (...uses: (UseCount | undefined)[]) => latest(uses.map((use) => use?.lastUsed));

const withLastUsed = (item: { id: string; tokens: number }, lastUsed: string | undefined): ItemUse =>
  lastUsed ? { ...item, lastUsed } : item;

// Joins the inventory with usage and cost, which name things the way the session history
// does: a plugin skill as "plugin:skill" (as a Skill call or a /plugin:skill command), a
// plugin's server as plugin_<plugin>_<server>, a connector as claude_ai_<Name>. Anything
// else measured (servers the Claude app provides) is not the user's and is left out.
export function usageByItem({ plugins, skills, servers, usage, cost }: SetupData): SetupUse {
  const skillTokens = new Map(cost.skills.map((s) => [`${s.pluginId ?? s.source}/${s.name}`, s.tokens]));
  const mcpTokens = new Map(cost.mcpServers.map((s) => [s.name, s.tokens]));

  const skillUse = (skill: Skill, key: string): ItemUse =>
    withLastUsed(
      { id: skill.name, tokens: skillTokens.get(`${skill.pluginId ?? skill.source}/${skill.name}`) ?? 0 },
      lastUse(usage.skills[key], usage.commands[`/${key}`]),
    );
  const serverUse = (key: string) => ({ tokens: mcpTokens.get(key) ?? 0, lastUsed: lastUse(usage.mcpServers[key]) });

  const pluginUses = plugins.map((plugin): PluginUse => {
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
      .map((s) =>
        withLastUsed(
          { id: s.name.slice(CONNECTOR_PREFIX.length).replace(/_/g, ' '), tokens: s.tokens },
          lastUse(usage.mcpServers[s.name]),
        ),
      )
      .sort((a, b) => a.id.localeCompare(b.id)),
  };
}

export type CleanAction = 'disable-plugin' | 'skill-off' | 'disable-mcp' | 'disable-connector' | 'uninstall-plugin';

export interface Proposal {
  action: CleanAction;
  // Plugin id, "plugin:skill" or skill name, server name, connector name.
  target: string;
  // Saved on every request.
  tokens: number;
  lastUsed?: string;
  // Where a skill without a plugin comes from.
  origin?: SkillSource;
}

export interface CleanPlan {
  proposals: Proposal[];
  savings: number;
  // Too little to save: not worth a list.
  lean: boolean;
}

const DAY = 24 * 60 * 60 * 1000;
export const TURN_OFF_DAYS = 30;
export const REMOVE_DAYS = 90;
const LEAN_TOKENS = 500;

// Turning off is reversible at once, so it comes first: anything unused for 30 days is
// turned off; only a plugin already off and unused for 90 days is proposed for removal.
// Of a plugin that is used, only its unused skills are turned off. Connectors are turned
// off in Claude Code only: they belong to the claude.ai account.
export function cleanPlan(use: SetupUse, now: Date): CleanPlan {
  const cutoff = (days: number) => new Date(now.getTime() - days * DAY).toISOString();
  const unused = (item: ItemUse, days = TURN_OFF_DAYS) => !item.lastUsed || item.lastUsed < cutoff(days);
  const proposals: Proposal[] = [];
  const propose = (action: CleanAction, target: string, item: ItemUse, origin?: SkillSource) =>
    proposals.push({
      action,
      target,
      tokens: item.tokens,
      ...(item.lastUsed ? { lastUsed: item.lastUsed } : {}),
      ...(origin ? { origin } : {}),
    });

  for (const plugin of use.plugins) {
    if (!plugin.plugin.enabled) {
      if (unused(plugin, REMOVE_DAYS)) propose('uninstall-plugin', plugin.id, plugin);
    } else if (unused(plugin)) {
      propose('disable-plugin', plugin.id, plugin);
    } else {
      for (const skill of plugin.skills) {
        if (skill.tokens > 0 && unused(skill)) propose('skill-off', `${plugin.plugin.name}:${skill.id}`, skill);
      }
    }
  }
  for (const skill of use.skills) if (skill.tokens > 0 && unused(skill)) propose('skill-off', skill.id, skill, skill.source);
  // A server that loaded nothing in the last session (off, failing) has nothing to save.
  for (const server of use.mcpServers) if (server.tokens > 0 && unused(server)) propose('disable-mcp', server.id, server);
  for (const connector of use.connectors) {
    if (connector.tokens > 0 && unused(connector)) propose('disable-connector', connector.id, connector);
  }

  proposals.sort((a, b) => b.tokens - a.tokens || a.target.localeCompare(b.target));
  const savings = proposals.reduce((sum, p) => sum + p.tokens, 0);
  return { proposals, savings, lean: savings < LEAN_TOKENS };
}

// The report is markdown laid out to be read at a glance: the saving first, then one
// table per group with the biggest items and a count of the rest, so its size stays small
// whatever the setup. How it was measured goes last. The skill shows it as is.
const MAX_ROWS = 5;

// Where an item comes from, so the reader knows what saying yes touches.
const ORIGIN: Partial<Record<SkillSource, string>> = {
  personal: 'yours (~/.claude)',
  synced: 'claude.ai account',
  project: 'this repo',
};
const ACTION_ORIGIN: Partial<Record<CleanAction, string>> = {
  'disable-plugin': 'plugin',
  'disable-mcp': 'MCP server',
  'skill-off': 'plugin',
};

const day = (iso: string) => iso.slice(0, 10);
const thousands = (n: number) => n.toLocaleString('en-US');
const total = (proposals: Proposal[]) => proposals.reduce((sum, p) => sum + p.tokens, 0);
// Names come from local config: a "|" would break the table.
const cell = (text: string) => text.replace(/\|/g, '\\|');

function table(title: string, proposals: Proposal[]): string[] {
  if (!proposals.length) return [];
  const rows = proposals
    .slice(0, MAX_ROWS)
    .map((p) => `| ${cell(p.target)} | ${(p.origin && ORIGIN[p.origin]) || ACTION_ORIGIN[p.action] || ''} | ${thousands(p.tokens)} |`);
  const rest = proposals.slice(MAX_ROWS);
  if (rest.length) rows.push(`| and ${rest.length} more | | ~${thousands(total(rest))} |`);
  return [`${title} · ${proposals.length} items · ~${thousands(total(proposals))} tok`, '| Item | Origin | Tok |', '|---|---|---|', ...rows, ''];
}

// Few items with nothing else to say: names on one line.
function inline(title: string, proposals: Proposal[], tokens: boolean): string[] {
  if (!proposals.length) return [];
  const shown = proposals.slice(0, MAX_ROWS).map((p) => (tokens ? `${p.target} ${thousands(p.tokens)}` : p.target));
  if (proposals.length > MAX_ROWS) shown.push(`and ${proposals.length - MAX_ROWS} more`);
  return [title, shown.join(' · '), ''];
}

export interface CleanReportOptions {
  now?: Date;
}

// What /aldia clean shows: what to turn off or remove and what it saves. Nothing is
// changed. Skills of plugins that are off don't load, so they cost nothing.
export async function cleanReport(paths: ClaudePaths, root?: string, { now = new Date() }: CleanReportOptions = {}): Promise<string> {
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
  const lines = ['aldia clean · proposal only, nothing changed', ''];
  if (plan.lean) {
    lines.push(`Already lean: only ~${thousands(plan.savings)} tokens per request to save`);
  } else {
    const of = (...actions: CleanAction[]) => plan.proposals.filter((p) => actions.includes(p.action));
    const connectors = of('disable-connector');
    const mcpNote = cost.measuredAt ? ` MCP measured in the latest session (${day(cost.measuredAt)}), varies by where Claude Code runs.` : '';
    lines.push(
      `Possible saving: ~${thousands(plan.savings)} tokens per request`,
      '',
      ...table('Turn off', of('disable-plugin', 'skill-off', 'disable-mcp')),
      ...inline(`claude.ai connectors · turned off in Claude Code only · ~${thousands(total(connectors))} tok`, connectors, true),
      ...inline(`Uninstall · off and unused for ${REMOVE_DAYS} days`, of('uninstall-plugin'), false),
      `Rule: unused for ${TURN_OFF_DAYS} days → turn off; off and unused for ${REMOVE_DAYS} → uninstall.`,
      `Estimate (chars/4, skills before listing budget) over ${usage.sessions} sessions since ${day(usage.since)}.${mcpNote}`,
    );
  }
  if (problems.length) lines.push(`Problems: ${problems.slice(0, MAX_ROWS).join('; ')}`);
  const text = lines.join('\n') + '\n';
  return paths.home.length > 1 ? text.split(paths.home).join('~') : text;
}
