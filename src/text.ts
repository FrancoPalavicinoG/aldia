// Text read from files (names, versions, paths, commit subjects) can say anything, and the
// reports built from it are read by the model. Every value put into a report goes through
// here, so it stays on its own line and shows exactly what a person would see.

const ESCAPE = /\x1b\[[0-9;?]*[ -\/]*[@-~]/g;
// Line and paragraph breaks of any kind, and tabs; a run of them (\r\n) is one space.
const BREAKS = /[\t\n\v\f\r\u{0085}\u{2028}\u{2029}]+/gu;
// What a reader would not see: controls, format characters (zero-width, bidi, tags),
// private use, lone surrogates and variation selectors.
const HIDDEN = /[\p{Cc}\p{Cf}\p{Co}\p{Cs}\u{fe00}-\u{fe0f}\u{e0100}-\u{e01ef}]/gu;

const MAX_TEXT = 100;

export function oneLine(text: string): string {
  return text.replace(ESCAPE, '').replace(BREAKS, ' ').replace(HIDDEN, '');
}

// Free text from the repo is also capped, by whole characters.
export function short(text: string, max = MAX_TEXT): string {
  const chars = [...oneLine(text)];
  return chars.length > max ? `${chars.slice(0, max).join('')}...` : chars.join('');
}

// A report line: its own text as written, each value flattened with oneLine.
export function line(parts: TemplateStringsArray, ...values: unknown[]): string {
  return parts.reduce((text, part, i) => text + oneLine(String(values[i - 1])) + part);
}
