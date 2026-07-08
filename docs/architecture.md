# Architecture

Claude to Codex is a command-backed Claude Code skill.

## Flow

1. User runs `/handoff` in Claude Code.
2. Claude Code expands the command without invoking the model.
3. `claude-to-codex.mjs` locates the current Claude JSONL transcript.
4. The script writes a handoff directory under `~/.claude/handoffs`.
5. The script builds `codex-prompt.md` with:
   - workspace path
   - hot context path
   - git snapshot path
   - manifest path
   - transcript path
   - digest path
   - recent redacted transcript digest as deeper history
   - an explicit untrusted-context boundary around transcript-derived text
   - safety and verification rules
6. The script launches Codex in tmux, Terminal, or print mode.
7. Codex starts interactively with the handoff prompt.

## Preservation model

The handoff package separates hot state from history:

- `hot-context.md`: first-read working state: current goal, files touched, git summary, decisions, constraints, dead ends, verification signals, and next smallest action.
- `git-snapshot.md`: cheap repo truth: branch, HEAD, capped `git status --short`, changed files, warnings, and diff stats. It intentionally avoids full diffs by default.
- `handoff.json`: stable machine-readable metadata: file paths, options, transcript stats, git stats, warnings, artifact pointers, and preservation policy.
- `digest.md`: recent transcript text and tool-use pointers.
- raw Claude JSONL transcript: deeper history, read only by targeted line or slice when the hot context is ambiguous.

This avoids carrying old debugging paths forward while preserving enough "why" to keep Codex from repeating known dead ends.

## Why not paste the full transcript

Pasting a full Claude transcript into Codex repeats the context pressure problem. The transcript is already durable on disk, so the prompt should contain hot state, repo truth, and pointers. Codex can read targeted transcript slices only when needed.

## Why not in-place terminal replacement

Claude owns the active terminal while its TUI is running. Replacing that same TTY with Codex from inside a slash command is brittle. Claude to Codex prefers:

- tmux window, when running inside tmux
- new macOS Terminal window, when available
- printed `run-codex.sh` command, for exact same shell after exiting Claude

## Transcript discovery

Discovery order:

1. `--transcript`
2. `--session`
3. known Claude session environment variables
4. newest transcript for the current project under `~/.claude/projects/<cwd-slug>`

The fallback keeps `/handoff` useful even when Claude does not expose the session ID to commands.

## Safety

The slash command does not pass `$ARGUMENTS` to the shell. Advanced flags are supported through the
direct Node CLI, where they are normal argv values.

The hot context, digest, and manifest redact common token shapes, and transcript-derived digest content is wrapped in an explicit untrusted-context boundary in the generated Codex prompt. Git capture is capped and does not include full diffs by default. This is defense in depth, not a guarantee. Users should treat Claude transcript files and handoff packages as sensitive local agent logs.
