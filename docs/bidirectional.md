# Bidirectional terminal handoffs

Install from a trusted checkout with Node.js 22+ and Python 3.9+:

```sh
npm run install:standalone
```

The transactional installer backs up existing files. It installs `/handoff` for
Claude, `$handoff` for Codex, the collectors, and `~/.local/bin/agent-handoff`.
The installer adds shell integration to the current zsh or bash startup files,
preserving existing contents and backing up changed files. Open a new macOS
Terminal window after installation. Both native CLIs must be installed and authenticated
(`codex login`, `claude`), and Git is optional. No npm or Python dependencies are
needed. macOS and Linux terminals are supported; Windows needs a POSIX environment.

Start in your project:

```sh
codex
# Or: claude
```

Then type `$handoff` in Codex or `/handoff` in Claude. Codex also supports
`!agent-handoff`: the documented `!` shell-command shortcut invokes the collector
directly without spending a model turn. Use it when a usage limit prevents Codex
from executing its skill. The opposite **interactive**
CLI starts automatically in the same directory, with a prompt pointing to the
context package. Exiting it returns to your shell. Each switch asks the previous CLI to exit through its normal Ctrl-C handling,
then uses owned-process cleanup if needed, so switch only after active commands have
finished. This does not commit, stash, reset, or clean Git changes.

To enable the installed integration in your current shell immediately:

```sh
source "$HOME/.claude/skills/claude-to-codex/scripts/handoff-shell.sh"
```

The shell functions automatically supervise interactive starts, including prompts,
model options, `codex resume`, `codex fork`, and Claude's resume options. Help,
authentication, maintenance commands, print/exec mode, non-terminal calls, and
calls inside an existing supervisor use the native executable directly. Explicit
`agent-handoff codex ...` remains available. Use installer option
`--no-shell-integration` to leave startup files untouched. Unsupported shells
need manual integration. For zsh, `ZDOTDIR` is respected; bash installs in both
`.bashrc` and `.bash_profile` so macOS Terminal login shells work.

An already running unsupervised CLI must be restarted once after setup, using its
native resume option if desired. Automatic integration applies to new launches;
it cannot retrofit ownership of a running process's terminal. A skill's
captured shell tool cannot safely take over the parent TUI's terminal; the
supervisor owns a PTY and forwards keyboard input, output, and resize events.
The outer terminal remains raw while switching. After the source exits and its
final output is drained, the supervisor resets mouse tracking, focus reporting,
bracketed paste and alternate-screen modes before starting the destination.
Queued mouse reports are removed at that boundary; keyboard type-ahead is kept.
Shell attributes are restored when the supervisor finally exits, including after
cleanup failures. If an older version has left literal mouse codes in a window,
exit its CLI and run `reset` at the shell prompt, then install the update and
resume the source conversation before retrying the handoff.
No desktop application, browser, editor, `codex exec`, or `claude -p` is used for
the destination. The supervisor preserves Codex's native server choice; forcing
`--no-daemon` would conflict with conversations already owned by a shared daemon.
It does not inject `-c` overrides either: Codex treats shell-environment overrides
as another reason to exclude its shared daemon. When the daemon lacks this
terminal's connection environment, the collector queues a private request using
the exact `CODEX_THREAD_ID` and returns a one-time `HANDOFF_READY_...` marker.
The skill returns that marker as its final response. The supervisor which sees
it on its own terminal prepares the package in its existing chain, validates the
source/workspace, and launches the opposite CLI. The deterministic shell shortcut
prints the marker directly. No newest-session lookup or working-directory-only
terminal selection is used. Connection nonces stay out of process arguments.
Before queuing, the collector checks that a private supervisor heartbeat exists
for this project. If absent, it reports the exact-session restart instructions
instead of emitting a marker that no terminal can accept. Installing from the
chat shell does not reload an already-open macOS Terminal tab.
Remote execution is unsupported by this local handoff mechanism. Codex custom slash commands are not assumed; the native skill
invocation is `$handoff`. Permission prompts still follow each CLI's settings.
Claude receives `--add-dir` for the task's private chain and control directories.
Codex receives no automatic directory grants: some versions exit at startup when
`--add-dir` conflicts with read-only permissions. The collector can request normal
approval when the configured sandbox cannot write the package or control files.
The supervisor does not change the sandbox mode or enable a permission bypass.

