---
name: handoff
description: Transfer the active Codex terminal session to interactive Claude Code CLI when the user invokes $handoff or asks to switch to Claude Code.
---

Run the bundled collector from this skill directory:

```sh
node "<skill-directory>/scripts/handoff.mjs" transfer --from codex
```

It uses `CODEX_THREAD_ID` to identify the exact current session, writes a private
local context package, and asks the terminal supervisor to switch to Claude Code.
Do not select the newest session, write a summary instead, or launch Claude inside
a shell tool's captured output. If `CODEX_THREAD_ID` is unavailable, pass the exact
current session id with `--session` only if known from this session's context;
otherwise report the error without guessing.

If the collector returns `HANDOFF_READY_` followed by 32 hexadecimal characters,
return that exact marker alone as your final response, then stop. This is a
one-time terminal connection request used when a shared daemon has an older
environment. It is queued, not yet a completed transfer. The terminal which
displays it prepares the exact session in its existing handoff chain and opens
Claude automatically. Do not rerun the collector or invent a marker.
Queued does not mean completed. Never claim a transfer is already in progress
solely because an earlier marker was returned. If the user explicitly asks to
try again after no switch, run the collector again and report its current result.
If it reports no active handoff terminal, relay the recovery instructions; do not
print an old marker or report success. Installation in a captured chat shell does
not load shell functions into an already-open macOS Terminal tab.

The installer makes normal interactive `codex` launches start the terminal
supervisor automatically in zsh and bash. Sessions already running before setup
need one restart using native resume if desired. Explicit `agent-handoff codex`
also works. Normal tool execution permissions still apply:
if the sandbox blocks the transcript directory or supervisor control directory, request the
CLI's normal approval for this collector command. Do not bypass permissions.
On success, stop doing work: the terminal will automatically open Claude Code.
On failure, relay the actionable error; the original session remains usable and
any prepared package stays on disk. Never retry a successful switch request.

If the model cannot run the skill because of a usage limit, the user can type
`!agent-handoff` in a supervised Codex CLI. The native `!` shell-command shortcut
executes the same collector directly, subject to the CLI's usual permissions.
