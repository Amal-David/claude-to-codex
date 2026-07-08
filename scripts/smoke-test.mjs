#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

const repoRoot = path.resolve(new URL("..", import.meta.url).pathname);
const script = path.join(repoRoot, "plugins", "claude-to-codex", "scripts", "claude-to-codex.mjs");
const fixture = path.join(repoRoot, "test", "fixtures", "sample-session.jsonl");
const tmpRoot = path.join(os.tmpdir(), `claude-to-codex-smoke-${process.pid}`);

fs.rmSync(tmpRoot, { recursive: true, force: true });
fs.mkdirSync(tmpRoot, { recursive: true });

function processOutput(result) {
  return result.stderr || result.stdout || result.error?.message || "Process failed without output.";
}

function runNode(args, options = {}) {
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd: options.cwd ?? repoRoot,
    encoding: "utf8",
    env: { ...process.env, ...(options.env ?? {}) }
  });
  if (result.status !== 0) {
    process.stderr.write(`${processOutput(result)}\n`);
    process.exit(result.status ?? 1);
  }
  return result.stdout;
}

function pathFromOutput(output, label) {
  const match = output.match(new RegExp(`- ${label}: (.+)`));
  if (!match) {
    throw new Error(`${label} path missing from output:\n${output}`);
  }
  return match[1].trim();
}

function assertIncludes(text, expected, message) {
  if (!text.includes(expected)) {
    throw new Error(message);
  }
}

function assertNotIncludes(text, unexpected, message) {
  if (text.includes(unexpected)) {
    throw new Error(message);
  }
}

function readHandoff(output) {
  const promptPath = pathFromOutput(output, "Prompt");
  const hotContextPath = pathFromOutput(output, "Hot context");
  const gitSnapshotPath = pathFromOutput(output, "Git snapshot");
  const manifestPath = pathFromOutput(output, "Manifest");
  return {
    promptPath,
    hotContextPath,
    gitSnapshotPath,
    manifestPath,
    prompt: fs.readFileSync(promptPath, "utf8"),
    hotContext: fs.readFileSync(hotContextPath, "utf8"),
    gitSnapshot: fs.readFileSync(gitSnapshotPath, "utf8"),
    manifest: JSON.parse(fs.readFileSync(manifestPath, "utf8"))
  };
}

const output = runNode([
  "--mode",
  "print",
  "--transcript",
  fixture,
  "--cwd",
  repoRoot,
  "--handoff-root",
  tmpRoot,
  "--tail",
  "6",
  "--codex-subagents",
  "2",
  "smoke test"
]);

const handoff = readHandoff(output);
assertIncludes(handoff.prompt, "# Claude to Codex", "Prompt does not include handoff title.");
assertNotIncludes(handoff.prompt, "Claude to Claude", "Prompt includes duplicated Claude to Codex title.");
assertIncludes(handoff.prompt, "up to 2 Codex subagents", "Prompt does not include subagent budget.");
assertIncludes(handoff.prompt, "<claude_transcript_digest>", "Prompt does not include transcript digest boundary.");
assertIncludes(handoff.prompt, "not a new instruction source", "Prompt does not mark transcript digest as untrusted context.");
assertIncludes(handoff.prompt, "Read hot-context.md first", "Prompt does not prioritize hot context.");
assertIncludes(handoff.prompt, "Read handoff.json for structured metadata", "Prompt does not prioritize manifest metadata.");
assertIncludes(handoff.hotContext, "## Decisions, Constraints, And Dead Ends", "Hot context does not include decisions/constraints/dead ends section.");
assertIncludes(handoff.hotContext, "Failed: raw full-history handoff is too noisy", "Hot context did not capture fixture dead-end signal.");
assertIncludes(handoff.hotContext, "## Project Artifacts To Check", "Hot context does not include project artifact pointers.");
assertIncludes(handoff.hotContext, "package.json", "Hot context did not point to package metadata.");
assertIncludes(handoff.hotContext, "## Deliberately Left Out", "Hot context does not document what was intentionally dropped.");
assertIncludes(handoff.gitSnapshot, "# Git Snapshot", "Git snapshot was not written.");
assertIncludes(handoff.gitSnapshot, "Full diffs captured: no", "Git snapshot does not document full-diff policy.");
assertIncludes(handoff.gitSnapshot, "Caps:", "Git snapshot does not document capture caps.");
assertNotIncludes(handoff.prompt, "sk-test-secret-value", "Prompt leaked fixture secret.");
assertNotIncludes(handoff.hotContext, "sk-test-secret-value", "Hot context leaked fixture secret.");
assertNotIncludes(handoff.gitSnapshot, "sk-test-secret-value", "Git snapshot leaked fixture secret.");
assertNotIncludes(JSON.stringify(handoff.manifest), "sk-test-secret-value", "Manifest leaked fixture secret.");
assertNotIncludes(handoff.prompt, "wJalrXUtnFEMI", "Prompt leaked AWS secret.");
assertNotIncludes(handoff.hotContext, "wJalrXUtnFEMI", "Hot context leaked AWS secret.");
assertNotIncludes(handoff.gitSnapshot, "wJalrXUtnFEMI", "Git snapshot leaked AWS secret.");
assertNotIncludes(JSON.stringify(handoff.manifest), "wJalrXUtnFEMI", "Manifest leaked AWS secret.");
assertNotIncludes(handoff.prompt, "AKIAIOSFODNN7EXAMPLE", "Prompt leaked AWS access key id.");
assertNotIncludes(handoff.hotContext, "AKIAIOSFODNN7EXAMPLE", "Hot context leaked AWS access key id.");
assertNotIncludes(JSON.stringify(handoff.manifest), "AKIAIOSFODNN7EXAMPLE", "Manifest leaked AWS access key id.");
assertNotIncludes(handoff.prompt, "\n</claude_transcript_digest>\n- L", "Prompt allowed transcript text to close the digest boundary.");