## Configuration

The destination uses its normal local configuration and authentication. Codex
model priority remains `--codex-model`, `CLAUDE_TO_CODEX_MODEL`, the top-level
Codex config model, then the CLI default. Claude uses its configured default or
`HANDOFF_CLAUDE_MODEL`; offline exports also accept `--claude-model`.
`HANDOFF_CODEX_BIN` and `HANDOFF_CLAUDE_BIN` select an executable path (one path,
not a shell command). Set these **before** starting the supervisor.
`CODEX_HOME` and `CLAUDE_CONFIG_DIR` select native session roots.

`HANDOFF_ROOT` changes the package store, default `~/.claude/handoffs`.
The supervisor inherits it at startup. Each run has a stable chain UUID; each
transfer creates a unique directory and `transfer.json` with a pointer to its
predecessor. Context is linked rather than pasted repeatedly. A new supervised
shell start creates a new task chain. Continuing an older task is possible by
reading its manifest explicitly; it is not automatically associated by directory.

## Context and privacy

Packages contain `hot-context.md`, `digest.md`, `git-snapshot.md`, `prompt.md`,
`launch.json`, and `transfer.json`. Claude-source exports additionally retain the
existing schema-2 `handoff.json`, model lineage and fallback metadata, project
artifact pointers, `codex-prompt.md`, and recovery runner.

The shared manifest preserves the original objective, source/session/workspace,
SHA-256 fingerprint, previous transfer, and evidence paths. Recent conversation,
commands and results are extracted deterministically. Decisions, bugs, errors,
next steps, and constraints remain source evidence, not a generated AI summary.
Original transcript paths and line numbers allow recovery of older material.
The receiving CLI is told to read shared `AGENTS.md` and `CLAUDE.md` in place and
verify current files/tests. Project instructions are not copied into each package.

Codex carries the latest 80 relevant records, capped at 12,000 characters each.
Original-objective text is capped at 12,000 characters; recover longer content
from the original transcript. JSONL lines larger than 16 MiB are skipped as
malformed, with counts; smaller oversized tool outputs are clipped with notices.
Truncated/compacted history cannot recover missing text: parent manifests and
available raw transcripts are the recovery path. Unknown record types are counted
and left available in the original source. Recognized formats include native
`session_meta` + `response_item`, `event_msg`, compaction/error records, and older
metadata + top-level messages and latest turn working directories. This is format detection, not a promise to support
every future Codex persistence format. If no exact rollout exists, the collector uses the documented local CLI entry
point `codex app-server` over **stdio pipes**, calls `thread/read`, and pages
`thread/turns/list` with full items in chronological order. Older servers fall
back to `thread/read` with `includeTurns`. No `thread/start`, `thread/resume`,
fork, desktop connection, daemon socket, or database edit is used. The helper is
terminated after export. A private redacted `native-export.jsonl` preserves the
public source evidence beyond the hot-context cap; hidden reasoning is omitted.
Rollouts containing legacy rewind markers also use the materialized native
export so abandoned turns do not become continuation instructions. If that
server/version cannot export the exact thread, the source remains usable and the
collector fails actionably. Export responses are capped at 32 MiB per response,
256 MiB total, 2000 pages, and 60 seconds; exceeding a cap fails before switching.
`--transcript` still accepts an available native rollout for recovery.

Packages use `0700` directories and `0600` data files. Common credentials are
redacted from extracted evidence; arbitrary secrets may evade pattern matching.
Raw transcripts stay at their original locations and retain their existing
permissions; they are never copied, rewritten or deleted. Git capture is read-only
status, HEAD and diff statistics, with caps; uncommitted file contents stay in the
same working directory. The full transcript never appears in destination argv.
Bounded pointer prompts do expose local paths to process-list viewers.

## Errors and recovery

- **No supervisor:** start with `agent-handoff codex` or `agent-handoff claude`.
  The command deliberately does not start an interactive CLI inside captured tool
  output. Legacy Claude-to-Codex `--mode tmux` still dispatches a terminal window;
  managed mode is required for the shared-terminal round trip.
