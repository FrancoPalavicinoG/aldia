---
name: aldia
description: Show this machine's Claude Code setup (plugins, skills, MCP servers) as aldia sees it.
disable-model-invocation: true
allowed-tools:
  - Bash(node ${CLAUDE_PLUGIN_ROOT}/lib/cli.js status)
---

# aldia

This is the user's Claude Code setup, read from their config files just now:

!`node ${CLAUDE_PLUGIN_ROOT}/lib/cli.js status`

Present it to the user in their language, briefly:

- Start with one line of totals: plugins (enabled and disabled), skills, MCP servers.
- Then each section as a short list. For skills, show the groups with their counts; list names only for groups of 5 or fewer.
- Point out disabled plugins and any problems, and say which file a problem is in.
- Don't recommend installing, removing or changing anything: this version of aldia only shows the setup.
