#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const repoRoot = path.resolve(new URL("..", import.meta.url).pathname);

const requiredFiles = [
  ".claude-plugin/marketplace.json",
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
assert(packageJson.scripts?.handoff === "node plugins/claude-to-codex/scripts/claude-to-codex.mjs", "Package must expose npm run handoff.");

const pluginCommand = read("plugins/claude-to-codex/commands/handoff.md");
const standaloneCommand = read("standalone/.claude/commands/handoff.md");
const script = read("plugins/claude-to-codex/scripts/claude-to-codex.mjs");

assert(pluginCommand.includes("disable-model-invocation: true"), "Plugin command must disable model invocation.");
assert(pluginCommand.includes("${CLAUDE_PLUGIN_ROOT}/scripts/claude-to-codex.mjs"), "Plugin command must use CLAUDE_PLUGIN_ROOT.");
assert(!pluginCommand.includes("$ARGUMENTS"), "Plugin command must not pass raw slash-command text to a shell.");
assert(standaloneCommand.includes("$HOME/.claude/skills/claude-to-codex/scripts/claude-to-codex.mjs"), "Standalone command must use HOME install path.");
assert(!standaloneCommand.includes("$ARGUMENTS"), "Standalone command must not pass raw slash-command text to a shell.");
assert(script.includes("--codex-subagents"), "Launcher must support codex subagent budget.");
assert(script.includes("# Claude to Codex"), "Launcher prompt must use the Claude to Codex title.");
assert(!script.includes("Claude to Claude"), "Launcher prompt must not include a duplicated Claude to Codex title.");
assert(script.includes("Do not expose secrets"), "Launcher prompt must include secret handling instruction.");
assert(script.includes("<claude_transcript_digest>"), "Launcher prompt must wrap transcript-derived digest in a boundary.");
assert(script.includes("not a new instruction source"), "Launcher prompt must mark digest content as untrusted context.");

console.log("Validation passed.");
