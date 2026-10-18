# Verification record

Verified on macOS with Node.js 26.4, Python 3.14, Codex CLI 0.163.0, and Claude Code
2.1.292. Automated checks and native CLI probes have distinct scopes.

## Automated checks

`npm test` passes 29 Node tests and 49 Python tests, package validation, and the
original compatibility smoke suite. Tests cover:

- Exact session selection, mixed native history formats, large and corrupted histories,
  compaction, tool evidence, and bounded context packages.
- Both transfer directions, repeated switches, linked chains, and retained original objectives.
- Preserved source transcripts and staged/unstaged Git changes.
- Global installation, backups, unusual paths, and automatic zsh/bash integration.
- Private IPC, nonce validation, expired requests, stale daemon environments, and replay rejection.
- PTY input/output, resize, missing destinations, failed launches, interrupts, and cleanup.
- Full input queues and shutdown output backpressure, including a 150,000-byte final source screen.
- A sample website-button conversation that carries requirements and failing test evidence
  through both agents, then completes the outstanding focus-ring requirement.

The button fixture checks semantic markup, behavior, announcements, and CSS with Node.
It does not establish browser rendering or assistive-technology behavior. Fixture agents
exercise the real collectors and supervisor, but do not prove remote model consumption.

## Native CLI probes

`python3 scripts/real-cli-smoke.py --handoff --stale-environment` packages a real
Codex session and opens the actual Claude CLI. `--claude-handoff` drives Claude's
installed slash command, packages its exact native session, and opens Codex.
These isolated probes use temporary configuration and an unavailable local model
endpoint, so they do not consume remote model usage or establish authenticated continuation.
A test-only Codex `--no-daemon` shim avoids sandbox process-inspection restrictions;
production Codex arguments remain unchanged. Claude's destination startup can still
fail its connectivity check in a restricted environment.

Populated Codex app-server export is covered by protocol fixtures. A read-only native
initialization/missing-thread probe also passed; populated authenticated API export
has not been independently verified.

## Authenticated round trip

The human-operated `scripts/authenticated-roundtrip.py` passed in native macOS Terminal
using normal authentication and permission settings. Its saved result confirms:

- All three phase files have their expected contents.
- Transfers ran Claude → Codex → Claude.
- Both manifests belong to one correctly linked chain.
- The original objective, including random phase values, survived both transfers.
- The CLI exited successfully and `authenticatedRoundTrip` is `true`.

This was a minimal temporary-project test with three short model turns. It verifies
actual receiving-agent context consumption in both directions for the tested versions,
not every terminal emulator, permission profile, or future CLI release.

## Terminal regressions addressed

The native macOS test exposed shutdown and cleanup cases absent from initial fixtures:

- Codex directory/config arguments changed native permission or daemon behavior. The
  supervisor now preserves Codex launch arguments and uses terminal-marker routing when
  a shared daemon has stale shell environment.
- An unsupervised session could report a queued switch. The collector now checks a
  private supervisor heartbeat before accepting a live request.
- Shell-variable expansion in the Claude command could fail permission preflight. The
  standalone installer now writes a safely quoted absolute collector path.
- Full PTY input queues could block Ctrl-C and normal forwarding. Input is now buffered
  with nonblocking partial writes and bounded backpressure.
- Shutdown waits stopped reading final source output. Every shutdown phase now drains
  the PTY while polling for exit, with bounded waits and a regression proving complete
  final output arrives before the destination starts.
- Mouse protocols and queued application input could leak to the shell. The supervisor
  resets application modes, preserves keyboard typeahead across switches, and flushes
  pending application input on final exit before restoring shell terminal settings.

The input-queue and output-drain regressions were also run with the old behaviors
restored and failed, confirming that they detect the corresponding defects.