- **Missing exact identity:** Codex uses `CODEX_THREAD_ID`; Claude's command passes
  `${CLAUDE_SESSION_ID}`. Never pick another project's newest session. An explicit
  `--session` or `--transcript` is available for recovery. Multiple matching
  rollouts, workspace mismatches, unsupported formats, or missing files fail
  before the source session is stopped.
- **Permission denied:** allow the collector through the CLI's normal permission
  mechanism. It needs read access to that session, write access to the package
  root, and write access to the private temporary control directory. Managed
  policies that forbid those operations cannot support automatic handoff.
- **Destination missing:** the supervisor rejects the request and keeps the source
  interactive. Install the destination CLI and retry.
- **Destination exits or authentication fails:** normal CLI exit status is returned
  to the shell. Authenticate the native CLI and restart through the supervisor.
  The prepared package remains available; pass its `prompt.md` as the initial
  interactive prompt if recovery is needed. Acknowledgement means the switch was
  accepted, not that authentication or a model response succeeded.
- **Interrupted transfer:** completed package files remain; no source history or
  Git work is removed. `transfer.json` and `launch.json` are written only after
  evidence capture; incomplete directories can be ignored. Requests have a
  per-generation nonce, only one switch can be pending, and old requests cannot
  trigger later sessions. Control files live in a private temporary directory
  removed at normal exit. Forced SIGKILL cannot run cleanup; restart the shell
  and use `stty sane` if necessary. Long-running detached jobs are outside the
  handoff contract and should be stopped or managed separately.

Offline export (does not launch or need a supervisor):

```sh
agent-handoff transfer --from codex --session SESSION_ID --prepare-only
agent-handoff transfer --from claude --transcript '/path with spaces/session.jsonl' --prepare-only
```

## Validation

`npm test` runs package validation, Node unit tests, PTY integration tests using
interactive fixture CLIs with the real collectors, and the original extensive
Claude-to-Codex smoke suite in an isolated Git fixture. Tests cover exact-session
selection, both directions, repeated switches, context/Git preservation, malformed
and large history, spaces/quotes in paths, missing destination, and terminal I/O.
No test suite success alone proves that a remote model consumed the context.
See [testing.md](testing.md) for the expanded coverage, including a website-button
conversation, repeated switches, actual project checks, and routing failures.

Local verification on 2026-10-17: Codex CLI 0.163.0 and Claude Code 2.1.292 were
installed. Codex authentication was present; Claude authentication was absent.
Native CLI startup was attempted in isolated temporary projects using
`scripts/real-cli-smoke.py`. Codex's default daemon mode could not run `ps` under
this sandbox; the supported `--no-daemon` mode displayed its interactive sign-in prompt and remained live. Claude
printed its startup screen and exited with `api.anthropic.com: ENOTFOUND` under
network restrictions. The opt-in native handoff test (`python3 scripts/real-cli-smoke.py --handoff`)
created a real Codex session in a temporary project, preserved its original
objective via `CODEX_THREAD_ID`, invoked `!agent-handoff`, exited Codex through
its normal terminal input, and automatically opened the actual Claude Code CLI.
The source's unavailable localhost provider was interrupted before transfer; no
external model was contacted. Claude then failed its Anthropic network check.
This verifies native source selection, packaging, switching and destination
startup, but not receiving-model context consumption or an authenticated round
trip. A fully authenticated model-to-model end-to-end round trip could not be
verified. These attempts are not counted as a successful authenticated round trip.
Run the opt-in script in a normal terminal to reproduce isolated startup checks;
its default mode does not authenticate or send model requests. The optional
`--handoff` mode uses an unavailable localhost provider and a native user-shell
command to test transfer without an external model.

For an authenticated, human-operated round trip, run this directly in a normal
terminal where both CLIs are logged in:

```sh
python3 scripts/authenticated-roundtrip.py
```

This uses real model requests and normal permission prompts. Follow its displayed
steps to switch Claude → Codex → Claude, then exit. It verifies phase files with
fresh values recovered from the transferred objective and the linked manifests,
and retains private artifacts plus `result.json` for inspection. This check has
not yet passed in the sandboxed development environment. The user's normal
terminal confirmed installation and Claude authentication; the sandboxed process
cannot see that authentication. See [verification.md](verification.md).
