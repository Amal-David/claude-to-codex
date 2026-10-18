import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { captureCodexThread } from '../../plugins/claude-to-codex/skills/handoff/scripts/codex-export.mjs';
import { prepare } from '../../plugins/claude-to-codex/skills/handoff/scripts/handoff.mjs';
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const command = path.join(repo, 'test/fixtures/fake-codex-server.mjs');

for (const legacy of [false, true]) {
  test(`documented native CLI export ${legacy ? 'legacy read' : 'paginated'} preserves evidence and stops its helper`, async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'native export '));
    const saved = { ...process.env };
    try {
      const log = path.join(root, 'methods.jsonl');
      process.env.TEST_NATIVE_FIXTURE = path.join(root, 'fixture.json');
      process.env.TEST_NATIVE_LOG = log;
      const fixture = { id: 'exact-native', cwd: root, legacy, turns: [
        { id: 'turn1', items: [
          { id: 'user', type: 'userMessage', content: [{ type: 'text', text: 'Implement the original objective' }] },
          { id: 'reasoning', type: 'reasoning', content: ['Unneeded hidden reasoning'] },
          { id: 'cmd', type: 'commandExecution', command: 'npm test', status: 'completed', exitCode: 1, aggregatedOutput: 'Tests failed; password=secret-password' }
        ] },
        { id: 'turn2', items: [{ id: 'assistant', type: 'agentMessage', text: 'Decision: retain architecture. Next: fix failing tests.' }], error: { message: 'A tool failed' } }
      ] };
      fs.writeFileSync(process.env.TEST_NATIVE_FIXTURE, JSON.stringify(fixture));
      const file = path.join(root, 'native-export.jsonl');
      const history = await captureCodexThread({ file, sessionId: fixture.id, codexHome: root, command });
      assert.equal(history.session.id, fixture.id);
      assert.equal(history.objective, 'Implement the original objective');
      assert.match(history.events.find(event => event.name === 'command').text, /exit code: 1/);
      assert.match(history.events.at(-1).text, /tool failed/);
      const raw = fs.readFileSync(file, 'utf8');
      assert.doesNotMatch(raw, /secret-password|Unneeded hidden reasoning/);
      const requests = fs.readFileSync(log, 'utf8').trim().split('\n').map(JSON.parse);
      assert.ok(requests.every(request => ['initialize', 'initialized', 'thread/read', 'thread/turns/list'].includes(request.method)));
      assert.ok(requests.filter(request => request.params.threadId).every(request => request.params.threadId === fixture.id));
      assert.throws(() => process.kill(requests[0].pid, 0), /ESRCH/);
      process.env.HANDOFF_CODEX_BIN = command;
      const info = await prepare({ source: 'codex', session: fixture.id, cwd: root, root: path.join(root, 'packages'), chainId: 'native-chain', previous: '' });
      const manifest = JSON.parse(fs.readFileSync(info.manifestPath));
      assert.equal(manifest.history.nativeExport, true);
      assert.equal(manifest.originalObjective, history.objective);
      assert.match(manifest.sourcePath, /native-export.jsonl$/);
      await assert.rejects(captureCodexThread({ file: path.join(root, 'wrong.jsonl'), sessionId: 'wrong', codexHome: root, command }), /different Codex thread/);
    } finally {
      for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
      Object.assign(process.env, saved);
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
}

test('failed native export times out and reaps the helper without a switch', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'native timeout '));
  const savedFixture = process.env.TEST_NATIVE_FIXTURE;
  const savedLog = process.env.TEST_NATIVE_LOG;
  try {
    process.env.TEST_NATIVE_FIXTURE = path.join(root, 'fixture.json');
    process.env.TEST_NATIVE_LOG = path.join(root, 'log.jsonl');
    fs.writeFileSync(process.env.TEST_NATIVE_FIXTURE, JSON.stringify({ id: 'hang', cwd: root, hang: true }));
    await assert.rejects(captureCodexThread({ file: path.join(root, 'incomplete.jsonl'), sessionId: 'hang', codexHome: root, command, timeout: 1000 }), /timed out/);
    const requests = fs.readFileSync(process.env.TEST_NATIVE_LOG, 'utf8').trim().split('\n').map(JSON.parse);
    assert.throws(() => process.kill(requests[0].pid, 0), /ESRCH/);
    assert.ok(!fs.existsSync(path.join(root, 'launch.json')));
  } finally {
    if (savedFixture === undefined) delete process.env.TEST_NATIVE_FIXTURE; else process.env.TEST_NATIVE_FIXTURE = savedFixture;
    if (savedLog === undefined) delete process.env.TEST_NATIVE_LOG; else process.env.TEST_NATIVE_LOG = savedLog;
    fs.rmSync(root, { recursive: true, force: true });
  }
});
