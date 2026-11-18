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
export function oneLine(text) {
    return text.replace(ESCAPE, '').replace(BREAKS, ' ').replace(HIDDEN, '');
}
// Free text from the repo is also capped, by whole characters.
export function short(text, max = MAX_TEXT) {
    const chars = [...oneLine(text)];
    return chars.length > max ? `${chars.slice(0, max).join('')}...` : chars.join('');
}
// A report line: its own text as written, each value flattened with oneLine.
export function line(parts, ...values) {
    return parts.reduce((text, part, i) => text + oneLine(String(values[i - 1])) + part);
}
// A name (skill, MCP server, plugin, marketplace): starts with a letter or digit, so it
// can never pass as an option ("-s"), and holds no space or markup. One that doesn't fit
// is shown as INVALID_NAME, and nothing is ever proposed for it.
export const NAME = '[A-Za-z0-9][A-Za-z0-9._-]{0,63}';
const PLAIN_NAME = new RegExp(`^${NAME}$`);
const PLAIN_VERSION = /^[A-Za-z0-9][A-Za-z0-9.+_-]{0,63}$/;
export const INVALID_NAME = '(invalid name)';
export const INVALID_VERSION = '(invalid version)';
export const validName = (text) => PLAIN_NAME.test(text);
export const validVersion = (text) => PLAIN_VERSION.test(text);
// An ISO date as Claude Code writes it. Any other text would compare as older than every date.
const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
export const validDate = (text) => typeof text === 'string' && ISO_DATE.test(text);
