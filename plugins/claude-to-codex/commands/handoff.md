---
description: Hand off the current Claude Code session to an interactive Codex terminal session
argument-hint: 'no arguments; use the direct Node CLI for advanced options'
disable-model-invocation: true
allowed-tools: Bash(node:*)
---

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/claude-to-codex.mjs"`
