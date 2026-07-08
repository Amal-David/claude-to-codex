# Claude Code Notes

Claude to Codex relies on Claude Code extension points documented by Anthropic:

- Skills can be invoked with `/skill-name`.
- Custom commands have been merged into skills; `.claude/commands/*.md` still works.
- Plugins package skills, commands, agents, hooks, and MCP servers for sharing.
- Plugin skills and commands are namespaced by plugin name.
- Plugin agents can provide specialized review roles.

## Local standalone files

Standalone install writes:

```text
~/.claude/commands/handoff.md
~/.claude/skills/claude-to-codex/
```

This gives `/handoff`.

## Plugin files

Plugin install uses:

```text
plugins/claude-to-codex/commands/handoff.md
plugins/claude-to-codex/skills/handoff/SKILL.md
plugins/claude-to-codex/agents/*.md
```

This gives `/claude-to-codex:handoff`.

## Command execution

The command uses:

```yaml
disable-model-invocation: true
allowed-tools: Bash(node:*)
```

That keeps the handoff deterministic and avoids spending Claude tokens on orchestration.

The command intentionally does not pass `$ARGUMENTS` into the shell command. Use the direct Node CLI
for advanced options when you need recovery flags or subagent budget hints.
