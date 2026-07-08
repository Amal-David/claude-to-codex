---
name: claude-to-codex
description: Support files for the standalone /handoff command. Use when maintaining, explaining, or debugging the Claude to Codex handoff command installed under ~/.claude/commands/handoff.md.
---

# Claude to Codex

The user-facing command is:

```text
/handoff
```

It runs:

```bash
node "$HOME/.claude/skills/claude-to-codex/scripts/claude-to-codex.mjs"
```

The script packages the current Claude transcript into `~/.claude/handoffs` and starts Codex with a compact prompt that points at hot context, handoff manifest, git snapshot, digest, and transcript files. Run the direct Node CLI with `--check` to diagnose install, transcript, Codex, git, and launcher readiness.
