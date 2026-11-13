// The listing caps description + when_to_use at this many characters per skill
// (https://code.claude.com/docs/en/skills).
const LISTING_CAP = 1536;
const tokens = (chars) => Math.ceil(chars / 4);
// What each item adds to the context of every session before the user types anything.
// A skill is listed by name with its description and when_to_use, unless only the user
// can invoke it.
export async function readContextCost(_paths, skills) {
    const costs = skills.map((skill) => {
        const text = [skill.description, skill.whenToUse].filter(Boolean).join(' ');
        const chars = skill.modelInvocable ? skill.name.length + 2 + Math.min(text.length, LISTING_CAP) : 0;
        return { name: skill.name, source: skill.source, ...(skill.pluginId ? { pluginId: skill.pluginId } : {}), chars, tokens: tokens(chars) };
    });
    return { skills: costs, problems: [] };
}
