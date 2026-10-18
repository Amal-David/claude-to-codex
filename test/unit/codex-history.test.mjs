import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readCodexHistory, findCodexSession } from '../../lib/codex-history.mjs';

test('native rollout preserves messages, paired tools, corruption and exact identity', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'handoff space '));
  try {
    const sessions = path.join(root, 'sessions'); fs.mkdirSync(sessions);
    const file = path.join(sessions, 'rollout-exact.jsonl');
    const rows = [
      { type: 'session_meta', payload: { id: 'exact', cwd: root } },
      { type: 'event_msg', payload: { type: 'user_message', message: 'implement feature' } },
      { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'implement feature' }] } },
      { type: 'response_item', payload: { type: 'function_call', name: 'exec_command', call_id: 'a', arguments: '{"cmd":"npm test"}' } },
      { type: 'response_item', payload: { type: 'function_call_output', call_id: 'a', output: 'FAIL '.repeat(10000) } },
      { type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Fix the failing test next' }] } }
    ];
    fs.writeFileSync(file, rows.map(JSON.stringify).join('\n') + '\n{broken');
    const before = fs.readFileSync(file);
    const history = await readCodexHistory(file);
    assert.equal(history.events.length, 4);
    assert.equal(history.objective, 'implement feature');
    assert.equal(history.events[2].callId, 'a');
    assert.equal(history.events[2].truncated, true);
    assert.equal(history.malformedCount, 1);
    assert.equal((await findCodexSession({ sessionId: 'exact', codexHome: root, cwd: root })).session.id, 'exact');
    await assert.rejects(findCodexSession({ codexHome: root }), /Exact Codex identity/);
    await assert.rejects(findCodexSession({ sessionId: 'wrong', transcript: file }), /does not match/);
    assert.deepEqual(fs.readFileSync(file), before);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('mixed history formats retain fallback messages, errors and compaction evidence', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mixed-rollout-'));
  try {
    const file = path.join(root, 'old.jsonl');
    fs.writeFileSync(file, [
      { id: 'old', cwd: root },
      { type: 'event_msg', payload: { type: 'user_message', message: 'Earlier original objective' } },
      { type: 'response_item', payload: { type: 'message', role: 'assistant', content: [null, { text: 'Latest response' }] } },
      { type: 'event_msg', payload: { type: 'error', message: 'Tool permission denied' } },
      { type: 'compacted', payload: { message: 'Prior decisions preserved here' } },
      null,
      { type: 'unknown_future_record', payload: {} }
    ].map(JSON.stringify).join('\n'));
    const history = await readCodexHistory(file);
    assert.equal(history.objective, 'Earlier original objective');
    assert.deepEqual(history.events.map(event => event.text), ['Earlier original objective', 'Latest response', 'Tool permission denied', 'Prior decisions preserved here']);
    assert.equal(history.unknownCount, 2);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('oversized JSONL lines are skipped with bounded carry and later records survive', async () => {
  const { records } = await import('../../lib/codex-history.mjs');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'large-rollout-'));
  try {
    const file = path.join(root, 'large.jsonl');
    fs.writeFileSync(file, '{"large":"' + 'x'.repeat(200000) + '"}\n{"small":"✓"}');
    const result = [];
    for await (const record of records(file, { maxLineBytes: 1024 })) result.push(record);
    assert.equal(result[0].oversized, true);
    assert.equal(result[1].value.small, '✓');
    assert.equal(result[1].line, 2);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('exact selection ignores newer sessions, rejects workspace mismatches and ambiguity', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'selection-'));
  try {
    const sessions = path.join(root, 'sessions'); fs.mkdirSync(sessions);
    const write = (file, id, cwd = root) => fs.writeFileSync(file, [
      { type: 'session_meta', payload: { id, cwd } },
      { type: 'message', role: 'user', content: 'Task for ' + id }
    ].map(JSON.stringify).join('\n'));
    const exact = path.join(sessions, 'rollout-wanted.jsonl');
    write(exact, 'wanted');
    const newer = path.join(sessions, 'rollout-newer.jsonl'); write(newer, 'newer');
    fs.utimesSync(newer, new Date(), new Date(Date.now() + 60000));
    assert.equal((await findCodexSession({ sessionId: 'wanted', codexHome: root, cwd: root })).source, exact);
    await assert.rejects(findCodexSession({ sessionId: 'absent', codexHome: root }), /found 0/);
    const other = path.join(root, 'other'); fs.mkdirSync(other);
    await assert.rejects(findCodexSession({ sessionId: 'wanted', codexHome: root, cwd: other }), /workspace differs/);
    write(path.join(sessions, 'copy-wanted.jsonl'), 'wanted');
    await assert.rejects(findCodexSession({ sessionId: 'wanted', codexHome: root }), /found 2/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('long corrupted histories keep the original objective and bounded latest evidence', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'long-history-'));
  try {
    const file = path.join(root, 'history.jsonl');
    const fd = fs.openSync(file, 'w');
    fs.writeSync(fd, JSON.stringify({ type: 'session_meta', payload: { id: 'long', cwd: root } }) + '\n');
    fs.writeSync(fd, JSON.stringify({ type: 'message', role: 'user', content: 'Original objective: preserve α and 🛠 constraints' }) + '\n');
    for (let index = 0; index < 20000; index++) {
      if (index % 1000 === 0) fs.writeSync(fd, '{broken\n');
      fs.writeSync(fd, JSON.stringify({ type: 'message', role: 'assistant', content: `Progress ${index}: next step ${index + 1}` }) + '\n');
    }
    fs.closeSync(fd);
    const history = await readCodexHistory(file);
    assert.equal(history.objective, 'Original objective: preserve α and 🛠 constraints');
    assert.equal(history.events.length, 80);
    assert.equal(history.events.at(-1).text, 'Progress 19999: next step 20000');
    assert.equal(history.malformedCount, 20);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
