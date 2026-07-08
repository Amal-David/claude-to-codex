# Claude to Codex

**Claude to Codex** handoff tooling for Claude Code users who want to move an active, context-heavy Claude session into an interactive Codex terminal session.

Claude to Codex gives Claude Code a `/handoff` command. It packages the current Claude transcript, writes a compact redacted digest, and starts Codex with enough context to continue without replaying the whole conversation into the prompt.

## Why

Claude Code can run into context pressure or account limits during long engineering sessions. Codex is often the right continuation surface: it can open an interactive terminal UI, inspect the same repo, run commands, edit files, and spawn subagents when explicitly asked.

Claude to Codex is built around one principle:

> Put durable context on disk, put only the handoff pointer plus compact digest in the Codex prompt, and make Codex verify current state before acting.

## Install

Prerequisites:

- Claude Code installed and authenticated.
- Codex CLI installed, on `PATH`, and authenticated with `codex login`.
- Node.js 22 or newer.
- Optional: tmux for same-terminal-pane workflows, or macOS Terminal for new-window launch fallback.

### Option A: standalone `/handoff`

This gives the shortest command name.

```bash
git clone https://github.com/Amal-David/claude-to-codex.git
cd claude-to-codex
npm run install:standalone
```

Then restart Claude Code and run:

```text
/handoff
```

### Option B: Claude Code plugin

Use this when sharing with a team or installing from a marketplace.

```text
/plugin marketplace add https://github.com/Amal-David/claude-to-codex
/plugin install claude-to-codex@claude-to-codex
```

Plugin commands are namespaced:

```text
/claude-to-codex:handoff
```

For local development without marketplace install:

```bash
claude --plugin-dir /path/to/claude-to-codex/plugins/claude-to-codex
```

Plugin users who need advanced recovery flags should keep a local checkout and run:

```bash
cd /path/to/claude-to-codex
npm run handoff -- --mode print
```

## Usage

The slash command is intentionally zero-argument. That keeps Claude Code from injecting free-form
slash-command text into a shell command.

```text
/handoff
```

If installed as a plugin, use the namespaced command:

```text
/claude-to-codex:handoff
```

Advanced controls are available through the direct Node CLI:

Standalone install path:

```bash
node ~/.claude/skills/claude-to-codex/scripts/claude-to-codex.mjs --mode print
node ~/.claude/skills/claude-to-codex/scripts/claude-to-codex.mjs --mode tmux
node ~/.claude/skills/claude-to-codex/scripts/claude-to-codex.mjs --mode terminal
node ~/.claude/skills/claude-to-codex/scripts/claude-to-codex.mjs --session 0afecd2f-c98d-4cf9-8a83-2c4165a3e680
node ~/.claude/skills/claude-to-codex/scripts/claude-to-codex.mjs --transcript ~/.claude/projects/-Users-me-project/session-id.jsonl
node ~/.claude/skills/claude-to-codex/scripts/claude-to-codex.mjs --tail 80
node ~/.claude/skills/claude-to-codex/scripts/claude-to-codex.mjs --no-launch
node ~/.claude/skills/claude-to-codex/scripts/claude-to-codex.mjs --codex-subagents 3 "review efficiency and usability before continuing"
```

Plugin or repo-checkout path:

```bash
cd /path/to/claude-to-codex
npm run handoff -- --mode print
npm run handoff -- --session 0afecd2f-c98d-4cf9-8a83-2c4165a3e680
npm run handoff -- --transcript ~/.claude/projects/-Users-me-project/session-id.jsonl
npm run handoff -- --tail 80
npm run handoff -- --no-launch
npm run handoff -- --codex-subagents 3 "review efficiency and usability before continuing"
```

Modes:

- `auto`: prefer a new tmux window, then a new macOS Terminal window, then print the command.
- `tmux`: force a tmux window.
- `terminal`: force a macOS Terminal window.
- `print`: write the handoff package and print the exact `zsh .../run-codex.sh` command.

Useful recovery options:

- `--session <uuid>`: use a specific Claude session id.
- `--transcript <path>`: use an exact Claude JSONL transcript path when automatic detection fails.
- `--tail <n>`: include 3 to 200 recent turns/tool uses in the digest.
- `--no-launch`: write the handoff package and print the command without opening tmux or Terminal.
- `--help`: show command help.

Developer/test options:

- `--cwd <path>`: override the workspace root used in the generated Codex command.
- `--handoff-root <path>`: override where handoff packages are written.

## What gets written

Each handoff creates:

```text
~/.claude/handoffs/<timestamp>-<session>/
|-- digest.md
|-- codex-prompt.md
`-- run-codex.sh
```

The prompt points Codex to:

- the current workspace
- the Claude JSONL transcript
- the compact digest
- optional user note
- explicit safety and verification instructions

## Recovery

If nothing opens, the command still prints a manual fallback:

```bash
zsh ~/.claude/handoffs/<timestamp>-<session>/run-codex.sh
```

If transcript detection fails, rerun with either:

Standalone install path:

```bash
node ~/.claude/skills/claude-to-codex/scripts/claude-to-codex.mjs --session <uuid>
node ~/.claude/skills/claude-to-codex/scripts/claude-to-codex.mjs --transcript /absolute/path/to/session.jsonl
```

Plugin or repo-checkout path:

```bash
cd /path/to/claude-to-codex
npm run handoff -- --session <uuid>
npm run handoff -- --transcript /absolute/path/to/session.jsonl
```

If Codex is not found or not authenticated, install Codex and run:

```bash
codex login
```

## Repository layout

```text
plugins/claude-to-codex/          Claude Code plugin
standalone/                     Files installed for short /handoff command
scripts/install-standalone.mjs  Installer for standalone mode
docs/                           Architecture, install, subagent, token notes
examples/codex-agents/          Optional Codex custom agent examples
test/fixtures/                  Test Claude JSONL transcript
```

## Docs

- [Architecture](docs/architecture.md)
- [Installation and distribution](docs/install.md)
- [Subagents](docs/subagents.md)
- [Token efficiency](docs/token-efficiency.md)
- [Claude Code notes](docs/claude-code.md)
- [Codex notes](docs/codex.md)
- [References](docs/references.md)

## Test

```bash
npm test
```

The test suite uses a small fixture transcript and does not launch Codex.

## Security

Claude to Codex never needs cloud credentials. It reads local Claude transcript files under
`~/.claude/projects`, writes local handoff packages under `~/.claude/handoffs`, and launches local
processes such as `codex`, `tmux`, or macOS Terminal. Install it only from a repo you trust.

The digest redacts common API key and bearer token shapes, but transcripts can contain sensitive
material. Treat `~/.claude/handoffs` like any other local agent log directory. The generated Codex
prompt marks transcript-derived digest text as untrusted context so old transcript text is not
treated as new instructions.

## License

MIT
