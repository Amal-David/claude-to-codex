import fs from 'node:fs';
import path from 'node:path';
import { StringDecoder } from 'node:string_decoder';

// Rollouts are evidence, never writable import targets. Unknown records stay
// recoverable through the original path and line number.
export async function* records(file, { maxLineBytes = 16 * 1024 * 1024 } = {}) {
  const input = fs.createReadStream(file);
  const decoder = new StringDecoder('utf8');
  let line = 0, carry = '', bytes = 0, oversized = false;
  function parse() {
    line++;
    const current = carry;
    carry = ''; bytes = 0;
    if (oversized) { oversized = false; return { line, malformed: true, oversized: true }; }
    if (!current.trim()) return null;
    try { return { line, value: JSON.parse(current) }; }
    catch { return { line, malformed: true }; }
  }
  try {
    for await (const chunk of input) {
      const decoded = decoder.write(chunk);
      let start = 0;
      while (start < decoded.length) {
        const end = decoded.indexOf('\n', start);
        const part = decoded.slice(start, end < 0 ? undefined : end);
        bytes += Buffer.byteLength(part);
        if (bytes > maxLineBytes) { oversized = true; carry = ''; }
        else if (!oversized) carry += part;
        if (end < 0) break;
        const record = parse();
        if (record) yield record;
        start = end + 1;
      }
    }
    const rest = decoder.end();
    if (!oversized) carry += rest;
    if (carry || oversized) { const record = parse(); if (record) yield record; }
  } finally { input.destroy(); }
}

function text(content) {
  if (typeof content === 'string') return content;
  if (content && typeof content === 'object' && typeof content.text === 'string') return content.text;
  if (!Array.isArray(content)) return '';
  return content.filter(part => part && typeof part === 'object').map(part => part.text ?? part.input_text ?? part.output_text ?? '').filter(Boolean).join('\n');
}

