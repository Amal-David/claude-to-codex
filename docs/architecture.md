# Architecture

Cloud Handoff is a command-backed Claude Code skill.

## Flow

1. User runs `/handoff` in Claude Code.
2. Claude Code expands the command without invoking the model.
3. `codex-handoff.mjs` locates the current Claude JSONL transcript.
4. The script writes a handoff directory under `~/.claude/handoffs`.
5. The script builds `codex-prompt.md` with:
   - workspace path
   - transcript path
   - digest path
   - recent redacted transcript digest
   - an explicit untrusted-context boundary around transcript-derived text
   - safety and verification rules
6. The script launches Codex in tmux, Terminal, or print mode.
7. Codex starts interactively with the handoff prompt.

## Why not paste the full transcript

Pasting a full Claude transcript into Codex repeats the context pressure problem. The transcript is already durable on disk, so the prompt should contain pointers and a compact digest. Codex can read targeted transcript slices only when needed.

## Why not in-place terminal replacement

Claude owns the active terminal while its TUI is running. Replacing that same TTY with Codex from inside a slash command is brittle. Cloud Handoff prefers:

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

The digest redacts common token shapes and is wrapped in an explicit untrusted-context boundary in
the generated Codex prompt. This is defense in depth, not a guarantee. Users should treat Claude
transcript files and handoff packages as sensitive local agent logs.
