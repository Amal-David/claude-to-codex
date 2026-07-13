#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const skillDirectory = path.join(repoRoot, "plugins", "claude-to-codex", "skills", "handoff");
const script = path.join(skillDirectory, "scripts", "claude-to-codex.mjs");
const installer = path.join(repoRoot, "scripts", "install-standalone.mjs");
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

function runNodeFailure(args, options = {}) {
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd: options.cwd ?? repoRoot,
    encoding: "utf8",
    env: { ...process.env, ...(options.env ?? {}) }
  });
  if (result.status === 0) {
    throw new Error(`Expected command to fail: ${args.join(" ")}`);
  }
  return processOutput(result);
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
  const digestPath = pathFromOutput(output, "Digest");
  const manifestPath = pathFromOutput(output, "Manifest");
  const runnerPath = pathFromOutput(output, "Runner");
  return {
    promptPath,
    hotContextPath,
    gitSnapshotPath,
    digestPath,
    manifestPath,
    runnerPath,
    directory: path.dirname(manifestPath),
    prompt: fs.readFileSync(promptPath, "utf8"),
    hotContext: fs.readFileSync(hotContextPath, "utf8"),
    gitSnapshot: fs.readFileSync(gitSnapshotPath, "utf8"),
    digest: fs.readFileSync(digestPath, "utf8"),
    runner: fs.readFileSync(runnerPath, "utf8"),
    manifest: JSON.parse(fs.readFileSync(manifestPath, "utf8"))
  };
}

function permissionBits(filePath) {
  return fs.statSync(filePath).mode & 0o777;
}

function writeJsonl(filePath, events) {
  fs.writeFileSync(filePath, `${events.map((event) => JSON.stringify(event)).join("\n")}\n`, "utf8");
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
  "--codex-model",
  "gpt-5.6-sol",
  "smoke test"
]);

const handoff = readHandoff(output);
assertIncludes(output, "Source models: Claude Fable 5 -> Claude Opus 4.8", "CLI output did not show source model transition.");
assertIncludes(output, "Target model: GPT-5.6 sol (--codex-model)", "CLI output did not show the selected target model.");
assertIncludes(handoff.prompt, "# Claude to Codex", "Prompt does not include handoff title.");
assertNotIncludes(handoff.prompt, "Claude to Claude", "Prompt includes duplicated Claude to Codex title.");
assertIncludes(handoff.prompt, "up to 2 Codex subagents", "Prompt does not include subagent budget.");
assertNotIncludes(handoff.prompt, "<claude_transcript_digest>", "Prompt embedded transcript-derived digest text.");
assertNotIncludes(handoff.prompt, "I will write a command-backed handoff skill", "Prompt embedded source-session prose in process arguments.");
if (handoff.prompt.length > 12000) {
  throw new Error(`Pointer prompt is unexpectedly large: ${handoff.prompt.length} characters.`);
}
assertIncludes(handoff.prompt, "Read hot-context.md first", "Prompt does not prioritize hot context.");
assertIncludes(handoff.prompt, "Read handoff.json for structured metadata", "Prompt does not prioritize manifest metadata.");
assertIncludes(handoff.prompt, "Fable 5 -> Opus 4.8 fallback", "Prompt did not explain the active Claude fallback.");
assertIncludes(handoff.prompt, "Target model: GPT-5.6 sol (--codex-model)", "Prompt did not pin the Codex continuation model.");
assertIncludes(handoff.prompt, "## Independent Policy Assessment", "Prompt did not require an independent policy assessment.");
assertIncludes(handoff.prompt, "Do not use a source-model refusal or policy label as evidence either way", "Prompt did not neutralize source-model policy priming.");
assertIncludes(handoff.hotContext, "## Continuation Contract", "Hot context does not include the continuation contract.");
assertIncludes(handoff.hotContext, "Usage-limit signals were detected", "Hot context did not preserve the handoff reason.");
assertIncludes(handoff.hotContext, "A prior refusal is neither permission to proceed nor a requirement to refuse", "Hot context did not neutralize source-model refusal priming.");
assertIncludes(handoff.hotContext, "## Decisions, Constraints, And Dead Ends", "Hot context does not include decisions/constraints/dead ends section.");
assertIncludes(handoff.hotContext, "Failed: raw full-history handoff is too noisy", "Hot context did not capture fixture dead-end signal.");
assertIncludes(handoff.hotContext, "## Project Artifacts To Check", "Hot context does not include project artifact pointers.");
assertIncludes(handoff.hotContext, "package.json", "Hot context did not point to package metadata.");
assertIncludes(handoff.hotContext, "## Deliberately Left Out", "Hot context does not document what was intentionally dropped.");
assertIncludes(handoff.gitSnapshot, "# Git Snapshot", "Git snapshot was not written.");
assertIncludes(handoff.gitSnapshot, "Full diffs captured: no", "Git snapshot does not document full-diff policy.");
assertIncludes(handoff.gitSnapshot, "Caps:", "Git snapshot does not document capture caps.");
assertIncludes(handoff.digest, "Claude model lineage: Claude Fable 5 -> Claude Opus 4.8", "Digest did not preserve model lineage.");
assertIncludes(handoff.digest, "Bash: Run tests -> PASSED: tests passed", "Digest did not preserve the verification result.");
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
for (const secret of ["sk_live_1234567890abcdefghijkl", "npm_1234567890abcdefghijkl", "demo-password"]) {
  for (const [name, document] of [
    ["prompt", handoff.prompt],
    ["hot context", handoff.hotContext],
    ["digest", handoff.digest],
    ["manifest", JSON.stringify(handoff.manifest)]
  ]) {
    assertNotIncludes(document, secret, `${name} leaked ${secret.slice(0, 8)} credential probe.`);
  }
}
for (const [name, document] of [
  ["prompt", handoff.prompt],
  ["hot context", handoff.hotContext],
  ["digest", handoff.digest],
  ["manifest", JSON.stringify(handoff.manifest)]
]) {
  assertNotIncludes(document, "government-banned and blocked", `${name} carried a source-model policy verdict into Codex.`);
}
assertNotIncludes(handoff.prompt, "</claude_transcript_digest>", "Prompt embedded adversarial transcript boundary text.");

