# Codex Notes

Claude to Codex opens an interactive Codex CLI session with a bounded initial prompt:

```bash
codex -C /path/to/workspace -m gpt-5.6-sol "$(cat /path/to/codex-prompt.md)"
```

The prompt contains only the workspace, session, context-file paths, model transition, neutral
handoff reason, and continuation rules. Transcript prose, digest text, and the optional user note
stay on disk rather than appearing in the process argument list.

Codex is instructed to read `hot-context.md` first, then use `handoff.json`, `git-snapshot.md`, and
targeted transcript slices as needed. It must verify live branches, files, tests, PRs, and deployments
before treating transcript claims as current.

## Independent Policy Assessment

Codex receives the user's request, but not Claude's safety category or refusal explanation as
guidance. It decides whether to comply, safeguard, or refuse under its own policies. A source-model
refusal is neither authorization nor a binding refusal for Codex.

## Model And Authentication

`-m` overrides the configured model for the launched session. `codex login status` is used by
`--check` to verify that credentials are present. Model availability is ultimately confirmed by
Codex at launch; tmux or Terminal dispatch alone is not reported as model acceptance.

## Subagents

Subagents are off by default. `--codex-subagents <n>` adds a bounded budget hint, but Codex should
use it only for disjoint work that saves main-thread context.
