// Changes to plugins and MCP servers go through Claude Code's own CLI, which knows its
// files (installed_plugins.json, the plugin cache, ~/.claude.json). Only the operations
// listed here can run, each built from a fixed list of arguments.
const SCOPES = new Set(['user', 'local']);
// Starts with a letter or digit, so it can never pass as an option ("-s", "--scope").
const NAME = '[A-Za-z0-9][A-Za-z0-9._-]*';
const PLUGIN_ID = new RegExp(`^${NAME}@${NAME}$`);
const SERVER = new RegExp(`^${NAME}$`);
function check(ok, what) {
    if (!ok)
        throw new Error(`refused: ${what}`);
}
export function commandFor(op) {
    check(SCOPES.has(op.scope), `scope must be user or local, not ${JSON.stringify(op.scope)}`);
    switch (op.kind) {
        case 'disable-plugin':
        case 'uninstall-plugin':
            check(PLUGIN_ID.test(op.plugin), `not a plugin id (name@marketplace): ${JSON.stringify(op.plugin)}`);
            return ['plugin', op.kind === 'disable-plugin' ? 'disable' : 'uninstall', op.plugin, '--scope', op.scope, '--json'];
        case 'remove-mcp':
            check(SERVER.test(op.server), `not an MCP server name: ${JSON.stringify(op.server)}`);
            return ['mcp', 'remove', op.server, '--scope', op.scope];
    }
}