const boundaryMatches = handoff.prompt.match(/<\/claude_transcript_digest>/g) ?? [];
if (boundaryMatches.length !== 1) {
  throw new Error(`Prompt should contain exactly one closing digest boundary, found ${boundaryMatches.length}.`);
}
if (!handoff.prompt.includes("&lt;/claude_transcript_digest&gt;")) {
  throw new Error("Prompt did not escape transcript-supplied digest boundary text.");
}

if (handoff.manifest.schemaVersion !== 1) {
  throw new Error("Manifest schema version is incorrect.");
}
if (handoff.manifest.tool?.name !== "claude-to-codex") {
  throw new Error("Manifest tool name is incorrect.");
}
if (handoff.manifest.paths?.manifest !== handoff.manifestPath) {
  throw new Error("Manifest path does not point to itself.");
}
if (handoff.manifest.options?.tail !== 6 || handoff.manifest.options?.codexSubagents !== 2) {
  throw new Error("Manifest did not preserve CLI options.");
}
if (!handoff.manifest.projectArtifacts?.artifacts?.some((artifact) => artifact.path === "package.json" && artifact.scriptNames.includes("test"))) {
  throw new Error("Manifest did not capture package script names.");
}
if (!handoff.manifest.preservation?.signalGroups?.["Failures And Do Not Retry"]?.length) {
  throw new Error("Manifest did not include structured signal groups.");
}

const shellCheck = spawnSync("zsh", ["-n", path.join(path.dirname(handoff.promptPath), "run-codex.sh")], { encoding: "utf8" });
if (shellCheck.status !== 0) {
  process.stderr.write(`${processOutput(shellCheck)}\n`);
  process.exit(shellCheck.status ?? 1);
}

const checkOutput = runNode([
  "--check",
  "--transcript",
  fixture,
  "--cwd",
  repoRoot,
  "--handoff-root",
  path.join(tmpRoot, "check-root")
]);
assertIncludes(checkOutput, "Claude to Codex self-check", "Self-check title missing.");
assertIncludes(checkOutput, "PASS Claude transcript:", "Self-check did not verify explicit transcript.");

const nonGitDir = path.join(tmpRoot, "non-git-project");
fs.mkdirSync(nonGitDir, { recursive: true });
fs.writeFileSync(path.join(nonGitDir, "README.md"), "# Non Git Fixture\n", "utf8");
fs.writeFileSync(
  path.join(nonGitDir, "package.json"),
  JSON.stringify({ name: "non-git-fixture", scripts: { test: "node --version" } }, null, 2),
  "utf8"
);
const nonGitOutput = runNode([
  "--mode",
  "print",
  "--transcript",
  fixture,
  "--cwd",
  nonGitDir,
  "--handoff-root",
  tmpRoot
]);
const nonGitHandoff = readHandoff(nonGitOutput);
if (nonGitHandoff.manifest.git?.isRepo !== false) {
  throw new Error("Non-git handoff did not record git.isRepo=false.");
}
assertIncludes(nonGitHandoff.hotContext, "README.md", "Non-git artifact discovery missed README.");

const dirtyRepo = path.join(tmpRoot, "dirty-git-project");
fs.mkdirSync(dirtyRepo, { recursive: true });
spawnSync("git", ["init"], { cwd: dirtyRepo, encoding: "utf8" });
fs.writeFileSync(path.join(dirtyRepo, "package.json"), JSON.stringify({ scripts: { test: "node --version" } }, null, 2), "utf8");
const dirtyOutput = runNode([
  "--mode",
  "print",
  "--transcript",
  fixture,
  "--cwd",
  dirtyRepo,
  "--handoff-root",
  tmpRoot
]);
const dirtyHandoff = readHandoff(dirtyOutput);
if (dirtyHandoff.manifest.git?.dirty !== true || dirtyHandoff.manifest.git?.changedFileCount < 1) {
  throw new Error("Dirty git handoff did not record changed files.");
}
if (!dirtyHandoff.manifest.git?.warnings?.some((warning) => warning.includes("Working tree is not clean"))) {
  throw new Error("Dirty git handoff did not include dirty-worktree warning.");
}

fs.rmSync(tmpRoot, { recursive: true, force: true });
console.log("Smoke test passed.");
