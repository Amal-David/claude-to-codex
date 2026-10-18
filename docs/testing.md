# Test coverage

Run the complete suite from the checkout:

```sh
npm test
```

It runs package validation, 29 Node tests (including scenario subtests), 49 Python
terminal/rendezvous/shell tests, and the original smoke suite. The button scenario
also executes seven project checks at both the failing and passing stages.
No automated test uses a paid model account or modifies the user's projects.

## Website button conversation

The reproducible conversation and project files live in
`test/fixtures/website-button/`. The scripted conversation requests an accessible
Add to cart button with no frameworks, preserved existing content, native keyboard
activation, live cart announcements, and visible focus styling.

1. Claude creates semantic markup and hands off the outstanding behavior work.
2. Codex reads that package, adds the click/count code, and runs the actual project
   checks. Six pass and the missing focus-ring check fails.
3. Claude reads the returning package, recovers the failure and next step, adds
   focus styling, and reruns the checks. All seven pass.

The tests run the real collectors and linked package format. The PTY version
also launches interactive scripted receiving agents and performs both terminal
switches. A receiving fixture refuses to continue unless the preceding package
contains the required original objective, evidence, and next step. Staged and
unstaged user notes must survive unchanged. Another scenario performs twelve
successive transfers and checks unique packages, bounded prompts, and one original
objective. Long-output coverage verifies that final test totals survive clipping
and that secrets remain redacted.

These are scripted agent fixtures, not claims of authenticated model reasoning.
The seven button checks execute JavaScript against a minimal DOM fixture and
inspect semantic markup and focus CSS. Actual browser keyboard/visual behavior
is not established by those checks.

## Terminal compatibility and failures

Coverage includes exact native argv preservation (no injected `--no-daemon`,
directory grants, or configuration overrides), zsh/bash automatic startup,
resume/profile arguments, native maintenance commands, paths with spaces and
apostrophes, terminal resize, streamed output, interrupts, source cleanup, missing
destinations, and failed launches.

Rendezvous checks cover stale daemon environments, wrong source/workspace,
missing or invalid exact session IDs, expired/future markers, malformed/oversized
requests, unsafe file permissions, symlinks, invalid model values, preparation
failure, one-time consumption, replay, and fragmented ANSI-colored markers.
Validation failures must preserve the source terminal's usability. No test
restarts the user's shared Codex daemon or deletes native writer locks.
Availability checks also cover missing, expired, wrong-project, and wrong-agent
supervisors. A native session ID alone must not produce a queued marker when no
live terminal integration is available for that project.

Terminal mode tests reproduce a source TUI leaving SGR/all-motion mouse tracking
enabled during shutdown. They require the outer terminal to stay raw until the
source exits, disable mouse/focus/paste modes before destination startup, discard
queued mouse packets, and preserve ordinary keyboard type-ahead and bracketed
paste. Normal exit and abrupt crash must also leave application modes disabled
and restore shell attributes. These protocol checks use PTYs, not a visual macOS
Terminal emulator; interactive behavior in the user's affected tab remains a
manual verification step.

## Native executables

These opt-in checks use isolated homes and temporary projects:

```sh
python3 scripts/real-cli-smoke.py --codex-only
python3 scripts/real-cli-smoke.py --handoff --stale-environment
```

The first observes native interactive startup. The second creates a real Codex
session with an unavailable localhost provider, interrupts its request, removes
the collector's handoff environment, and checks exact-session packaging and
automatic native Claude startup through the marker path. It contacts no external
model. Claude's network/authentication checks can fail under the development
sandbox; native startup is not an authenticated continuation.

For the separate human-operated authenticated round-trip check, run
`python3 scripts/authenticated-roundtrip.py` directly in a normal macOS Terminal
window. The chat shell runner has no interactive TTY. See
[verification.md](verification.md) for actual observations and remaining limits.


Shutdown backpressure regression (2026-10-18): the real PTY test fills the source input
queue while the source ignores SIGINT/SIGTERM. The previous blocking shutdown code fails
this test at its Ctrl-C write; the corrected implementation completes within the deadline.
A full-supervisor test also floods input while a real collector requests transfer, ensuring
input forwarding cannot prevent the supervisor from accepting the request. Input forwarding
uses nonblocking partial writes and a bounded queue with reader backpressure.

`python3 scripts/real-cli-smoke.py --claude-handoff` is an opt-in native Claude slash-command
probe with isolated configuration and an unavailable local model endpoint. The first attempt stopped at Claude onboarding connectivity. After placing onboarding settings
in the isolated custom config directory, native Claude accepted the installed `/handoff`,
created its own native transcript, packaged the exact session, and launched native Codex.
The probe uses a test-only `--no-daemon` Codex shim because sandbox process inspection is
denied. This checks native command rendering and switching, not authenticated model consumption.

Shutdown output regression: the source ignores Ctrl-C and writes a 150,000-byte final
screen on SIGTERM. The supervisor must drain it in full and reap the source before opening
the destination. This exercises the macOS PTY exit/drain ordering missing from the earlier
full-input-queue test. Final cleanup flushes pending application input so mouse reports do
not become commands at the parent shell prompt.
