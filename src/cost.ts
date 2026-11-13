import type { ClaudePaths } from './paths.js';
import type { Skill, SkillSource } from './skills.js';

// The listing caps description + when_to_use at this many characters per skill
// (https://code.claude.com/docs/en/skills).
const LISTING_CAP = 1536;

export interface SkillCost {
  name: string;
  source: SkillSource;
  pluginId?: string;
  // Characters this skill adds to the context on every turn.
  chars: number;
  // Rough estimate: chars / 4.
  tokens: number;
}

export interface ContextCost {
  skills: SkillCost[];
  problems: string[];
}

const tokens = (chars: number) => Math.ceil(chars / 4);

// What each item adds to the context of every session before the user types anything.
// A skill is listed by name with its description and when_to_use, unless only the user
// can invoke it.
export async function readContextCost(_paths: ClaudePaths, skills: Skill[]): Promise<ContextCost> {
  const costs = skills.map((skill): SkillCost => {
    const text = [skill.description, skill.whenToUse].filter(Boolean).join(' ');
    const chars = skill.modelInvocable ? skill.name.length + 2 + Math.min(text.length, LISTING_CAP) : 0;
    return { name: skill.name, source: skill.source, ...(skill.pluginId ? { pluginId: skill.pluginId } : {}), chars, tokens: tokens(chars) };
  });
  return { skills: costs, problems: [] };
}
