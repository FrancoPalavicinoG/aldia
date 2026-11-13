import { serverKey, type ContextCost } from './cost.js';
import type { McpServer, McpSource } from './mcp.js';
import type { InstalledPlugin } from './plugins.js';
import type { Skill, SkillSource } from './skills.js';
import type { Usage, UseCount } from './usage.js';

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
