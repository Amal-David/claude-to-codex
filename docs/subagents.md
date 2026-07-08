# Subagents

Subagents are powerful but not free. They create separate model work, which can increase token usage and latency. Claude to Codex therefore does not spawn subagents by default.

## In Claude Code

The plugin ships optional review agents:

- `claude-to-codex:efficiency-reviewer`
- `claude-to-codex:usability-reviewer`
- `claude-to-codex:security-reviewer`

Use them when changing the handoff workflow or preparing a release.

Example prompt in Claude Code:

```text
Use the claude-to-codex efficiency, usability, and security reviewers to review this plugin. Wait for all three, then summarize only blocking findings.
```

## In Codex

Codex only spawns subagents when explicitly asked. The slash command does not accept arguments.
For advanced handoffs, run the direct Node CLI with a bounded subagent budget:

```bash
node ~/.claude/skills/claude-to-codex/scripts/claude-to-codex.mjs --codex-subagents 3 "review this implementation before continuing"
```

Plugin or repo-checkout users can run the same option through the repo script:

```bash
cd /path/to/claude-to-codex
npm run handoff -- --codex-subagents 3 "review this implementation before continuing"
```

That adds guidance to the Codex prompt, but still asks Codex to use subagents only for disjoint review or exploration.

Good Codex prompt:

```text
Spawn three subagents: one for token efficiency, one for security, and one for install usability. Wait for all three, fix only blocking findings, and keep unrelated files untouched.
```

Bad Codex prompt:

```text
Spawn many agents and improve everything.
```

## Token-aware rule

Use subagents for bounded work that keeps the main thread clean:

- codebase exploration
- security review
- install doc review
- platform compatibility review

Avoid subagents for:

- the immediate next edit
- tiny fixes
- ambiguous strategy work
- recursive multi-agent fan-out
