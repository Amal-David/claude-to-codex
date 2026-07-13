---
description: Resume the current Claude Code session in Codex, preserving Fable/Opus model changes and unfinished work
argument-hint: 'no arguments; use the direct Node CLI for advanced options'
disable-model-invocation: true
allowed-tools: Bash(node:*)
---

!`node "$HOME/.claude/skills/claude-to-codex/scripts/claude-to-codex.mjs" --session "${CLAUDE_SESSION_ID}"`
