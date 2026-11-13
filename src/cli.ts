import { inventoryReport } from './inventory.js';
import { resolveClaudePaths } from './paths.js';

// Entry point the /aldia skill runs: `node lib/cli.js status`.
const [command] = process.argv.slice(2);
if (command === 'status') {
  // Claude Code runs the skill from the folder the session was opened in: that is the project.
  process.stdout.write(await inventoryReport(resolveClaudePaths(), process.cwd()));
} else {
  process.stderr.write('usage: node cli.js status\n');
  process.exitCode = 2;
}
