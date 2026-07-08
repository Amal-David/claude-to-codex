# Token Efficiency

Claude to Codex tries to save useful context without moving the entire Claude conversation into the Codex prompt.

## Defaults

- digest tail: 28 recent text turns and tool uses
- full transcript: referenced by file path, not pasted
- subagents: off by default
- model invocation inside Claude command: disabled

## Why this works

The most recent turns usually contain the current plan, blockers, and last verified state. Older context remains available in the transcript, but Codex only reads it when necessary.

## When to increase the tail

Use a larger tail when the session has many short messages after the last meaningful plan:

```bash
node ~/.claude/skills/claude-to-codex/scripts/claude-to-codex.mjs --tail 80
```

From a plugin or repo checkout:

```bash
cd /path/to/claude-to-codex
npm run handoff -- --tail 80
```

The hard range is 3 to 200 to prevent accidental giant prompts.

## When to use print mode

Use print mode when you want the exact same shell after exiting Claude:

```bash
node ~/.claude/skills/claude-to-codex/scripts/claude-to-codex.mjs --mode print
```

From a plugin or repo checkout:

```bash
cd /path/to/claude-to-codex
npm run handoff -- --mode print
```

Then exit Claude and run the printed `zsh .../run-codex.sh`.

## Codex-side behavior

The generated prompt tells Codex to:

- read the digest first
- inspect transcript slices only as needed
- verify current PR, branch, file, test, and deployment state
- avoid exposing secrets from transcripts
- spawn subagents only when explicitly requested or clearly useful
