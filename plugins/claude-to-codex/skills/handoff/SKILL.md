---
name: handoff
description: Resume a live Claude Code conversation in Codex by packaging the local transcript, preserving Fable/Opus model lineage, detecting usage-limit or context-pressure signals, writing hot context and git state, and launching an interactive Codex session on the configured target model. Use when the user asks to continue in Codex, Fable falls back or downgrades to Opus, Claude hits usage limits, context is exhausted, or the user wants a Claude-to-Codex handoff.
---

# Handoff

Prefer the command form for deterministic execution:

```text
/claude-to-codex:handoff
```

The command runs `scripts/claude-to-codex.mjs`, which writes a private handoff package under
`~/.claude/handoffs`, reports source model transitions, resolves the target model from
`CLAUDE_TO_CODEX_MODEL` or Codex config, and dispatches Codex when a supported launcher is available.

The slash command is zero-argument for shell safety and passes `${CLAUDE_SESSION_ID}` to select the
exact active transcript. Use the direct Node CLI when maintaining the plugin and you need options
such as `--mode print`, `--codex-model`, `--handoff-reason`, `--session`, `--latest`,
`--transcript`, `--tail`, `--check`, or `--codex-subagents`:

```bash
node plugins/claude-to-codex/scripts/claude-to-codex.mjs --mode print --latest --codex-model gpt-5.6-sol
```

Token rule: pass Codex a bounded pointer prompt plus hot context, handoff manifest, git snapshot,
digest, and transcript paths, not a full pasted transcript. Source-model safety/refusal verdicts do
not become continuation guidance; Codex assesses the original user request independently.
