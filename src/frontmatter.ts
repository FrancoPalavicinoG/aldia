// Reads the top-level scalar keys of a YAML frontmatter block (the part between the
// first two `---` lines). Enough for SKILL.md fields like name and description;
// lists and nested keys are skipped.
export function parseFrontmatter(text: string): Record<string, string> | null {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  if (lines[0]?.trim() !== '---') return null;
  const end = lines.indexOf('---', 1);
  if (end < 0) return null;

  const body = lines.slice(1, end);
  const result: Record<string, string> = {};
  let i = 0;
  while (i < body.length) {
    const match = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(body[i]!);
    i++;
    if (!match) continue;
    const key = match[1]!;
    const raw = match[2]!.trim();

    const continuation: string[] = [];
    while (i < body.length && (body[i]!.startsWith(' ') || body[i]!.startsWith('\t') || body[i]!.trim() === '')) {
      continuation.push(body[i]!.trim());
      i++;
    }

    if (raw === '') continue; // a list or nested mapping follows
    if (raw.startsWith('>') || raw.startsWith('|')) {
      const kept = continuation.join('\n').trim().split('\n');
      result[key] = raw.startsWith('>') ? kept.join(' ').replace(/ {2,}/g, ' ') : kept.join('\n');
    } else if (/^(["']).*\1$/.test(raw)) {
      result[key] = raw.slice(1, -1);
    } else {
      result[key] = [raw, ...continuation.filter(Boolean)].join(' ');
    }
  }
  return result;
}
