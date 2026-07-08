# Releases

Releases are tag-driven.

## Cut A Release

1. Update `package.json` and `plugins/claude-to-codex/.claude-plugin/plugin.json` to the same version.
2. Run:

```bash
npm test
npm pack --dry-run
```

3. Commit the version change.
4. Tag and push:

```bash
git tag v0.1.0
git push origin main --tags
```

The release workflow runs on `v*` tags. It tests the repo, builds the package tarball with
`npm pack`, writes `SHA256SUMS`, and creates a GitHub release with generated notes.

## Install From Source

Claude Code plugin users can install from the GitHub marketplace source:

```text
/plugin marketplace add https://github.com/Amal-David/claude-to-codex
/plugin install claude-to-codex@claude-to-codex
```

Standalone users can install from a checkout:

```bash
git clone https://github.com/Amal-David/claude-to-codex.git
cd claude-to-codex
npm run install:standalone
```

Run the diagnostic before your first real handoff:

```bash
npm run handoff -- --check
```
