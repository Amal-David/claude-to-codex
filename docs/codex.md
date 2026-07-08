# Codex Notes

Claude to Codex starts Codex in interactive CLI mode with an initial prompt.

The generated runner looks like:

```bash
codex -C /path/to/workspace "$(cat /path/to/codex-prompt.md)"
```

Codex receives:

- current working directory
- hot context path
- git snapshot path
- handoff manifest path
- transcript path
- digest path
- recent digest
- safety instructions
- optional note
- optional subagent budget

Codex should read `hot-context.md` first, then use `handoff.json` for structured metadata and
`git-snapshot.md`/`digest.md` for deeper pointers.

## Why interactive Codex

Interactive Codex is the right continuation surface because the user can keep typing, approve or reject steps, inspect diffs, and ask Codex to spawn subagents.

## Current-state verification

Claude transcript facts can be stale. The generated prompt explicitly tells Codex to verify:

- git branch and working tree
- PR state
- remote deployments
- tests and builds
- files changed since the transcript

## Subagents

Codex subagents are explicit. Claude to Codex does not assume they should run. Use the direct Node CLI
or `npm run handoff -- --codex-subagents <n>` from a repo checkout to give Codex a bounded budget
and a user note describing why parallel work is useful.
