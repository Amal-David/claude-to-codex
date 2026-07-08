---
name: handoff
description: Hand off a live Claude Code conversation to Codex by packaging the local Claude transcript, writing a compact digest, and launching or preparing an interactive Codex terminal session. Use when the user asks to continue in Codex, is hitting Claude limits, or wants a Claude to Codex handoff.
---

# Handoff

Prefer the command form for deterministic execution:

```text
/claude-to-codex:handoff
```

The command runs `scripts/claude-to-codex.mjs`, which writes a handoff package under `~/.claude/handoffs` and launches Codex when possible.

The slash command is zero-argument for shell safety. Use the direct Node CLI when maintaining the
plugin and you need options such as `--mode print`, `--session`, `--transcript`, `--tail`, or
`--codex-subagents`:

```bash
node plugins/claude-to-codex/scripts/claude-to-codex.mjs --mode print
```

Token rule: pass Codex the digest and transcript path, not a full pasted transcript. Let Codex read only the transcript slices it needs.
