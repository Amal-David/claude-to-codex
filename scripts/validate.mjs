#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const requiredFiles = [
  ".claude-plugin/marketplace.json",
  ".github/workflows/release.yml",
  "plugins/claude-to-codex/.claude-plugin/plugin.json",
  "plugins/claude-to-codex/commands/handoff.md",
  "plugins/claude-to-codex/skills/handoff/SKILL.md",
  "plugins/claude-to-codex/scripts/claude-to-codex.mjs",
  "standalone/.claude/commands/handoff.md",
  "standalone/.claude/skills/claude-to-codex/SKILL.md",
  "assets/screenshots/handoff-help.png",
  "assets/screenshots/handoff-package.png",
  "assets/screenshots/handoff-help.svg",
  "assets/screenshots/handoff-package.svg",
  "scripts/install-standalone.mjs",
  "scripts/smoke-test.mjs",
  "docs/releases.md",
  "README.md",
  "LICENSE"
];

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

for (const file of requiredFiles) {
  assert(fs.existsSync(path.join(repoRoot, file)), `Missing required file: ${file}`);
}

const marketplace = JSON.parse(read(".claude-plugin/marketplace.json"));
const plugin = JSON.parse(read("plugins/claude-to-codex/.claude-plugin/plugin.json"));
const packageJson = JSON.parse(read("package.json"));

assert(marketplace.name === "claude-to-codex", "Marketplace name must be claude-to-codex.");
assert(Array.isArray(marketplace.plugins), "Marketplace plugins must be an array.");
assert(marketplace.plugins.some((entry) => entry.name === "claude-to-codex"), "Marketplace must list claude-to-codex plugin.");
assert(plugin.name === "claude-to-codex", "Plugin name must be claude-to-codex.");
assert(plugin.version, "Plugin version is required.");
assert(plugin.version === packageJson.version, "Plugin version must match package.json version.");
assert(packageJson.private === true, "Package must remain GitHub-only to avoid npm registry name collision.");
assert(packageJson.scripts?.handoff === "node plugins/claude-to-codex/scripts/claude-to-codex.mjs", "Package must expose npm run handoff.");

const pluginCommand = read("plugins/claude-to-codex/commands/handoff.md");
const standaloneCommand = read("standalone/.claude/commands/handoff.md");
const script = read("plugins/claude-to-codex/scripts/claude-to-codex.mjs");
const releaseWorkflow = read(".github/workflows/release.yml");
const releasesDoc = read("docs/releases.md");

assert(pluginCommand.includes("disable-model-invocation: true"), "Plugin command must disable model invocation.");
assert(pluginCommand.includes("${CLAUDE_PLUGIN_ROOT}/scripts/claude-to-codex.mjs"), "Plugin command must use CLAUDE_PLUGIN_ROOT.");
assert(pluginCommand.includes(' --session "${CLAUDE_SESSION_ID}"'), "Plugin command must pass the exact Claude session identity.");
assert(!pluginCommand.includes("$ARGUMENTS"), "Plugin command must not pass raw slash-command text to a shell.");
assert(standaloneCommand.includes("$HOME/.claude/skills/claude-to-codex/scripts/claude-to-codex.mjs"), "Standalone command must use HOME install path.");
assert(standaloneCommand.includes(' --session "${CLAUDE_SESSION_ID}"'), "Standalone command must pass the exact Claude session identity.");
assert(!standaloneCommand.includes("$ARGUMENTS"), "Standalone command must not pass raw slash-command text to a shell.");
assert(script.includes("--codex-subagents"), "Launcher must support codex subagent budget.");
assert(script.includes("--check"), "Launcher must support self-check diagnostics.");
assert(script.includes("--codex-model"), "Launcher must support explicit Codex model selection.");
assert(script.includes("isFableToOpus48"), "Launcher must recognize Fable-to-Opus fallback transitions.");
assert(script.includes("# Claude to Codex"), "Launcher prompt must use the Claude to Codex title.");
assert(!script.includes("Claude to Claude"), "Launcher prompt must not include a duplicated Claude to Codex title.");
assert(script.includes("hot-context.md"), "Launcher must write and prioritize hot-context.md.");
assert(script.includes("git-snapshot.md"), "Launcher must write and prioritize git-snapshot.md.");
assert(script.includes("handoff.json"), "Launcher must write and prioritize handoff.json.");
assert(script.includes("Project Artifacts To Check"), "Hot context must include pointer-only project artifacts.");
assert(script.includes("Full diffs captured: no"), "Git snapshot must document no-full-diff policy.");
assert(script.includes("Deliberately Left Out"), "Hot context must document what is intentionally excluded.");
assert(script.includes("Do not expose secrets"), "Launcher prompt must include secret handling instruction.");
assert(!script.includes("<claude_transcript_digest>"), "Launcher must not embed transcript-derived digest text in the Codex argv prompt.");
assert(script.includes("Independent Policy Assessment"), "Launcher must require a policy-neutral target-model assessment.");
assert(script.includes("schemaVersion: 2"), "Launcher must emit the model-aware handoff schema.");
assert(script.includes("#!/usr/bin/env sh"), "Launcher must generate a portable POSIX-shell runner.");
assert(script.includes("packageDirectoryMode: \"0700\""), "Manifest must document private handoff permissions.");
assert(script.includes("CODEX_ARG_PROMPT_BYTE_LIMIT"), "Launcher must bound process-argument prompt size.");
assert(script.includes("collectGitSnapshot"), "Launcher must capture repository or workspace git state.");
assert(script.includes("sourcePolicyClaims"), "Launcher must track excluded source-model policy verdicts without transferring their text.");
assert(releaseWorkflow.includes("gh release create"), "Release workflow must create a GitHub release.");
assert(releaseWorkflow.includes("npm test"), "Release workflow must run tests before packing.");
assert(releaseWorkflow.includes("Verify release tag"), "Release workflow must guard tag/package version mismatch.");
assert(releaseWorkflow.includes("actions/checkout@v7"), "Release workflow must use the current checkout action runtime.");
assert(releaseWorkflow.includes("actions/setup-node@v6"), "Release workflow must use the current setup-node action runtime.");
assert(!releaseWorkflow.includes("apt-get install -y zsh"), "Release workflow must not install zsh for a POSIX-shell runner.");
assert(releasesDoc.includes(`git tag v${packageJson.version}`), "Release docs must explain tag-based release flow for the current package version.");

console.log("Validation passed.");
