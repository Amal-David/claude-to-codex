import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { prepare } from '../../plugins/claude-to-codex/skills/handoff/scripts/handoff.mjs';

const fixture = fileURLToPath(new URL('../fixtures/website-button/', import.meta.url));
const conversation = JSON.parse(fs.readFileSync(path.join(fixture, 'conversation.json')));
const childEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('NODE_TEST_')));
const read = file => JSON.parse(fs.readFileSync(file));
const materialize = (value, cwd, previous = '') => typeof value === 'string' ? value.replaceAll('__CWD__', cwd).replaceAll('__PREVIOUS__', previous)
  : Array.isArray(value) ? value.map(item => materialize(item, cwd, previous))
  : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, materialize(item, cwd, previous)])) : value;

test('website button conversation continues through Claude → Codex → Claude with real project checks', async t => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'button conversation '));
  const project = path.join(temporary, "Shop's résumé demo"); fs.mkdirSync(project);
  const git = args => { const result = spawnSync('git', args, { cwd: project, encoding: 'utf8' }); assert.equal(result.status, 0, result.stderr); return result.stdout; };
  const copy = name => fs.copyFileSync(path.join(fixture, name), path.join(project, name));
  const writeHistory = (name, previous = '', rows = conversation[name]) => {
    const file = path.join(temporary, name + '.jsonl'); fs.writeFileSync(file, materialize(rows, project, previous).map(JSON.stringify).join('\n') + '\n'); return file;
  };
  const options = { cwd: project, root: path.join(temporary, 'packages'), chainId: 'website-button-task', codexModel: 'fixture-model' };
  try {
    git(['init', '-q']);
    fs.writeFileSync(path.join(project, 'notes.txt'), 'User staged notes.\n'); git(['add', 'notes.txt']);
    fs.appendFileSync(path.join(project, 'notes.txt'), 'User unstaged additions.\n');
    fs.writeFileSync(path.join(project, 'AGENTS.md'), 'LOCAL_INSTRUCTIONS_SENTINEL: preserve our existing copy.');
    const notesStatus = git(['status', '--porcelain=v1', '--', 'notes.txt']);
    copy('index.html'); fs.writeFileSync(path.join(project, 'button.css'), 'button { padding: 0.75rem; }\n');
    const initial = writeHistory('claudeStart'); const initialBytes = fs.readFileSync(initial);
    const first = await prepare({ ...options, source: 'claude', session: 'button-claude-start', transcript: initial });
    const firstManifest = read(first.manifestPath);
    const firstDigest = fs.readFileSync(firstManifest.evidence.digest, 'utf8');
    await t.test('original requirements and rationale reach Codex', () => {
      assert.equal(firstManifest.originalObjective, conversation.objective);
      for (const value of ['native button', 'aria-live', 'Outstanding:', 'click listener', 'without custom keydown']) assert.ok(firstDigest.includes(value), value);
      assert.equal(firstManifest.target, 'codex');
    });
    await t.test('user staged and unstaged work is captured without modification', () => {
      assert.match(fs.readFileSync(firstManifest.evidence.git, 'utf8'), /notes\.txt/);
      assert.equal(git(['status', '--porcelain=v1', '--', 'notes.txt']), notesStatus);
      assert.equal(git(['show', ':notes.txt']), 'User staged notes.\n');
    });
    // A scripted receiving agent proceeds only after recovering its next step.
    assert.match(firstDigest, /implement the click behavior/i);
    copy('button.js'); copy('button.test.mjs');
    const failing = spawnSync(process.execPath, ['--test', '--test-reporter=tap', 'button.test.mjs'], { cwd: project, encoding: 'utf8', env: childEnv });
    await t.test('the sample really fails the outstanding focus-ring requirement', () => {
      assert.equal(failing.status, 1, failing.stdout + failing.stderr);
      assert.match(failing.stdout, /# pass 6/); assert.match(failing.stdout, /# fail 1/); assert.match(failing.stdout, /visible offset focus ring/);
    });
    const codexRows = structuredClone(conversation.codexWork);
    codexRows.find(row => row.payload?.call_id === 'button-tests' && row.payload.type === 'function_call_output').payload.output = failing.stdout;
    const codex = writeHistory('codexWork', first.manifestPath, codexRows); const codexBytes = fs.readFileSync(codex);
    const second = await prepare({ ...options, source: 'codex', session: 'button-codex', transcript: codex, previous: first.manifestPath });
    const secondManifest = read(second.manifestPath); const secondDigest = fs.readFileSync(secondManifest.evidence.digest, 'utf8');
    await t.test('returning Claude receives actual failing test output and the next step', () => {
      for (const value of ['button.js', 'node --test button.test.mjs', '# pass 6', '# fail 1', 'Known blocker', '3px outline', 'notes.txt untouched']) assert.ok(secondDigest.includes(value), value);
      assert.equal(secondManifest.target, 'claude'); assert.equal(secondManifest.previous, first.manifestPath);
      assert.equal(secondManifest.originalObjective, conversation.objective);
    });
    assert.match(secondDigest, /add button:focus-visible/); copy('button.css');
    const passing = spawnSync(process.execPath, ['--test', '--test-reporter=tap', 'button.test.mjs'], { cwd: project, encoding: 'utf8', env: childEnv });
    await t.test('the continued sample passes all seven button checks', () => {
      assert.equal(passing.status, 0, passing.stdout + passing.stderr); assert.match(passing.stdout, /# pass 7/); assert.match(passing.stdout, /# fail 0/);
    });
    const finalRows = structuredClone(conversation.claudeFinish);
    finalRows.find(row => row.uuid === 'button-tests-result').message.content[0].content = passing.stdout;
    const final = writeHistory('claudeFinish', second.manifestPath, finalRows); const finalBytes = fs.readFileSync(final);
    const third = await prepare({ ...options, source: 'claude', session: 'button-claude-finish', transcript: final, previous: second.manifestPath });
    const finalManifest = read(third.manifestPath);
    await t.test('final handoff retains the original task and actual passing result', () => {
      assert.equal(finalManifest.originalObjective, conversation.objective);
      assert.match(fs.readFileSync(finalManifest.evidence.digest, 'utf8'), /# pass 7/);
      assert.match(fs.readFileSync(finalManifest.evidence.digest, 'utf8'), /Browser keyboard\/visual testing has not been performed/);
    });
    await t.test('older decisions remain recoverable through an acyclic chain', () => {
      const seen = new Set(); let current = third.manifestPath;
      while (current) { assert.ok(!seen.has(current)); seen.add(current); const manifest = read(current); assert.equal(manifest.chainId, options.chainId); assert.ok(fs.existsSync(manifest.sourcePath)); current = manifest.previous; }
      assert.equal(seen.size, 3);
    });
    await t.test('prompts stay bounded and shared project instructions are read in place', () => {
      for (const info of [first, second, third]) {
        const prompt = fs.readFileSync(path.join(info.dir, 'prompt.md'), 'utf8');
        assert.ok(Buffer.byteLength(prompt) < 24000); assert.match(prompt, /AGENTS\.md/); assert.doesNotMatch(prompt, /LOCAL_INSTRUCTIONS_SENTINEL|# pass 7|native click listener/);
        const launch = read(path.join(info.dir, 'launch.json')); assert.ok(!launch.args.includes('-p')); assert.ok(!launch.args.includes('exec'));
      }
    });
    await t.test('all original transcripts and user changes survive the complete round trip', () => {
      for (const [file, bytes] of [[initial, initialBytes], [codex, codexBytes], [final, finalBytes]]) assert.deepEqual(fs.readFileSync(file), bytes);
      assert.equal(git(['status', '--porcelain=v1', '--', 'notes.txt']), notesStatus);
      assert.equal(fs.readFileSync(path.join(project, 'notes.txt'), 'utf8'), 'User staged notes.\nUser unstaged additions.\n');
      assert.equal(git(['rev-list', '--all', '--count']).trim(), '0');
    });
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
});

test('twelve successive button transfers keep unique packages and one original objective', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'button chain stress '));
  try {
    const histories = {};
    for (const name of ['claudeStart', 'codexWork']) { histories[name] = path.join(root, name + '.jsonl'); fs.writeFileSync(histories[name], materialize(conversation[name], root).map(JSON.stringify).join('\n')); }
    let previous; const directories = new Set();
    for (let index = 0; index < 12; index++) {
      const source = index % 2 ? 'codex' : 'claude';
      const info = await prepare({ source, cwd: root, root: path.join(root, 'packages'), chainId: 'button-long-chain', session: source === 'codex' ? 'button-codex' : 'button-claude-start', transcript: histories[index % 2 ? 'codexWork' : 'claudeStart'], previous, codexModel: 'fixture-model' });
      const manifest = read(info.manifestPath); assert.equal(manifest.previous, previous ?? null); assert.equal(manifest.originalObjective, conversation.objective);
      assert.ok(!directories.has(info.dir)); directories.add(info.dir); previous = info.manifestPath;
      assert.ok(fs.statSync(path.join(info.dir, 'prompt.md')).size < 24000);
    }
    assert.equal(directories.size, 12);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('long Claude test evidence keeps the opening diagnostic and final verdict while redacting secrets', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'button test evidence '));
  try {
    const history = path.join(root, 'long-test.jsonl');
    const output = 'OPENING_DIAGNOSTIC: testing the cart button\n' + 'progress: inspecting controls\n'.repeat(1000)
      + '\n# pass 6\n# fail 1\nAPI_KEY=sk-test-long-secret-1234567890123456\n';
    fs.writeFileSync(history, [
      { type: 'user', uuid: 'u', message: { role: 'user', content: conversation.objective } },
      { type: 'assistant', uuid: 'a', parentUuid: 'u', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'checks', name: 'Bash', input: { command: 'node --test button.test.mjs' } }] } },
      { type: 'user', uuid: 'r', parentUuid: 'a', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'checks', is_error: true, content: output }] } }
    ].map(JSON.stringify).join('\n'));
    const before = fs.readFileSync(history);
    const info = await prepare({ source: 'claude', cwd: root, transcript: history, root: path.join(root, 'packages'), codexModel: 'fixture-model' });
    const manifest = read(info.manifestPath); const digest = fs.readFileSync(manifest.evidence.digest, 'utf8');
    for (const value of ['OPENING_DIAGNOSTIC', '# pass 6', '# fail 1', 'FAILED', '[REDACTED]', 'middle omitted']) assert.ok(digest.includes(value), value);
    assert.doesNotMatch(digest, /sk-test-long-secret-1234567890123456/);
    const resultLine = digest.split('\n').find(line => line.includes('-> FAILED:'));
    assert.ok(resultLine.length < 800); assert.deepEqual(fs.readFileSync(history), before);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
