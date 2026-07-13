# Token Efficiency

Claude to Codex tries to save useful context without moving the entire Claude conversation into the Codex prompt.

## Defaults

- hot context: current goal, touched files, decisions, constraints, dead ends, verification signals, and next action
- manifest: structured metadata for tools without markdown scraping
- git snapshot: branch, HEAD, capped status, changed files, warnings, and diff stats for one or more repositories
- project artifacts: pointer-only list of likely instruction/docs/config files
- digest tail: 28 recent text turns and tool uses
- full transcript: referenced by file path, not pasted
- subagents: off by default
- model invocation inside Claude command: disabled

## Why this works

The hot context carries the working state Codex should read first. The manifest carries structured
paths, options, warnings, and preservation metadata. Artifact discovery gives Codex pointers to
files such as `AGENTS.md`, `CLAUDE.md`, `README.md`, package scripts, docs, workflows, and test
config without pasting those files into the prompt. Older context remains available in the
transcript, but Codex only reads it when necessary.

## When to increase the tail

Use a larger tail when the session has many short messages after the last meaningful plan:

```bash
node ~/.claude/skills/claude-to-codex/scripts/claude-to-codex.mjs --latest --tail 80
```

From a plugin or repo checkout:

```bash
cd /path/to/claude-to-codex
npm run handoff -- --latest --tail 80
```

The hard range is 3 to 200. Tail size changes on-disk context, not the pointer-only Codex argv
prompt, which is separately capped at 24 KiB.

## When to use print mode

Use print mode when you want the exact same shell after exiting Claude:

```bash
node ~/.claude/skills/claude-to-codex/scripts/claude-to-codex.mjs --mode print --latest
```

From a plugin or repo checkout:

```bash
cd /path/to/claude-to-codex
npm run handoff -- --mode print --latest
```

Then exit Claude and run the printed `sh .../run-codex.sh`.

## Codex-side behavior

The generated prompt tells Codex to:

- read `hot-context.md` first
- use `handoff.json` for structured metadata
- read `git-snapshot.md` next
- use `digest.md` for recent history pointers
- inspect transcript slices only as needed
- verify current PR, branch, file, test, and deployment state
- avoid exposing secrets from transcripts
- independently assess the user's request instead of inheriting source-model policy verdicts
- spawn subagents only when explicitly requested or clearly useful
