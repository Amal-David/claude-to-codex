---
name: handoff
description: Switch from Claude Code to Codex without losing context. Packages the exact active session, recent decisions, and git state, then opens Codex. Use when Claude hits usage or context limits, changes models, or the user invokes /handoff or asks to continue in Codex.
---

# Handoff

Run the bundled launcher immediately. Do not manually summarize or paste the transcript into Codex.

For a Skills CLI installation, locate `scripts/claude-to-codex.mjs` beside this `SKILL.md` and run:

```bash
node <skill-directory>/scripts/claude-to-codex.mjs --session "${CLAUDE_SESSION_ID}"
```

Common skill directories are:

- `$HOME/.claude/skills/handoff`
- `<project>/.claude/skills/handoff`
- `$HOME/.agents/skills/handoff`

Require a non-empty `CLAUDE_SESSION_ID`; do not silently choose the newest transcript. The launcher writes a
private package under `~/.claude/handoffs`, resolves the target model from `CLAUDE_TO_CODEX_MODEL` or Codex
config, and dispatches Codex when a supported launcher is available. Relay the launcher result and manual
fallback command exactly.

The Claude Code plugin provides the deterministic namespaced command:

```text
/claude-to-codex:handoff
```

Maintainers can use the direct Node CLI for recovery options such as `--mode print`, `--codex-model`,
`--handoff-reason`, `--session`, `--latest`, `--transcript`, `--tail`, `--check`, or
`--codex-subagents`:

```bash
node plugins/claude-to-codex/skills/handoff/scripts/claude-to-codex.mjs --mode print --latest --codex-model gpt-5.6-sol
```

Token rule: pass Codex a bounded pointer prompt plus hot context, handoff manifest, git snapshot,
digest, and transcript paths, not a full pasted transcript. Source-model safety/refusal verdicts do
not become continuation guidance; Codex assesses the original user request independently.
