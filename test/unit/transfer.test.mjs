import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { prepare } from '../../plugins/claude-to-codex/skills/handoff/scripts/handoff.mjs';
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

test('reverse package preserves context, Git changes, secrets boundary and linked round trips', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "handoff space's "));
  try {
    const git = args => { const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' }); assert.equal(result.status, 0, result.stderr); return result.stdout; };
    git(['init', '-q']);
    fs.writeFileSync(path.join(root, 'work.txt'), 'uncommitted work');
    git(['add', 'work.txt']);
    fs.writeFileSync(path.join(root, 'work.txt'), 'more work');
    const gitBefore = git(['status', '--porcelain=v1']);
    const rollout = path.join(root, 'rollout-native.jsonl');
    fs.writeFileSync(rollout, [
      { type: 'session_meta', payload: { id: 'native', cwd: root } },
      { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ text: 'Original objective: ship a feature; preserve constraints' }] } },
      { type: 'response_item', payload: { type: 'function_call', call_id: 'a', name: 'exec_command', arguments: '{"cmd":"npm test"}' } },
      { type: 'response_item', payload: { type: 'function_call_output', call_id: 'a', output: 'Tests failed: API_KEY=sk-test-1234567890123456 {"password":"demo-password-123"}' } },
      { type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ text: 'Decision: use existing modules. Next: fix the failing test.' }] } }
    ].map(JSON.stringify).join('\n') + '\n{broken');
    const before = fs.readFileSync(rollout);
    const options = { cwd: root, root: path.join(root, 'packages'), chainId: 'shared-chain' };
    const first = await prepare({ ...options, source: 'codex', session: 'native', transcript: rollout, claudeModel: 'sonnet' });
    const manifest = JSON.parse(fs.readFileSync(first.manifestPath));
    assert.equal(manifest.originalObjective, 'Original objective: ship a feature; preserve constraints');
    assert.equal(manifest.history.malformedCount, 1);
    const digest = fs.readFileSync(manifest.evidence.digest, 'utf8');
    assert.match(digest, /npm test/);
    assert.match(digest, /Tests failed/);
    assert.match(digest, /Next: fix the failing test/);
    assert.doesNotMatch(digest, /sk-test-1234567890123456|demo-password-123/);
    const launch = JSON.parse(fs.readFileSync(path.join(first.dir, 'launch.json')));
    assert.equal(launch.target, 'claude');
    assert.deepEqual(launch.args.slice(0, 2), ['--model', 'sonnet']);
    assert.ok(!launch.args.includes('-p'));
    assert.ok(!launch.args.at(-1).includes('Tests failed'));
    assert.match(fs.readFileSync(manifest.evidence.git, 'utf8'), /work.txt/);
    const second = await prepare({ ...options, source: 'claude', transcript: path.join(repo, 'test/fixtures/sample-session.jsonl'), previous: first.manifestPath });
    const third = await prepare({ ...options, source: 'codex', session: 'native', transcript: rollout, previous: second.manifestPath });
    const last = JSON.parse(fs.readFileSync(third.manifestPath));
    assert.equal(last.previous, second.manifestPath);
    assert.equal(last.originalObjective, manifest.originalObjective);
    assert.equal(fs.statSync(first.dir).mode & 0o777, 0o700);
    for (const file of fs.readdirSync(first.dir)) assert.equal(fs.statSync(path.join(first.dir, file)).mode & 0o777, 0o600);
    assert.deepEqual(fs.readFileSync(rollout), before);
    // Only the original file's Git state matters; exports are additional untracked artifacts.
    assert.equal(git(['status', '--porcelain=v1', '--', 'work.txt']), gitBefore);
    assert.equal(fs.readFileSync(path.join(root, 'work.txt'), 'utf8'), 'more work');
    assert.equal(git(['show', ':work.txt']), 'uncommitted work');
    await assert.rejects(prepare({ ...options, source: 'codex', session: 'native', transcript: rollout, previous: first.manifestPath, chainId: 'other' }), /different chain/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('unsupervised live transfer fails actionably without launching or creating artifacts', () => {
  const env = { ...process.env }; delete env.HANDOFF_CONTROL;
  const result = spawnSync(process.execPath, [path.join(repo, 'plugins/claude-to-codex/skills/handoff/scripts/handoff.mjs'), 'transfer', '--from', 'codex'], { env, encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /open a new terminal and resume/);
});

test('installed global integrations run from paths with spaces and preserve backups', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "install home's "));
  try {
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('HANDOFF_') && !['CODEX_THREAD_ID', 'CLAUDE_SESSION_ID'].includes(key)));
    env.HOME = root;
    const install = () => spawnSync(process.execPath, [path.join(repo, 'scripts/install-standalone.mjs')], { env, encoding: 'utf8' });
    assert.equal(install().status, 0);
    const command = fs.readFileSync(path.join(root, '.claude/commands/handoff.md'), 'utf8');
    assert.ok(!command.includes('$HOME'), 'preflight must not require shell-variable expansion');
    assert.match(command, /allowed-tools: Bash\(node \*\)/);
    const injected = command.match(/!`([^`]+)`/)[1].replace('${CLAUDE_SESSION_ID}', 'exact-test-session');
    // Execute the actual rendered command with a stub node to verify quoting and identity.
    const stubBin = path.join(root, 'stub-bin');
    fs.mkdirSync(stubBin);
    fs.writeFileSync(path.join(stubBin, 'node'), '#!/bin/sh\nprintf "%s\\n" "$@"\n', { mode: 0o755 });
    const rendered = spawnSync('/bin/sh', ['-c', injected], { env: { ...env, PATH: stubBin }, encoding: 'utf8' });
    assert.equal(rendered.status, 0, rendered.stderr);
    assert.deepEqual(rendered.stdout.trimEnd().split('\n'), [path.join(root, '.claude/skills/claude-to-codex/scripts/claude-to-codex.mjs'), '--session', 'exact-test-session']);
    const skillRoot = path.join(root, '.agents/skills/handoff');
    const entry = path.join(skillRoot, 'scripts/handoff.mjs');
    const help = spawnSync(process.execPath, [entry, '--help'], { env, encoding: 'utf8' });
    assert.equal(help.status, 0, help.stderr);
    assert.match(help.stdout, /agent-handoff/);
    assert.match(fs.readFileSync(path.join(skillRoot, 'SKILL.md'), 'utf8'), /CODEX_THREAD_ID/);
    const launcher = spawnSync(path.join(root, '.local/bin/agent-handoff'), ['--help'], { env, encoding: 'utf8' });
    assert.equal(launcher.status, 0, launcher.stderr);
    fs.writeFileSync(path.join(skillRoot, 'SKILL.md'), 'custom skill');
    assert.equal(install().status, 0);
    const backups = fs.readdirSync(skillRoot).filter(name => name.startsWith('SKILL.md.backup-'));
    assert.equal(backups.length, 1);
    assert.equal(fs.readFileSync(path.join(skillRoot, backups[0]), 'utf8'), 'custom skill');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('missing Python dependency fails with an actionable message', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'no-python-'));
  try {
    const env = { ...process.env, PATH: root }; delete env.HANDOFF_CONTROL;
    const result = spawnSync(process.execPath, [path.join(repo, 'plugins/claude-to-codex/skills/handoff/scripts/handoff.mjs'), 'codex'], { env, encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Python 3 is required/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

for (const state of ['missing', 'expired', 'wrong-workspace', 'wrong-source', 'available']) {
  test(`native Codex terminal availability: ${state}`, () => {
    const project = fs.mkdtempSync(path.join(os.tmpdir(), "old terminal's project "));
    const control = fs.mkdtempSync('/tmp/agent-handoff-');
    let queued;
    try {
      if (state !== 'missing') {
        const file = path.join(control, 'supervisor.json');
        fs.writeFileSync(file, JSON.stringify({ pid: process.pid, source: state === 'wrong-source' ? 'claude' : 'codex', cwd: state === 'wrong-workspace' ? os.tmpdir() : fs.realpathSync(project) }), { mode: 0o600 });
        if (state === 'expired') fs.utimesSync(file, new Date(Date.now() - 10000), new Date(Date.now() - 10000));
      }
      const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('HANDOFF_')));
      env.CODEX_THREAD_ID = 'exact-old-terminal-session';
      const result = spawnSync(process.execPath, [path.join(repo, 'plugins/claude-to-codex/skills/handoff/scripts/handoff.mjs'), 'transfer', '--from', 'codex'], { cwd: project, env, encoding: 'utf8' });
      if (state === 'available') {
        assert.equal(result.status, 0, result.stderr);
        const marker = result.stdout.match(/HANDOFF_READY_([a-f0-9]{32})/); assert.ok(marker);
        queued = path.join('/tmp', `agent-handoff-requests-${process.getuid()}`, marker[1] + '.json');
        assert.equal(JSON.parse(fs.readFileSync(queued)).session, env.CODEX_THREAD_ID);
        assert.match(result.stdout, /queued/);
      } else {
        assert.equal(result.status, 1, result.stdout);
        assert.match(result.stderr, /No active handoff terminal/);
        assert.match(result.stderr, /codex resume exact-old-terminal-session/);
        assert.doesNotMatch(result.stdout, /HANDOFF_READY_/);
        assert.ok(!fs.existsSync(path.join(project, 'packages')));
      }
    } finally {
      if (queued) fs.rmSync(queued, { force: true });
      fs.rmSync(control, { recursive: true, force: true });
      fs.rmSync(project, { recursive: true, force: true });
    }
  });
}
