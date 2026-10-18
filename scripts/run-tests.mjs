import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
function run(command, args, cwd = repo) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('HANDOFF_') && !['CODEX_THREAD_ID', 'CLAUDE_SESSION_ID', 'CODEX_COMPANION_SESSION_ID', 'ZDOTDIR'].includes(key)));
  const result = spawnSync(command, args, { cwd, stdio: 'inherit', env });
  if (result.status !== 0) throw new Error(`${command} exited ${result.status}: ${result.error?.message ?? ''}`);
}
try {
  run(process.execPath, ['scripts/validate.mjs']);
  run(process.execPath, ['--test', ...fs.readdirSync(path.join(repo, 'test/unit')).filter(name => name.endsWith('.test.mjs')).map(name => 'test/unit/' + name)]);
  run('python3', ['-m', 'unittest', 'discover', '-s', 'test/terminal', '-p', 'test_*.py']);
  // The distributed source archive may have no .git. Legacy smoke tests require
  // committed project metadata, so exercise them in an isolated fixture checkout.
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'handoff regression '));
  try {
    fs.cpSync(repo, temporary, { recursive: true, filter: source => !['.git', 'node_modules', '__pycache__', '.DS_Store'].includes(path.basename(source)) });
    run('git', ['init', '-q'], temporary);
    run('git', ['add', '.'], temporary);
    run('git', ['-c', 'user.name=Handoff Test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'Test fixture'], temporary);
    run(process.execPath, ['scripts/smoke-test.mjs'], temporary);
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
} catch (error) { console.error(error.message); process.exitCode = 1; }
