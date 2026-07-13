# Releases

Releases are tag-driven GitHub releases. The npm package is private and is not published to the npm
registry.

## Cut A Release

1. Update `package.json`, `plugin.json`, and the launcher version to the same version.
2. Add the release entry below.
3. Run `npm test` and `npm pack --dry-run`.
4. Commit and push `main`.
5. Create and push the matching `v*` tag.
6. Wait for the release workflow, then verify the GitHub release, tarball, and `SHA256SUMS`.

```bash
git tag v0.2.0
git push origin main
git push origin v0.2.0
```

The workflow tests the tagged commit, builds the source tarball with `npm pack`, writes checksums,
and creates release notes.

## v0.2.0

- Exact active-session selection through `${CLAUDE_SESSION_ID}`; newest-transcript discovery now requires `--latest`.
- Active-leaf transcript parsing with abandoned branches excluded.
- Fable 5 to Opus 4.8 lineage and structured fallback capture.
- Policy-neutral continuation: source refusal categories/explanations do not prime Codex in either direction.
- Operational blockers, paired verification status, attachment metadata, transcript fingerprinting, and malformed-line reporting.
- Explicit GPT-5.6 model propagation, Codex auth diagnostics, bounded pointer prompt, and private handoff permissions.
- Immediate-child multi-repository workspace capture.
- Transactional standalone installer with backups.

## Install From Source

```text
/plugin marketplace add https://github.com/Amal-David/claude-to-codex
/plugin install claude-to-codex@claude-to-codex
```

Or clone the release and run `npm run install:standalone`. Use `npm run handoff -- --check` before
the first real handoff.
