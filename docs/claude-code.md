# Claude Code Notes

After installing shell integration, start `claude` normally for a shared-terminal round trip. The existing
`/handoff` command automatically routes through the supervisor when active.
See [bidirectional usage](bidirectional.md).

Claude to Codex uses current Claude Code extension points:

- Skills are invokable with `/skill-name`.
- Legacy `.claude/commands/*.md` files still create skills; plugin commands are namespaced.
- `${CLAUDE_SESSION_ID}` expands to the exact current session id.
- `${CLAUDE_PLUGIN_ROOT}` identifies the installed plugin directory.
- `disable-model-invocation: true` makes `/handoff` user-only.
- `allowed-tools: Bash(node *)` allows Node commands while this user-invoked command renders; explicit deny/ask rules still take precedence.

The standalone command runs:

```bash
node "$HOME/.claude/skills/claude-to-codex/scripts/claude-to-codex.mjs" --session "${CLAUDE_SESSION_ID}"
```

The plugin command uses the same exact-session argument with `${CLAUDE_PLUGIN_ROOT}` and is exposed
as `/claude-to-codex:handoff`. No `$ARGUMENTS` value is inserted into the shell command.

Fable is a Claude model. A transcript may therefore show a lineage such as `claude-fable-5` to
`claude-opus-4-8`; that is a model transition inside one Claude Code session, not an agent-to-agent
handoff.

Managed Claude installations can disable skill shell execution. In that case Claude replaces the
collector invocation with a disabled notice, and the user must run the direct Node CLI from a
trusted checkout.

The standalone installer resolves the collector to a shell-quoted absolute path in the installed
command. It does not leave `$HOME` for Claude's injected-command permission preflight to evaluate.
Paths containing spaces and apostrophes are covered by an execution regression test.

If `/handoff` reports `Shell command permission check failed`, the collector has not run.
Check `/permissions` for explicit ask/deny rules. Leave plan mode before transferring, since
handoff writes context files and starts another CLI. Do not disable permissions globally.
See [Claude's injected-command permission checks](https://code.claude.com/docs/en/skills#permission-checks-on-injected-commands).
