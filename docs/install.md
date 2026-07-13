# Installation And Distribution

Claude to Codex supports two installation modes.

## Standalone

Standalone mode gives the short command:

```text
/handoff
```

Install:

```bash
git clone https://github.com/Amal-David/claude-to-codex.git
cd claude-to-codex
npm run install:standalone
```

This copies:

```text
~/.claude/commands/handoff.md
~/.claude/skills/claude-to-codex/SKILL.md
~/.claude/skills/claude-to-codex/scripts/claude-to-codex.mjs
```

Existing destination files are retained beside the new files as timestamped `.backup-*` copies.
Installation stages every file before replacing any destination and rolls back on failure. Restart
Claude Code after installing.

The standalone slash command is zero-argument for shell safety. Use the direct Node CLI for recovery
flags such as `--session`, `--transcript`, `--latest`, `--mode print`, and `--tail`.

Run a local diagnostic after installing:

```bash
node ~/.claude/skills/claude-to-codex/scripts/claude-to-codex.mjs --check
```

## Plugin

Plugin mode is best for teams and marketplace distribution. Plugin commands are namespaced by Claude Code, so the command becomes:

```text
/claude-to-codex:handoff
```

Install from marketplace:

```text
/plugin marketplace add https://github.com/Amal-David/claude-to-codex
/plugin install claude-to-codex@claude-to-codex
```

Develop locally:

```bash
claude --plugin-dir /path/to/claude-to-codex/plugins/claude-to-codex
```

## Repository as marketplace

This repository includes `.claude-plugin/marketplace.json`, so the repo root can be added as a Claude Code plugin marketplace. The plugin itself lives at:

```text
plugins/claude-to-codex
```

The plugin reads local Claude transcripts, writes local handoff packages, and can launch local
processes. Treat plugin installation as local code execution and install it only from a trusted
checkout or trusted marketplace source.

Because the plugin slash command is also zero-argument, plugin users who need recovery flags should
use a local checkout:

```bash
cd /path/to/claude-to-codex
npm run handoff -- --session <uuid>
npm run handoff -- --transcript /absolute/path/to/session.jsonl
npm run handoff -- --latest --mode print
npm run handoff -- --check
```

Alternatively, install standalone mode alongside the plugin and use the standalone Node path for
advanced recovery commands.

## Versioning

The plugin manifest and `package.json` have a `version` and must match. The npm package is private;
the tarball is a GitHub release artifact, not a public npm publication.
See [Releases](releases.md) for the tag-triggered GitHub release workflow.
