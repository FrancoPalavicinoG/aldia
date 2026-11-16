import { cleanReport } from './clean.js';
import { inventoryReport } from './inventory.js';
import { resolveClaudePaths } from './paths.js';

// Entry point the /aldia skill runs: `node lib/cli.js status` or `clean`.
const [command] = process.argv.slice(2);
try {
  if (command === 'status') {
    // Claude Code runs the skill from the folder the session was opened in: that is the project.
    process.stdout.write(await inventoryReport(resolveClaudePaths(), process.cwd()));
  } else if (command === 'clean') {
    process.stdout.write(await cleanReport(resolveClaudePaths(), process.cwd()));
  } else {
    process.stderr.write('usage: node cli.js status | clean\n');
    process.exitCode = 2;
  }
} catch (error) {
  // What the error says can hold paths of this machine and text from files: only its
  // code is shown, and only when it looks like one.
  const code = (error as { code?: unknown } | undefined)?.code;
  const known = typeof code === 'string' && /^[A-Z][A-Z0-9_]{0,40}$/.test(code) ? ` (${code})` : '';
  process.stdout.write(`aldia could not finish: unexpected error${known}. Nothing was changed.\n`);
  process.exitCode = 1;
}
