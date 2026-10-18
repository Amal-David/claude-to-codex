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
      if (operation.content !== undefined) fs.writeFileSync(temporary, operation.content);
      else fs.copyFileSync(operation.source, temporary);
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
  const flags = process.argv.slice(2);
  if (flags.some(flag => flag !== '--no-shell-integration')) throw new Error('Usage: install-standalone.mjs [--no-shell-integration]');
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

  const runtime = path.dirname(scriptSrc);
  const runtimeDest = path.dirname(scriptDest);
  const codexSkill = path.join(os.homedir(), ".agents", "skills", "handoff");
  const binDest = path.join(os.homedir(), ".local", "bin", "agent-handoff");
  const runtimeFiles = ["handoff.mjs", "codex-history.mjs", "codex-export.mjs", "terminal.py"];
  const shellOperations = [];
  const shellName = path.basename(process.env.SHELL || (process.platform === 'darwin' ? 'zsh' : 'bash'));
  const profiles = shellName === 'zsh' ? [path.join(process.env.ZDOTDIR || os.homedir(), '.zshrc')]
    : shellName === 'bash' ? [path.join(os.homedir(), '.bashrc'), path.join(os.homedir(), '.bash_profile')] : [];
  const shellLine = 'source "$HOME/.claude/skills/claude-to-codex/scripts/handoff-shell.sh"';
  if (!flags.includes('--no-shell-integration')) for (const profile of profiles) {
    const destination = fs.existsSync(profile) ? fs.realpathSync(profile) : profile;
    const original = fs.existsSync(destination) ? fs.readFileSync(destination, 'utf8') : '';
    if (original.split(/\r?\n/).some(line => line.trim() === shellLine)) continue;
    shellOperations.push({ destination, content: `${original}${original && !original.endsWith('\n') ? '\n' : ''}\n# Automatic Claude/Codex terminal handoffs\n${shellLine}\n`, mode: fs.existsSync(destination) ? fs.statSync(destination).mode & 0o777 : 0o644 });
  }
  // Resolve HOME at installation time: Claude rejects shell-variable expansion
  // during injected-command permission preflight, before the collector can run.
  const quotedCollector = "'" + scriptDest.replaceAll("'", "'\"'\"'") + "'";
  const commandContent = fs.readFileSync(commandSrc, "utf8").replace(
    '"$HOME/.claude/skills/claude-to-codex/scripts/claude-to-codex.mjs"', quotedCollector
  );
  const backups = installFiles([
    { content: commandContent, destination: commandDest, mode: 0o644 },
    { source: skillSrc, destination: skillDest, mode: 0o644 },
    { source: scriptSrc, destination: scriptDest, mode: 0o755 },
    ...runtimeFiles.map(name => ({ source: path.join(runtime, name), destination: path.join(runtimeDest, name), mode: 0o755 })),
    { source: path.join(repoRoot, "integrations", "codex-handoff.md"), destination: path.join(codexSkill, "SKILL.md"), mode: 0o644 },
    ...["claude-to-codex.mjs", ...runtimeFiles].map(name => ({ source: path.join(runtime, name), destination: path.join(codexSkill, "scripts", name), mode: 0o755 })),
    { source: path.join(repoRoot, "scripts", "agent-handoff"), destination: binDest, mode: 0o755 },
    { source: path.join(repoRoot, "scripts", "handoff-shell.sh"), destination: path.join(runtimeDest, "handoff-shell.sh"), mode: 0o644 },
    ...shellOperations
  ]);

  console.log("Installed bidirectional terminal handoffs.");
  console.log(`- Command: ${commandDest}`);
  console.log(`- Skill: ${skillDest}`);
  console.log(`- Script: ${scriptDest}`);
  for (const backup of backups) {
    console.log(`- Backup: ${backup.backup}`);
  }
  console.log(`- Terminal launcher: ${binDest}`);
  console.log(`- Codex skill: ${codexSkill}`);
  console.log('Open a new Terminal window, then use claude or codex normally. Interactive starts automatically support handoffs.');
  if (flags.includes('--no-shell-integration') || !profiles.length) console.log(`Shell integration not installed. To enable it: ${shellLine}`);
  else console.log(`Shell integration: ${profiles.join(', ')} (existing contents preserved; changes backed up).`);
  console.log(`Enable in this shell now: ${shellLine}`);
  console.log("Inside Claude use /handoff; inside Codex use $handoff. No desktop apps are used.");
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
