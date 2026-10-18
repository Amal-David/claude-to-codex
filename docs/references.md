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
- `${CLAUDE_SESSION_ID}` is the documented exact current-session substitution for skills.
- Claude transcripts live under `~/.claude/projects/<project>/<session-id>.jsonl`.

## Codex

- Codex CLI overview: https://developers.openai.com/codex/cli
- Codex CLI features: https://developers.openai.com/codex/cli/features
- Codex CLI options: https://developers.openai.com/codex/cli/reference
- Codex slash commands: https://developers.openai.com/codex/cli/slash-commands
- Codex subagents: https://developers.openai.com/codex/subagents

Key design points:

- Codex can start interactively with an initial prompt.
- `-C` sets the working directory.
- `-m` overrides the configured model for one invocation.
- `codex login status` exits successfully when credentials are present.
- Subagents are explicit and can consume extra tokens, so Claude to Codex never spawns them by default.
- Codex should verify live repo and PR state because Claude transcript facts can be stale.

## Skills.sh

- Skills directory: https://skills.sh
- Skills CLI documentation: https://skills.sh/docs/cli
- Skills CLI source: https://github.com/vercel-labs/skills
- Claude to Codex listing: https://skills.sh/amal-david/claude-to-codex

Key design points:

- Public repositories become discoverable through successful `npx skills add` installations; there is no separate submission form.
- The CLI installs the discovered skill directory, so every runtime dependency must live beside `SKILL.md`.
- Install telemetry powers the public listing and rankings.

## Community handoff feedback

- Reddit thread: https://www.reddit.com/r/claudeskills/comments/1uj04xx/what_should_a_claude_handoff_skill_preserve_when/

Design points incorporated:

- Preserve hot working state, not the whole reasoning trail.
- Keep history, planning, decisions, and implementation state distinguishable.
- Use git as cheap project truth for touched files and diffs.
- Preserve constraints, dead ends, verification status, and the next smallest action.
- Drop abandoned branches and superseded debugging paths unless they explain a still-relevant decision.
- Keep source-agent interpretation separate from factual state so the receiving model can assess the user's request independently.

## Model Transition Note

Fable is a Claude model alias. Claude Code transcripts can include a structured fallback from
`claude-fable-5` to `claude-opus-4-8`, including refusal metadata. Claude to Codex preserves the
neutral model transition but deliberately excludes the refusal category and explanation from the
receiving prompt.

## Bidirectional implementation checks (2026-10-17)

- [Codex skill documentation](https://developers.openai.com/codex/skills/): native `$handoff` skill invocation and global discovery.
- [Codex CLI reference](https://developers.openai.com/codex/cli/reference/): interactive initial prompt, project directory, model options.
- [Claude CLI reference](https://code.claude.com/docs/en/cli-reference): interactive initial prompt and model options.
- [Claude skills](https://code.claude.com/docs/en/skills): command substitutions, active-session identity and shell permission model.
- [Claude hooks](https://code.claude.com/docs/en/hooks): reviewed for integration; no hook or internal-session injection is required.

Installed `codex --help` (0.163.0) and `claude --help` (2.1.292) confirmed the interactive entry points. The PTY supervisor is project code, not a claim that either CLI provides process-replacement hooks.

- [Codex native stdio export](https://developers.openai.com/codex/app-server/): `initialize`, `thread/read`, `thread/turns/list`, and legacy `includeTurns`; this implementation only reads existing threads.
- [Codex shell environment source](https://github.com/openai/codex/blob/main/codex-rs/protocol/src/shell_environment.rs): exact `CODEX_THREAD_ID` injection and environment filtering.
- [Codex protocol types](https://github.com/openai/codex/blob/main/codex-rs/protocol/src/protocol.rs): native rollback and tool evidence record definitions.
