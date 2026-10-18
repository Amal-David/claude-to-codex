# Architecture

Claude to Codex uses deterministic local collectors and a PTY supervisor for
bidirectional terminal CLI handoffs. `handoff.mjs` prepares a package and writes a
request in the supervisor's private temporary control directory. `terminal.py`
authenticates its generation nonce, validates the chain and workspace, confirms
the destination executable, acknowledges the request, terminates the source,
and starts the destination on a new PTY attached to the same terminal. It
forwards keyboard input, output and resize events and restores terminal modes.

Each supervisor run creates a stable chain UUID. `transfer.json` links to the
previous transfer and records the original objective and source fingerprint.
The recent evidence is bounded, while original transcripts and earlier packages
remain available by reference. No internal agent database is modified. JSONL rollouts are read directly; paginated histories use documented read-only
`codex app-server` stdio methods. Unknown or unexportable formats fail closed. See [the shared context contract](bidirectional.md).

The original Claude-source collector remains compatible as follows.

## Flow

1. The user runs `/handoff` in Claude Code.
2. Claude Code substitutes `${CLAUDE_SESSION_ID}` and runs the Node collector without a model turn.
3. The collector opens that exact JSONL transcript, follows its selected active leaf, and ignores rewound branches.
4. It writes a private handoff package under `~/.claude/handoffs`.
5. It captures one Git repository or immediate child repositories when the current directory is an orchestration workspace.
6. It resolves the Codex target from `--codex-model`, `CLAUDE_TO_CODEX_MODEL`, Codex config, or the Codex default.
7. Managed mode routes the package through the supervisor. Legacy standalone modes use tmux, an owned terminal, or report an actionable limitation.

Launcher success means the command was dispatched. The user should confirm the interactive Codex
session is ready; the collector does not claim that Codex accepted a model merely because a terminal launcher returned successfully.

## Package

- `hot-context.md`: current goal, active files, decisions, constraints, dead ends, operational blockers, verification signals, and next action.
- `git-snapshot.md`: capped branch, HEAD, status, changed paths, warnings, and diff stats for each detected repository.
- `handoff.json`: schema-versioned paths, model lineage, neutral fallback events, transcript fingerprint, branch selection, Git metadata, attachment pointers, and preservation policy.
- `digest.md`: recent redacted active-branch text and paired tool results with `passed`, `failed`, or `unknown` status.
- `codex-prompt.md`: a bounded pointer-only prompt. It does not contain the digest or free-form user note.
- `run-codex.sh`: private POSIX-shell runner that pins `-C` and the resolved `-m` model.
- raw Claude JSONL transcript: deeper history, available by path for targeted inspection.

## Policy-Neutral Boundary

Claude safety, legality, and refusal verdicts are not transferred as recommendations. Structured
`model_refusal_fallback` events preserve only neutral `from`, `to`, timestamp, line, and source
metadata. Category, trigger, explanation, and refusal prose are omitted from summaries.

The original user request remains available. Codex is explicitly told to assess that request under
its own policies: a Claude refusal is neither permission to proceed nor a requirement to refuse.
Ordinary technical blockers, such as missing credentials or a failed test, remain as untrusted
operational facts.

## Discovery

Normal `/handoff` always passes the exact session id. Direct CLI selection is fail-closed:

1. `--transcript <path>`
2. `--session <id>` or a known session environment variable
3. `--latest`, only when the user explicitly accepts newest-transcript discovery

Claude stores transcripts under `~/.claude/projects/<project>/<session-id>.jsonl`. The collector
streams JSONL, records malformed lines, fingerprints the source with SHA-256, and retries if the
file changes during capture.

## Security And Tokens

The slash command accepts no free-form arguments. Handoff directories and runners use `0700`; data
files use `0600`. Common credentials are redacted, metadata is sanitized, and full diffs are not
captured. The initial Codex argv prompt is capped at 24 KiB and contains paths plus continuation
rules, avoiding both transcript replay and large-process-argument failures.
