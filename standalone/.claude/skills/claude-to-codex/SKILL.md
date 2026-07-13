---
name: claude-to-codex
description: Support the standalone /handoff command that resumes Claude Code sessions in Codex with Fable/Opus model lineage, limit/fallback detection, policy-neutral context, a configured target model, private context files, and git state. Use when maintaining, explaining, or debugging the command installed under ~/.claude/commands/handoff.md.
---

# Claude to Codex

The user-facing command is:

```text
/handoff
```

It runs:

```bash
node "$HOME/.claude/skills/claude-to-codex/scripts/claude-to-codex.mjs" --session "${CLAUDE_SESSION_ID}"
```

The script packages the exact current Claude transcript into `~/.claude/handoffs`, reports
Fable/Opus model transitions and the resolved Codex model, then dispatches Codex with a bounded
prompt that points at hot context, the handoff manifest, git snapshot, digest, and transcript.
Source-model policy verdicts are excluded so Codex assesses the user's request independently. Run
the direct Node CLI with `--check` to diagnose install, transcript, target model, Codex, git, and
launcher prerequisites.
