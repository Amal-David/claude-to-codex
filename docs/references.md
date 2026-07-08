# References

Claude to Codex is based on these current docs and local CLI behavior.

## Claude Code

- Claude Code skills: https://code.claude.com/docs/en/skills
- Claude Code commands: https://code.claude.com/docs/en/commands
- Claude Code plugins: https://code.claude.com/docs/en/plugins
- Claude Code plugins reference: https://code.claude.com/docs/en/plugins-reference
- Claude Code plugin marketplaces: https://code.claude.com/docs/en/plugin-marketplaces

Key design points:

- `.claude/commands/*.md` and `.claude/skills/*/SKILL.md` both create slash-command-style invocations.
- Plugins are better than standalone config for shared, versioned, reusable extensions.
- Plugin commands and skills are namespaced by plugin name.
- Plugins can ship agents for specialized review.

## Codex

- Codex CLI overview: https://developers.openai.com/codex/cli
- Codex CLI features: https://developers.openai.com/codex/cli/features
- Codex CLI options: https://developers.openai.com/codex/cli/reference
- Codex slash commands: https://developers.openai.com/codex/cli/slash-commands
- Codex subagents: https://developers.openai.com/codex/subagents

Key design points:

- Codex can start interactively with an initial prompt.
- `-C` sets the working directory.
- Subagents are explicit and can consume extra tokens, so Claude to Codex never spawns them by default.
- Codex should verify live repo and PR state because Claude transcript facts can be stale.

## Community handoff feedback

- Reddit thread: https://www.reddit.com/r/claudeskills/comments/1uj04xx/what_should_a_claude_handoff_skill_preserve_when/

Design points incorporated:

- Preserve hot working state, not the whole reasoning trail.
- Keep history, planning, decisions, and implementation state distinguishable.
- Use git as cheap project truth for touched files and diffs.
- Preserve constraints, dead ends, verification status, and the next smallest action.
- Drop abandoned branches and superseded debugging paths unless they explain a still-relevant decision.
