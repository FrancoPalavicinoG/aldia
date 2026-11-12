import { readMcpServers } from './mcp.js';
import type { ClaudePaths } from './paths.js';
import { readPlugins } from './plugins.js';
import { readSkills, type Skill } from './skills.js';

function section(title: string, items: string[]): string[] {
  return [`## ${title}`, ...(items.length ? items : ['- none']), ''];
}

function skillGroups(skills: Skill[]): string[] {
  const groups = new Map<string, string[]>();
  for (const skill of skills) {
    const key =
      skill.source === 'plugin' ? `plugin ${skill.pluginId}` : skill.source === 'synced' ? 'synced from claude.ai' : 'personal';
    groups.set(key, [...(groups.get(key) ?? []), skill.name]);
  }
  return [...groups].map(([key, names]) => `- ${key} (${names.length}): ${names.join(', ')}`);
}

// A plain-text inventory of the setup, for Claude to read and present.
// Paths start at ~ so the user's home folder isn't spelled out.
export async function inventoryReport(paths: ClaudePaths): Promise<string> {
  const plugins = await readPlugins(paths);
  const skills = await readSkills(paths, plugins.plugins);
  const mcp = await readMcpServers(paths, plugins.plugins);
  const problems = [...plugins.problems, ...skills.problems, ...mcp.problems];

  const enabled = plugins.plugins.filter((p) => p.enabled).length;
  const pluginTitle = plugins.plugins.length
    ? `Plugins (${plugins.plugins.length}: ${enabled} enabled, ${plugins.plugins.length - enabled} disabled)`
    : 'Plugins (0)';

  const lines = [
    '# aldia inventory',
    '',
    ...section(
      pluginTitle,
      plugins.plugins.map((p) => `- ${p.id} ${p.version} (${p.enabled ? 'enabled' : 'disabled'})`),
    ),
    ...section(`Skills (${skills.skills.length})`, skillGroups(skills.skills)),
    ...section(
      `MCP servers (${mcp.servers.length})`,
      mcp.servers.map((s) => `- ${s.name}: ${s.transport}, ${s.target} (${s.pluginId ? `plugin ${s.pluginId}` : s.source})`),
    ),
    ...section(`Problems (${problems.length})`, problems.map((p) => `- ${p}`)),
  ];
  const text = lines.join('\n');
  return paths.home.length > 1 ? text.split(paths.home).join('~') : text;
}
