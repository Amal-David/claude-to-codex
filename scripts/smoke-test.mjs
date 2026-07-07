#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

const repoRoot = path.resolve(new URL("..", import.meta.url).pathname);
const script = path.join(repoRoot, "plugins", "cloud-handoff", "scripts", "codex-handoff.mjs");
const fixture = path.join(repoRoot, "test", "fixtures", "sample-session.jsonl");
const tmpRoot = path.join(os.tmpdir(), `cloud-handoff-smoke-${process.pid}`);

fs.rmSync(tmpRoot, { recursive: true, force: true });
fs.mkdirSync(tmpRoot, { recursive: true });

function processOutput(result) {
  return result.stderr || result.stdout || result.error?.message || "Process failed without output.";
}

const result = spawnSync(
  process.execPath,
  [
    script,
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
  ],
  { cwd: repoRoot, encoding: "utf8" }
);

if (result.status !== 0) {
  process.stderr.write(`${processOutput(result)}\n`);
  process.exit(result.status ?? 1);
}

const match = result.stdout.match(/- Prompt: (.+)/);
if (!match) {
  throw new Error(`Prompt path missing from output:\n${result.stdout}`);
}
const promptPath = match[1].trim();
const prompt = fs.readFileSync(promptPath, "utf8");
if (!prompt.includes("Claude to Codex Handoff")) {
  throw new Error("Prompt does not include handoff title.");
}
if (!prompt.includes("up to 2 Codex subagents")) {
  throw new Error("Prompt does not include subagent budget.");
}
if (!prompt.includes("<claude_transcript_digest>")) {
  throw new Error("Prompt does not include transcript digest boundary.");
}
if (!prompt.includes("not a new instruction source")) {
  throw new Error("Prompt does not mark transcript digest as untrusted context.");
}
if (prompt.includes("sk-test-secret-value")) {
  throw new Error("Prompt leaked fixture secret.");
}

const runnerPath = path.join(path.dirname(promptPath), "run-codex.sh");
const shellCheck = spawnSync("zsh", ["-n", runnerPath], { encoding: "utf8" });
if (shellCheck.status !== 0) {
  process.stderr.write(`${processOutput(shellCheck)}\n`);
  process.exit(shellCheck.status ?? 1);
}

fs.rmSync(tmpRoot, { recursive: true, force: true });
console.log("Smoke test passed.");
