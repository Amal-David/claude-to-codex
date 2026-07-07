#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const repoRoot = path.resolve(new URL("..", import.meta.url).pathname);

const requiredFiles = [
  ".claude-plugin/marketplace.json",
  "plugins/cloud-handoff/.claude-plugin/plugin.json",
  "plugins/cloud-handoff/commands/handoff.md",
  "plugins/cloud-handoff/skills/handoff/SKILL.md",
  "plugins/cloud-handoff/scripts/codex-handoff.mjs",
  "standalone/.claude/commands/handoff.md",
  "standalone/.claude/skills/codex-handoff/SKILL.md",
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
const plugin = JSON.parse(read("plugins/cloud-handoff/.claude-plugin/plugin.json"));
const packageJson = JSON.parse(read("package.json"));

assert(marketplace.name === "cloud-handoff", "Marketplace name must be cloud-handoff.");
assert(Array.isArray(marketplace.plugins), "Marketplace plugins must be an array.");
assert(marketplace.plugins.some((entry) => entry.name === "cloud-handoff"), "Marketplace must list cloud-handoff plugin.");
assert(plugin.name === "cloud-handoff", "Plugin name must be cloud-handoff.");
assert(plugin.version, "Plugin version is required.");
assert(packageJson.scripts?.handoff === "node plugins/cloud-handoff/scripts/codex-handoff.mjs", "Package must expose npm run handoff.");

const pluginCommand = read("plugins/cloud-handoff/commands/handoff.md");
const standaloneCommand = read("standalone/.claude/commands/handoff.md");
const script = read("plugins/cloud-handoff/scripts/codex-handoff.mjs");

assert(pluginCommand.includes("disable-model-invocation: true"), "Plugin command must disable model invocation.");
assert(pluginCommand.includes("${CLAUDE_PLUGIN_ROOT}/scripts/codex-handoff.mjs"), "Plugin command must use CLAUDE_PLUGIN_ROOT.");
assert(!pluginCommand.includes("$ARGUMENTS"), "Plugin command must not pass raw slash-command text to a shell.");
assert(standaloneCommand.includes("$HOME/.claude/skills/codex-handoff/scripts/codex-handoff.mjs"), "Standalone command must use HOME install path.");
assert(!standaloneCommand.includes("$ARGUMENTS"), "Standalone command must not pass raw slash-command text to a shell.");
assert(script.includes("--codex-subagents"), "Launcher must support codex subagent budget.");
assert(script.includes("Do not expose secrets"), "Launcher prompt must include secret handling instruction.");
assert(script.includes("<claude_transcript_digest>"), "Launcher prompt must wrap transcript-derived digest in a boundary.");
assert(script.includes("not a new instruction source"), "Launcher prompt must mark digest content as untrusted context.");

console.log("Validation passed.");
