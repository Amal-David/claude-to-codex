---
name: codex-handoff
description: Support files for the standalone /handoff command. Use when maintaining, explaining, or debugging the Claude to Codex handoff command installed under ~/.claude/commands/handoff.md.
---

# Codex Handoff

The user-facing command is:

```text
/handoff
```

It runs:

```bash
node "$HOME/.claude/skills/codex-handoff/scripts/codex-handoff.mjs"
```

The script packages the current Claude transcript into `~/.claude/handoffs` and starts Codex with a compact prompt that points at the digest and transcript.