export async function readCodexHistory(file, { tail = 80, textLimit = 12000 } = {}) {
  if (!Number.isInteger(tail) || tail < 1 || tail > 10000) throw new Error('tail must be between 1 and 10000');
  if (!Number.isInteger(textLimit) || textLimit < 1) throw new Error('textLimit must be positive');
  const result = { source: path.resolve(file), session: null, objective: null, events: [], malformed: [], malformedCount: 0, unknownCount: 0, lineCount: 0 };
  const recent = [];
  function add(event, fallback = false) {
    if (!event.text) return;
    if (event.role === 'user' && !result.objective && !/^\s*(?:# AGENTS\.md instructions|<environment_context>|<permissions instructions>)/.test(event.text)) result.objective = event.text.slice(0, textLimit);
    const duplicate = recent.findLastIndex(other => other.role === event.role && other.text === event.text.slice(0, textLimit) && other.fallback !== fallback);
    if (duplicate >= 0 && duplicate >= recent.length - 4) {
      if (fallback) return;
      recent.splice(duplicate, 1);
    }
    recent.push({ ...event, text: event.text.slice(0, textLimit), truncated: event.text.length > textLimit, fallback });
    if (recent.length > tail * 2) recent.shift();
  }
  for await (const record of records(file)) {
    result.lineCount = record.line;
    if (record.malformed) {
      result.malformedCount++;
      if (result.malformed.length < 100) result.malformed.push(record.line);
      continue;
    }
    const event = record.value;
    if (!event || typeof event !== 'object') { result.unknownCount++; continue; }
    const item = event.payload ?? event;
    if (event.type === 'session_meta' || (!event.type && typeof event.id === 'string' && typeof event.cwd === 'string')) {
      if (result.session && result.session.id !== item.id) throw new Error('Conflicting session metadata in rollout');
      result.session = { id: item.id, cwd: item.cwd, version: item.cli_version, originator: item.originator };
    } else if (event.type === 'turn_context' && typeof item.cwd === 'string') {
      if (result.session) result.session.cwd = item.cwd;
    } else if (event.type === 'response_item' || ['message', 'function_call', 'function_call_output'].includes(event.type)) {
      const base = { line: record.line, timestamp: event.timestamp, type: item.type, role: item.role, callId: item.call_id };
      if (item.type === 'message') {
        add({ ...base, text: text(item.content) });
      } else if (['function_call', 'custom_tool_call', 'local_shell_call'].includes(item.type)) {
        add({ ...base, name: item.name, text: typeof item.arguments === 'string' ? item.arguments : JSON.stringify(item.arguments ?? item.input ?? item.action ?? {}) });
      } else if (['function_call_output', 'custom_tool_call_output'].includes(item.type)) {
        add({ ...base, text: typeof item.output === 'string' ? item.output : JSON.stringify(item.output ?? '') });
      } else result.unknownCount++;
    } else if (event.type === 'event_msg' && ['user_message', 'agent_message'].includes(item.type)) {
      add({ line: record.line, timestamp: event.timestamp, type: 'message', role: item.type === 'user_message' ? 'user' : 'assistant', text: text(item.message) }, true);
    } else if (event.type === 'event_msg' && ['error', 'warning'].includes(item.type)) {
      add({ line: record.line, type: item.type, text: text(item.message) });
    } else if (event.type === 'event_msg' && item.type === 'thread_rolled_back') {
      result.requiresNativeExport = true;
    } else if (event.type === 'compacted') {
      add({ line: record.line, type: 'compaction', text: text(item.message ?? item.summary) });
    } else result.unknownCount++;
  }
  result.events = recent.slice(-tail).map(({ fallback, ...event }) => event);
  if (!result.session?.id) throw new Error(`No supported Codex session metadata in ${file}; provide a native rollout JSONL file`);
  if (!result.events.length) throw new Error(`Codex history contains no usable conversation or tool evidence: ${file}`);
  return result;
}

export async function findCodexSession({ sessionId, transcript, codexHome, cwd }) {
  if (!sessionId && !transcript) throw new Error('Exact Codex identity required: pass --session, CODEX_THREAD_ID, or --transcript; newest-session selection is disabled');
  if (sessionId && !/^[a-zA-Z0-9_-]+$/.test(sessionId)) throw new Error('Invalid Codex session identity');
  const candidates = [];
  async function visit(directory) {
    let entries;
    try { entries = await fs.promises.readdir(directory, { withFileTypes: true }); }
    catch (error) { if (error.code === 'ENOENT') return; throw error; }
    for (const entry of entries) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(file);
      else if (entry.isFile() && entry.name.endsWith('.jsonl') && entry.name.includes(sessionId)) candidates.push(file);
    }
  }
  if (transcript) candidates.push(path.resolve(transcript));
  else await visit(path.join(codexHome, 'sessions'));
  const matches = [];
  for (const file of candidates) {
    let history;
    for (let attempt = 0; attempt < 3; attempt++) {
      const before = fs.statSync(file);
      history = await readCodexHistory(file);
      const after = fs.statSync(file);
      if (before.size === after.size && before.mtimeMs === after.mtimeMs) { history.capture = { size: after.size, mtimeMs: after.mtimeMs }; break; }
      history = null;
    }
    if (!history) throw new Error('Codex history kept changing during capture; retry the handoff');
    if (sessionId && history.session.id !== sessionId) {
      if (transcript) throw new Error('Explicit rollout does not match the active Codex session');
      continue;
    }
    if (cwd && history.session.cwd && fs.realpathSync(history.session.cwd) !== fs.realpathSync(cwd)) throw new Error('Codex session workspace differs from the requested project');
    matches.push(history);
  }
  if (matches.length !== 1) {
    const error = new Error(`Expected one exact Codex rollout, found ${matches.length}. Use --transcript to disambiguate; paginated histories require a supported export`);
    if (matches.length === 0) error.code = 'NO_ROLLOUT';
    throw error;
  }
  return matches[0];
}
