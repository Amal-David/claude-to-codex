# Installation And Distribution

Cloud Handoff supports two installation modes.

## Standalone

Standalone mode gives the short command:

```text
/handoff
```

Install:

```bash
git clone https://github.com/Amal-David/cloud-handoff.git
cd cloud-handoff
npm run install:standalone
```

This copies:

```text
~/.claude/commands/handoff.md
~/.claude/skills/codex-handoff/SKILL.md
~/.claude/skills/codex-handoff/scripts/codex-handoff.mjs
```

Restart Claude Code after installing.

The standalone slash command is zero-argument for shell safety. Use the direct Node CLI for recovery
flags such as `--session`, `--transcript`, `--mode print`, and `--tail`.

## Plugin

Plugin mode is best for teams and marketplace distribution. Plugin commands are namespaced by Claude Code, so the command becomes:

```text
/cloud-handoff:handoff
```

Install from marketplace:

```text
/plugin marketplace add https://github.com/Amal-David/cloud-handoff
/plugin install cloud-handoff@cloud-handoff
```

Develop locally:

```bash
claude --plugin-dir /path/to/cloud-handoff/plugins/cloud-handoff
```

## Repository as marketplace

This repository includes `.claude-plugin/marketplace.json`, so the repo root can be added as a Claude Code plugin marketplace. The plugin itself lives at:

```text
plugins/cloud-handoff
```

The plugin reads local Claude transcripts, writes local handoff packages, and can launch local
processes. Treat plugin installation as local code execution and install it only from a trusted
checkout or trusted marketplace source.

Because the plugin slash command is also zero-argument, plugin users who need recovery flags should
use a local checkout:

```bash
cd /path/to/cloud-handoff
npm run handoff -- --session <uuid>
npm run handoff -- --transcript /absolute/path/to/session.jsonl
```

Alternatively, install standalone mode alongside the plugin and use the standalone Node path for
advanced recovery commands.

## Versioning

The plugin manifest has a `version`. Bump `plugins/cloud-handoff/.claude-plugin/plugin.json` for releases.
