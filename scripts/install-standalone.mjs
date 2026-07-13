#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const homeClaude = path.join(os.homedir(), ".claude");

function backupPath(destination, timestamp) {
  let candidate = `${destination}.backup-${timestamp}`;
  let suffix = 1;
  while (fs.existsSync(candidate)) {
    candidate = `${destination}.backup-${timestamp}-${suffix}`;
    suffix += 1;
  }
  return candidate;
}

function installFiles(operations) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const staged = [];
  const backups = [];
  const installed = [];

  try {
    for (const operation of operations) {
      fs.mkdirSync(path.dirname(operation.destination), { recursive: true });
      const temporary = `${operation.destination}.claude-to-codex-${process.pid}.tmp`;
      fs.copyFileSync(operation.source, temporary);
      fs.chmodSync(temporary, operation.mode);
      staged.push({ ...operation, temporary });
    }

    for (const operation of staged) {
      if (fs.existsSync(operation.destination)) {
        const backup = backupPath(operation.destination, timestamp);
        fs.renameSync(operation.destination, backup);
        backups.push({ destination: operation.destination, backup });
      }
      fs.renameSync(operation.temporary, operation.destination);
      installed.push(operation.destination);
    }
  } catch (error) {
    for (const destination of installed.reverse()) {
      if (fs.existsSync(destination)) {
        fs.unlinkSync(destination);
      }
    }
    for (const entry of backups.reverse()) {
      if (fs.existsSync(entry.backup)) {
        fs.renameSync(entry.backup, entry.destination);
      }
    }
    for (const operation of staged) {
      if (fs.existsSync(operation.temporary)) {
        fs.unlinkSync(operation.temporary);
      }
    }
    throw error;
  }

  return backups;
}

function main() {
  const commandSrc = path.join(repoRoot, "standalone", ".claude", "commands", "handoff.md");
  const skillSrc = path.join(repoRoot, "standalone", ".claude", "skills", "claude-to-codex", "SKILL.md");
  const scriptSrc = path.join(
    repoRoot,
    "plugins",
    "claude-to-codex",
    "skills",
    "handoff",
    "scripts",
    "claude-to-codex.mjs"
  );

  const commandDest = path.join(homeClaude, "commands", "handoff.md");
  const skillDest = path.join(homeClaude, "skills", "claude-to-codex", "SKILL.md");
  const scriptDest = path.join(homeClaude, "skills", "claude-to-codex", "scripts", "claude-to-codex.mjs");

  const backups = installFiles([
    { source: commandSrc, destination: commandDest, mode: 0o644 },
    { source: skillSrc, destination: skillDest, mode: 0o644 },
    { source: scriptSrc, destination: scriptDest, mode: 0o755 }
  ]);

  console.log("Installed Claude to Codex standalone command.");
  console.log(`- Command: ${commandDest}`);
  console.log(`- Skill: ${skillDest}`);
  console.log(`- Script: ${scriptDest}`);
  for (const backup of backups) {
    console.log(`- Backup: ${backup.backup}`);
  }
  console.log("Restart Claude Code, then run /handoff.");
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