if (handoff.manifest.schemaVersion !== 2) {
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
if (handoff.manifest.handoff?.reason?.kind !== "usage-limit" || handoff.manifest.handoff?.reason?.activeFableFallback !== true) {
  throw new Error("Manifest did not classify the Fable-to-Opus usage-limit handoff.");
}
if (handoff.manifest.handoff?.target?.model !== "gpt-5.6-sol" || handoff.manifest.handoff?.target?.modelSource !== "--codex-model") {
  throw new Error("Manifest did not preserve the target Codex model.");
}
if (handoff.manifest.handoff?.source?.firstModel !== "claude-fable-5" || handoff.manifest.handoff?.source?.latestModel !== "claude-opus-4-8") {
  throw new Error("Manifest did not preserve the source model lineage.");
}
if (handoff.manifest.transcript?.streamed !== true || handoff.manifest.transcript?.parseErrorCount !== 0) {
  throw new Error("Manifest did not record healthy streaming transcript analysis.");
}
if (!/^[a-f0-9]{64}$/.test(handoff.manifest.transcript?.sha256 ?? "")) {
  throw new Error("Manifest did not fingerprint the captured transcript.");
}
if (handoff.manifest.transcript?.sourcePolicyClaimCount !== 1) {
  throw new Error("Manifest did not record the excluded source-model policy claim count.");
}
if (!handoff.manifest.projectArtifacts?.artifacts?.some((artifact) => artifact.path === "package.json" && artifact.scriptNames.includes("test"))) {
  throw new Error("Manifest did not capture package script names.");
}
if (!handoff.manifest.preservation?.signalGroups?.["Failures And Do Not Retry"]?.length) {
  throw new Error("Manifest did not include structured signal groups.");
}
if (!handoff.manifest.preservation?.verificationTools?.some((item) => item.text.includes("tests passed") && item.status === "passed")) {
  throw new Error("Manifest did not preserve verification command output.");
}

assertIncludes(handoff.runner, "#!/usr/bin/env sh", "Runner is not POSIX-shell based.");
assertIncludes(handoff.runner, "-m 'gpt-5.6-sol'", "Runner did not pin the requested Codex model.");
if (permissionBits(handoff.directory) !== 0o700) {
  throw new Error("Handoff directory is not private (0700).");
}
for (const privateFile of [handoff.promptPath, handoff.hotContextPath, handoff.gitSnapshotPath, handoff.digestPath, handoff.manifestPath]) {
  if (permissionBits(privateFile) !== 0o600) {
    throw new Error(`Handoff file is not private (0600): ${privateFile}`);
  }
}
if (permissionBits(handoff.runnerPath) !== 0o700) {
  throw new Error("Handoff runner is not private/executable (0700).");
}

const shellCheck = spawnSync("sh", ["-n", handoff.runnerPath], { encoding: "utf8" });
if (shellCheck.status !== 0) {
  process.stderr.write(`${processOutput(shellCheck)}\n`);
  process.exit(shellCheck.status ?? 1);
}

const skillsCliInstall = path.join(tmpRoot, "skills-cli-install", "handoff");
fs.cpSync(skillDirectory, skillsCliInstall, { recursive: true });
const skillsCliScript = path.join(skillsCliInstall, "scripts", "claude-to-codex.mjs");
const skillsCliResult = spawnSync(process.execPath, [skillsCliScript, "--help"], {
  cwd: repoRoot,
  encoding: "utf8"
});
if (skillsCliResult.status !== 0) {
  throw new Error(`Self-contained skill launcher failed: ${processOutput(skillsCliResult)}`);
}
assertIncludes(
  skillsCliResult.stdout,
  "Slash command usage: /handoff",
  "A copied Skills CLI installation did not include a runnable launcher."
);

const installHome = path.join(tmpRoot, "install-home");
const existingCommand = path.join(installHome, ".claude", "commands", "handoff.md");
fs.mkdirSync(path.dirname(existingCommand), { recursive: true });
fs.writeFileSync(existingCommand, "existing user command\n", "utf8");
const installResult = spawnSync(process.execPath, [installer], {
  cwd: repoRoot,
  encoding: "utf8",
  env: { ...process.env, HOME: installHome }
});
if (installResult.status !== 0) {
  throw new Error(`Standalone installer failed: ${processOutput(installResult)}`);
}
const installedScript = path.join(installHome, ".claude", "skills", "claude-to-codex", "scripts", "claude-to-codex.mjs");
assertIncludes(fs.readFileSync(existingCommand, "utf8"), "CLAUDE_SESSION_ID", "Standalone installer did not install the exact-session slash command.");
assertIncludes(fs.readFileSync(installedScript, "utf8"), 'const TOOL_VERSION = "0.2.0"', "Standalone installer copied the wrong launcher version.");
if (permissionBits(installedScript) !== 0o755) {
  throw new Error("Standalone installer did not make its launcher executable.");
}
const commandBackups = fs.readdirSync(path.dirname(existingCommand)).filter((name) => name.startsWith("handoff.md.backup-"));
if (commandBackups.length !== 1 || fs.readFileSync(path.join(path.dirname(existingCommand), commandBackups[0]), "utf8") !== "existing user command\n") {
  throw new Error("Standalone installer did not preserve the pre-existing command in a backup.");
}

const fakeBin = path.join(tmpRoot, "fake-bin");
const fakeCodex = path.join(fakeBin, "codex");
fs.mkdirSync(fakeBin, { recursive: true });
fs.symlinkSync("/usr/bin/true", fakeCodex);
const checkOutput = runNode(
  [
    "--check",
    "--transcript",
    fixture,
    "--cwd",
    repoRoot,
    "--handoff-root",
    path.join(tmpRoot, "check-root"),
    "--model",
    "gpt-5.6-sol"
  ],
  { env: { PATH: `${fakeBin}${path.delimiter}${process.env.PATH}` } }
);
assertIncludes(checkOutput, "Claude to Codex self-check", "Self-check title missing.");
assertIncludes(checkOutput, "PASS Claude transcript:", "Self-check did not verify explicit transcript.");
assertIncludes(checkOutput, "PASS Codex authentication: authenticated", "Self-check did not verify Codex authentication.");
assertIncludes(checkOutput, "PASS Codex target configuration: GPT-5.6 sol via --codex-model", "Self-check did not resolve the target model configuration.");

const fakeTmux = path.join(fakeBin, "tmux");
fs.symlinkSync("/usr/bin/true", fakeTmux);
fs.unlinkSync(fakeCodex);
fs.symlinkSync("/usr/bin/false", fakeCodex);
const authFailureOutput = runNode(
  ["--mode", "tmux", "--transcript", fixture, "--cwd", repoRoot, "--handoff-root", tmpRoot, "--codex-model", "gpt-5.6-sol"],
  { env: { PATH: `${fakeBin}${path.delimiter}${process.env.PATH}`, TMUX: "fixture" } }
);
assertIncludes(authFailureOutput, "Launch: not started (Codex authentication is not ready", "Unauthenticated Codex launch did not fail before dispatch.");
fs.unlinkSync(fakeCodex);
fs.symlinkSync("/usr/bin/true", fakeCodex);
const dispatchedOutput = runNode(
  ["--mode", "tmux", "--transcript", fixture, "--cwd", repoRoot, "--handoff-root", tmpRoot, "--codex-model", "gpt-5.6-sol"],
  { env: { PATH: `${fakeBin}${path.delimiter}${process.env.PATH}`, TMUX: "fixture" } }
);
assertIncludes(dispatchedOutput, "launch command dispatched", `Successful launcher did not use truthful dispatch wording:\n${dispatchedOutput}`);

const codexHome = path.join(tmpRoot, "codex-home");
fs.mkdirSync(codexHome, { recursive: true });
fs.writeFileSync(path.join(codexHome, "config.toml"), 'model = "gpt-5.6-sol"\n', "utf8");
const configuredModelOutput = runNode(
  ["--mode", "print", "--transcript", fixture, "--cwd", repoRoot, "--handoff-root", tmpRoot],
  { env: { CODEX_HOME: codexHome, CLAUDE_TO_CODEX_MODEL: "" } }
);
const configuredModelHandoff = readHandoff(configuredModelOutput);
if (
  configuredModelHandoff.manifest.handoff?.target?.model !== "gpt-5.6-sol" ||
  configuredModelHandoff.manifest.handoff?.target?.modelSource !== path.join(codexHome, "config.toml")
) {
  throw new Error("Zero-argument handoff did not resolve the configured GPT-5.6 Codex model.");
}

const malformedFixture = path.join(tmpRoot, "malformed-session.jsonl");
fs.writeFileSync(malformedFixture, `${fs.readFileSync(fixture, "utf8").trim()}\n{not-json}\n`, "utf8");
const malformedOutput = runNode([
  "--mode",
  "print",
  "--transcript",
  malformedFixture,
  "--cwd",
  repoRoot,
  "--handoff-root",
  tmpRoot,
  "--model",
  "gpt-5.6-sol"
]);
const malformedHandoff = readHandoff(malformedOutput);
if (malformedHandoff.manifest.transcript?.parseErrorCount !== 1) {
  throw new Error("Malformed JSONL line was not surfaced in the manifest.");
}
assertIncludes(malformedHandoff.hotContext, "1 malformed JSONL line", "Malformed JSONL warning was not surfaced in hot context.");
assertIncludes(malformedOutput, "Transcript warning: 1 malformed JSONL line", "Malformed JSONL warning was not surfaced in CLI output.");

const largeTailFixture = path.join(tmpRoot, "large-tail-session.jsonl");
writeJsonl(
  largeTailFixture,
  Array.from({ length: 210 }, (_, index) => ({
    type: index % 2 === 0 ? "user" : "assistant",
    timestamp: `2026-07-08T03:${String(Math.floor(index / 60)).padStart(2, "0")}:${String(index % 60).padStart(2, "0")}Z`,
    message: {
      role: index % 2 === 0 ? "user" : "assistant",
      model: index % 2 === 0 ? undefined : "claude-opus-4-8",
      content: `Long handoff entry ${index}: ${"bounded-on-disk-context ".repeat(90)}`
    }
  }))
);
const largeTailOutput = runNode([
  "--mode",
  "print",
  "--transcript",
  largeTailFixture,
  "--cwd",
  repoRoot,
  "--handoff-root",
  tmpRoot,
  "--tail",
  "200",
  "--codex-model",
  "gpt-5.6-sol"
]);
const largeTailHandoff = readHandoff(largeTailOutput);
if (Buffer.byteLength(largeTailHandoff.prompt, "utf8") > 24 * 1024) {
  throw new Error("Maximum-tail handoff exceeded the bounded Codex argv prompt limit.");
}
if (Buffer.byteLength(largeTailHandoff.digest, "utf8") < 100_000) {
  throw new Error("Maximum-tail fixture did not exercise a large on-disk digest.");
}

const evidenceFixture = path.join(tmpRoot, "verification-evidence-session.jsonl");
writeJsonl(evidenceFixture, [
  { type: "user", uuid: "ev-u1", parentUuid: null, timestamp: "2026-07-08T04:00:00Z", message: { role: "user", content: "Run the required tests." } },
  {
    type: "assistant",
    uuid: "ev-a1",
    parentUuid: "ev-u1",
    timestamp: "2026-07-08T04:00:01Z",
    message: { role: "assistant", model: "claude-opus-4-8", content: [{ type: "tool_use", id: "test-failed", name: "Bash", input: { description: "Run failing tests", command: "npm test" } }] }
  },
  {
    type: "user",
    uuid: "ev-u2",
    parentUuid: "ev-a1",
    timestamp: "2026-07-08T04:00:02Z",
    message: { role: "user", content: [{ type: "tool_result", tool_use_id: "test-failed", is_error: true, content: "1 test failed" }] },
    toolUseResult: { status: "failed", exitCode: 1 }
  },
  {
    type: "assistant",
    uuid: "ev-a2",
    parentUuid: "ev-u2",
    timestamp: "2026-07-08T04:00:03Z",
    message: { role: "assistant", model: "claude-opus-4-8", content: [{ type: "tool_use", id: "test-pending", name: "Bash", input: { description: "Run pending tests", command: "npm test -- --watch" } }] }
  },
  {
    type: "attachment",
    parentUuid: "ev-a2",
    timestamp: "2026-07-08T04:00:04Z",
    attachment: { type: "task-reminder", itemCount: 2, content: "ATTACHMENT CONTENT MUST NOT TRANSFER" }
  },
  { type: "last-prompt", leafUuid: "ev-a2", lastPrompt: "Continue" }
]);
const evidenceOutput = runNode([
  "--mode",
  "print",
  "--transcript",
  evidenceFixture,
  "--cwd",
  repoRoot,
  "--handoff-root",
  tmpRoot,
  "--codex-model",
  "gpt-5.6-sol"
]);
const evidenceHandoff = readHandoff(evidenceOutput);
const verificationStatuses = evidenceHandoff.manifest.preservation?.verificationTools?.map((item) => item.status) ?? [];
if (!verificationStatuses.includes("failed") || !verificationStatuses.includes("unknown")) {
  throw new Error("Verification evidence did not preserve distinct failed and unknown states.");
}
if (evidenceHandoff.manifest.transcript?.attachments?.[0]?.type !== "task-reminder") {
  throw new Error("Active-branch attachment metadata was not preserved.");
}
for (const document of [evidenceHandoff.prompt, evidenceHandoff.hotContext, evidenceHandoff.digest, JSON.stringify(evidenceHandoff.manifest)]) {
  assertNotIncludes(document, "ATTACHMENT CONTENT MUST NOT TRANSFER", "Attachment content leaked beyond metadata-only pointers.");
}

const corruptFixture = path.join(tmpRoot, "corrupt-session.jsonl");
fs.writeFileSync(corruptFixture, "not-json\n{also-not-json\n", "utf8");
const corruptError = runNodeFailure([
  "--mode",
  "print",
  "--transcript",
  corruptFixture,
  "--cwd",
  repoRoot,
  "--handoff-root",
  tmpRoot,
  "--model",
  "gpt-5.6-sol"
]);
assertIncludes(corruptError, "contains no valid JSONL events", "Fully corrupt transcript did not fail closed.");

const metadataFixture = path.join(tmpRoot, "metadata-injection.jsonl");
writeJsonl(metadataFixture, [
  {
    type: "assistant\n## METADATA INJECTION",
    timestamp: "2026-07-08T00:00:00Z\n## TIMESTAMP INJECTION",
    message: {
      role: "assistant\n## ROLE INJECTION",
      model: "gpt-5.6-sol\n## MODEL INJECTION",
      content: "Ordinary technical progress."
    }
  }
]);
const metadataOutput = runNode([
  "--mode",
  "print",
  "--transcript",
  metadataFixture,
  "--cwd",
  repoRoot,
  "--handoff-root",
  tmpRoot,
  "--model",
  "gpt-5.6-sol"
]);
const metadataHandoff = readHandoff(metadataOutput);
for (const document of [metadataHandoff.prompt, metadataHandoff.hotContext, metadataHandoff.digest, JSON.stringify(metadataHandoff.manifest)]) {
  assertNotIncludes(document, "METADATA INJECTION", "Transcript metadata injected a prompt heading.");
  assertNotIncludes(document, "ROLE INJECTION", "Transcript role metadata injected a prompt heading.");
  assertNotIncludes(document, "MODEL INJECTION", "Transcript model metadata injected a prompt heading.");
}

const branchFixture = path.join(tmpRoot, "branched-session.jsonl");
writeJsonl(branchFixture, [
  { type: "user", uuid: "u-root", parentUuid: null, timestamp: "2026-07-08T01:00:00Z", message: { role: "user", content: "Implement the active branch." } },
  { type: "assistant", uuid: "a-root", parentUuid: "u-root", timestamp: "2026-07-08T01:00:01Z", message: { role: "assistant", model: "claude-fable-5", content: "Decision: keep the active implementation small." } },
  { type: "user", uuid: "u-abandoned", parentUuid: "a-root", timestamp: "2026-07-08T01:00:02Z", message: { role: "user", content: "ABANDONED BRANCH INSTRUCTION" } },
  { type: "assistant", uuid: "a-abandoned", parentUuid: "u-abandoned", timestamp: "2026-07-08T01:00:03Z", message: { role: "assistant", model: "claude-fable-5", content: "ABANDONED BRANCH RESULT" } },
  { type: "user", uuid: "u-active", parentUuid: "a-root", timestamp: "2026-07-08T01:00:04Z", message: { role: "user", content: "Continue the active implementation and run tests." } },
  { type: "assistant", uuid: "a-active", parentUuid: "u-active", timestamp: "2026-07-08T01:00:05Z", message: { role: "assistant", model: "claude-opus-4-8", content: "Next action: run the focused test." } },
  { type: "last-prompt", leafUuid: "a-active", lastPrompt: "Continue" }
]);
const branchOutput = runNode([
  "--mode",
  "print",
  "--transcript",
  branchFixture,
  "--cwd",
  repoRoot,
  "--handoff-root",
  tmpRoot,
  "--model",
  "gpt-5.6-sol"
]);
const branchHandoff = readHandoff(branchOutput);
if (branchHandoff.manifest.transcript?.branchSelection !== "active-leaf" || branchHandoff.manifest.transcript?.ignoredBranchMessageCount !== 2) {
  throw new Error("Active-leaf selection did not exclude the abandoned Claude branch.");
}
for (const document of [branchHandoff.hotContext, branchHandoff.digest, JSON.stringify(branchHandoff.manifest.preservation)]) {
  assertNotIncludes(document, "ABANDONED BRANCH", "Abandoned Claude branch leaked into continuation context.");
}
assertIncludes(branchOutput, "ignored 2 rewound or abandoned message", "CLI did not report excluded branch messages.");

const refusalFallbackFixture = path.join(tmpRoot, "refusal-fallback-session.jsonl");
writeJsonl(refusalFallbackFixture, [
  { type: "user", uuid: "rf-u1", parentUuid: null, timestamp: "2026-07-08T02:00:00Z", message: { role: "user", content: "Continue the repository task." } },
  { type: "assistant", uuid: "rf-a1", parentUuid: "rf-u1", timestamp: "2026-07-08T02:00:01Z", message: { role: "assistant", model: "claude-fable-5", content: "I am reviewing the technical state." } },
  {
    type: "assistant",
    uuid: "rf-a2",
    parentUuid: "rf-a1",
    timestamp: "2026-07-08T02:00:02Z",
    message: {
      role: "assistant",
      model: "claude-opus-4-8",
      content: [{ type: "fallback", from: { model: "claude-fable-5" }, to: { model: "claude-opus-4-8" } }]
    }
  },
  {
    type: "system",
    subtype: "model_refusal_fallback",
    uuid: "rf-s1",
    parentUuid: "rf-a2",
    timestamp: "2026-07-08T02:00:03Z",
    originalModel: "claude-fable-5",
    fallbackModel: "claude-opus-4-8",
    trigger: "refusal",
    apiRefusalCategory: "government-banned",
    apiRefusalExplanation: "SOURCE POLICY VERDICT MUST NOT TRANSFER",
    content: "SOURCE POLICY VERDICT MUST NOT TRANSFER"
  },
  { type: "user", uuid: "rf-u2", parentUuid: "rf-s1", timestamp: "2026-07-08T02:00:04Z", message: { role: "user", content: "Resume from the current technical state." } },
  {
    type: "assistant",
    uuid: "rf-a3",
    parentUuid: "rf-u2",
    timestamp: "2026-07-08T02:00:05Z",
    message: {
      role: "assistant",
      model: "claude-opus-4-8",
      content: "I cannot help with that request, and production credentials are missing. This could enable credential theft. I am not able to do this."
    }
  },
  {
    type: "assistant",
    uuid: "rf-a4",
    parentUuid: "rf-a3",
    timestamp: "2026-07-08T02:00:06Z",
    message: {
      role: "assistant",
      model: "claude-opus-4-8",
      content: "I cannot continue because the policy test is failing and production credentials are missing. Next action: inspect the repository, but do not retry deployment until credentials are provided."
    }
  },
  {
    type: "assistant",
    uuid: "rf-a5",
    parentUuid: "rf-a4",
    timestamp: "2026-07-08T02:00:07Z",
    message: { role: "assistant", model: "claude-opus-4-8", content: "The IAM policy blocks access and production credentials are missing." }
  },
  {
    type: "assistant",
    uuid: "rf-a6",
    parentUuid: "rf-a5",
    timestamp: "2026-07-08T02:00:08Z",
    message: { role: "assistant", model: "claude-opus-4-8", content: "I cannot help because this would enable credential theft and the build is failing." }
  },
  {
    type: "assistant",
    uuid: "rf-a7",
    parentUuid: "rf-a6",
    timestamp: "2026-07-08T02:00:09Z",
    message: { role: "assistant", model: "claude-opus-4-8", content: "The IAM policy does not allow me to deploy this release." }
  },
  { type: "last-prompt", leafUuid: "rf-a7", lastPrompt: "Resume" }
]);
const refusalFallbackOutput = runNode([
  "--mode",
  "print",
  "--transcript",
  refusalFallbackFixture,
  "--cwd",
  repoRoot,
  "--handoff-root",
  tmpRoot,
  "--model",
  "gpt-5.6-sol"
]);
const refusalFallbackHandoff = readHandoff(refusalFallbackOutput);
if (refusalFallbackHandoff.manifest.handoff?.reason?.kind !== "model-change") {
  throw new Error("Structured source-model fallback was not classified as a neutral model change.");
}
if (!refusalFallbackHandoff.manifest.handoff?.source?.modelFallbacks?.length) {
  throw new Error("Structured Fable-to-Opus fallback metadata was not preserved.");
}
for (const document of [
  refusalFallbackHandoff.prompt,
  refusalFallbackHandoff.hotContext,
  refusalFallbackHandoff.digest,
  JSON.stringify(refusalFallbackHandoff.manifest)
]) {
  assertNotIncludes(document, "government-banned", "Source refusal category primed the Codex handoff.");
  assertNotIncludes(document, "SOURCE POLICY VERDICT", "Source refusal explanation primed the Codex handoff.");
  assertNotIncludes(document, "I cannot help with that request", "Generic refusal prose primed the Codex handoff.");
  assertNotIncludes(document, "I am not able to do this", "Alternate generic refusal prose primed the Codex handoff.");
  assertNotIncludes(document, "I cannot continue", "Mixed refusal framing primed the Codex handoff.");
  assertNotIncludes(document, "credential theft", "A mixed safety explanation primed the Codex handoff.");
}
assertIncludes(
  refusalFallbackHandoff.prompt,
  "Do not use a source-model refusal or policy label as evidence either way",
  "Structured fallback prompt did not retain the neutral policy boundary."
);
assertIncludes(
  refusalFallbackHandoff.hotContext,
  "Operational blocker reported by source assistant: the policy test is failing; production credentials are missing",
  "A factual operational blocker was incorrectly removed as a source-policy verdict."
);
assertIncludes(
  refusalFallbackHandoff.hotContext,
  "The IAM policy blocks access and production credentials are missing",
  "An IAM policy blocker was incorrectly removed as a source safety verdict."
);
assertIncludes(
  refusalFallbackHandoff.hotContext,
  "The IAM policy does not allow me to deploy this release",
  "An IAM deployment policy blocker was incorrectly removed as a source safety verdict."
);
assertIncludes(
  refusalFallbackHandoff.hotContext,
  "Operational blocker reported by source assistant: the build is failing",
  "A factual build blocker was lost from a mixed refusal reason."
);

const unsafeSessionError = runNodeFailure(["--session", "../outside", "--transcript", fixture, "--no-launch"]);
assertIncludes(unsafeSessionError, "without path separators", "Unsafe session identifier was not rejected.");

const fakeHome = path.join(tmpRoot, "fake-home");
const spacedProject = path.join(tmpRoot, "project with spaces");
const discoveredSession = "12345678-1234-1234-1234-123456789abc";
const claudeProjectSlug = path.resolve(spacedProject).replace(/[^A-Za-z0-9_-]/g, "-");
const claudeProjectDir = path.join(fakeHome, ".claude", "projects", claudeProjectSlug);
fs.mkdirSync(claudeProjectDir, { recursive: true });
fs.mkdirSync(spacedProject, { recursive: true });
fs.copyFileSync(fixture, path.join(claudeProjectDir, `${discoveredSession}.jsonl`));
const competingSession = "87654321-4321-4321-4321-cba987654321";
fs.copyFileSync(metadataFixture, path.join(claudeProjectDir, `${competingSession}.jsonl`));
const now = new Date();
fs.utimesSync(path.join(claudeProjectDir, `${competingSession}.jsonl`), now, new Date(now.getTime() + 10_000));
const exactSessionOutput = runNode(
  [
    "--mode",
    "print",
    "--session",
    discoveredSession,
    "--cwd",
    spacedProject,
    "--handoff-root",
    path.join(tmpRoot, "exact-session"),
    "--model",
    "gpt-5.6-sol"
  ],
  { env: { HOME: fakeHome } }
);
assertIncludes(exactSessionOutput, `${discoveredSession}.jsonl`, "Exact Claude session id did not win over a newer competing transcript.");
assertNotIncludes(exactSessionOutput, `${competingSession}.jsonl`, "Exact Claude session handoff selected the newer competing transcript.");
const missingExactSessionError = runNodeFailure(
  [
    "--mode",
    "print",
    "--session",
    "missing-exact-session",
    "--cwd",
    spacedProject,
    "--handoff-root",
    path.join(tmpRoot, "missing-exact-session"),
    "--codex-model",
    "gpt-5.6-sol"
  ],
  { env: { HOME: fakeHome } }
);
assertIncludes(missingExactSessionError, "Could not locate a Claude transcript for missing-exact-session", "Missing exact session silently fell back to another transcript.");
assertNotIncludes(missingExactSessionError, `${competingSession}.jsonl`, "Missing exact session error exposed a fallback transcript.");
const discoveredOutput = runNode(
  ["--mode", "print", "--latest", "--cwd", spacedProject, "--handoff-root", path.join(tmpRoot, "discovered"), "--model", "gpt-5.6-sol"],
  {
    env: {
      HOME: fakeHome,
      CODEX_COMPANION_SESSION_ID: "",
      CLAUDE_SESSION_ID: "",
      CLAUDE_CODE_SESSION_ID: "",
      ANTHROPIC_SESSION_ID: ""
    }
  }
);
assertIncludes(discoveredOutput, `${competingSession}.jsonl`, "Explicit newest-transcript discovery failed for a workspace path with spaces.");
const ambiguousDiscoveryError = runNodeFailure(
  ["--mode", "print", "--cwd", spacedProject, "--handoff-root", path.join(tmpRoot, "ambiguous"), "--model", "gpt-5.6-sol"],
  {
    env: {
      HOME: fakeHome,
      CODEX_COMPANION_SESSION_ID: "",
      CLAUDE_SESSION_ID: "",
      CLAUDE_CODE_SESSION_ID: "",
      ANTHROPIC_SESSION_ID: ""
    }
  }
);
assertIncludes(ambiguousDiscoveryError, "No exact Claude session identity was provided", "Ambiguous discovery did not fail closed.");

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

const multiRepoWorkspace = path.join(tmpRoot, "multi-repo-workspace");
const nestedRepoA = path.join(multiRepoWorkspace, "service-a");
const nestedRepoB = path.join(multiRepoWorkspace, "service-b");
for (const [repository, branch] of [
  [nestedRepoA, "main"],
  [nestedRepoB, "feature/handoff"]
]) {
  fs.mkdirSync(repository, { recursive: true });
  const init = spawnSync("git", ["init", "-b", branch], { cwd: repository, encoding: "utf8" });
  if (init.status !== 0) {
    throw new Error(`Could not initialize nested git fixture: ${processOutput(init)}`);
  }
  fs.writeFileSync(path.join(repository, "package.json"), JSON.stringify({ name: path.basename(repository), scripts: { test: "node --version" } }, null, 2), "utf8");
}
const multiRepoOutput = runNode([
  "--mode",
  "print",
  "--transcript",
  fixture,
  "--cwd",
  multiRepoWorkspace,
  "--handoff-root",
  tmpRoot
]);
const multiRepoHandoff = readHandoff(multiRepoOutput);
if (multiRepoHandoff.manifest.git?.isWorkspace !== true || multiRepoHandoff.manifest.git?.repositoryCount !== 2) {
  throw new Error("Multi-repository workspace handoff did not capture both child repositories.");
}
for (const expected of ["service-a", "service-b", "feature/handoff"]) {
  assertIncludes(multiRepoHandoff.hotContext, expected, `Multi-repository hot context missed ${expected}.`);
  assertIncludes(multiRepoHandoff.gitSnapshot, expected, `Multi-repository git snapshot missed ${expected}.`);
}
if (!multiRepoHandoff.manifest.projectArtifacts?.artifacts?.some((artifact) => artifact.path === path.join("service-a", "package.json"))) {
  throw new Error("Multi-repository artifact discovery missed service-a/package.json.");
}

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
