#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

const repoRoot = path.resolve(new URL("..", import.meta.url).pathname);
const homeClaude = path.join(os.homedir(), ".claude");

function copyFile(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

function main() {
  const commandSrc = path.join(repoRoot, "standalone", ".claude", "commands", "handoff.md");
  const skillSrc = path.join(repoRoot, "standalone", ".claude", "skills", "codex-handoff", "SKILL.md");
  const scriptSrc = path.join(repoRoot, "plugins", "cloud-handoff", "scripts", "codex-handoff.mjs");

  const commandDest = path.join(homeClaude, "commands", "handoff.md");
  const skillDest = path.join(homeClaude, "skills", "codex-handoff", "SKILL.md");
  const scriptDest = path.join(homeClaude, "skills", "codex-handoff", "scripts", "codex-handoff.mjs");

  copyFile(commandSrc, commandDest);
  copyFile(skillSrc, skillDest);
  copyFile(scriptSrc, scriptDest);
  fs.chmodSync(scriptDest, 0o755);

  console.log("Installed Cloud Handoff standalone command.");
  console.log(`- Command: ${commandDest}`);
  console.log(`- Skill: ${skillDest}`);
  console.log(`- Script: ${scriptDest}`);
  console.log("Restart Claude Code, then run /handoff.");
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
