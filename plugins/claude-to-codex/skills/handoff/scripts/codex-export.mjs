import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { StringDecoder } from 'node:string_decoder';
import { redact } from './claude-to-codex.mjs';

// Supported CLI protocol, over pipes only. Never resumes, forks or creates a
// thread and never opens a desktop app, daemon socket or internal database.
export async function exportCodexThread({ sessionId, codexHome, command = process.env.HANDOFF_CODEX_BIN ?? 'codex', onPage, timeout = 10000 }) {
  if (!sessionId || !/^[a-zA-Z0-9_-]{1,200}$/.test(sessionId)) throw new Error('An exact Codex thread identity is required for native export');
  const child = spawn(command, ['app-server'], { env: { ...process.env, CODEX_HOME: codexHome }, stdio: ['pipe', 'pipe', 'pipe'], detached: process.platform !== 'win32' });
  const pending = new Map();
  let nextId = 0, carry = '', closed = false, totalBytes = 0;
  const decoder = new StringDecoder('utf8');
  const stop = error => {
    closed = true;
    for (const { reject, timer } of pending.values()) { clearTimeout(timer); reject(error); }
    pending.clear();
  };
  const overall = setTimeout(() => { stop(new Error('Codex native history export exceeded 60 seconds; source session has not been stopped')); child.kill('SIGTERM'); }, 60000);
  child.on('error', error => stop(new Error(`Cannot run Codex native history export: ${error.message}`)));
  child.on('exit', code => stop(new Error(`Codex history helper exited before replying (${code}); check codex app-server --help or use --transcript`)));
  child.stdin.on('error', () => stop(new Error('Codex history helper closed its input')));
  child.stderr.on('data', () => {}); // Drain diagnostics without exposing config/credential text.
  child.stdout.on('data', chunk => {
    totalBytes += chunk.length;
    if (totalBytes > 256 * 1024 * 1024) { stop(new Error('Native history export exceeds 256 MiB; use an available native rollout with --transcript')); return; }
    carry += decoder.write(chunk);
    if (Buffer.byteLength(carry) > 32 * 1024 * 1024) { stop(new Error('Native history response exceeds 32 MiB; use an available native rollout with --transcript')); return; }
    let newline;
    while ((newline = carry.indexOf('\n')) >= 0) {
      const line = carry.slice(0, newline); carry = carry.slice(newline + 1);
      let message;
      try { message = JSON.parse(line); } catch { continue; }
      if (!message || typeof message !== 'object') continue;
      const waiting = pending.get(message.id);
      if (!waiting) continue;
      pending.delete(message.id); clearTimeout(waiting.timer);
      if (message.error) {
        const error = new Error(redact(`Codex ${waiting.method}: ${message.error.message ?? 'protocol error'}`));
        error.code = message.error.code;
        waiting.reject(error);
      } else waiting.resolve(message.result);
    }
  });
  const rpc = (method, params) => new Promise((resolve, reject) => {
    if (closed) { reject(new Error('Codex native history helper is unavailable')); return; }
    const id = ++nextId;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Codex ${method} timed out; source session has not been stopped`)); }, timeout);
    pending.set(id, { method, resolve, reject, timer });
    child.stdin.write(JSON.stringify({ method, params, id }) + '\n');
  });
  const emit = async page => { if (onPage) await onPage(page); };
  try {
    await rpc('initialize', { clientInfo: { name: 'agent_handoff', title: 'Terminal CLI Handoff', version: '0.2.0' } });
    child.stdin.write(JSON.stringify({ method: 'initialized', params: {} }) + '\n');
    const metadata = await rpc('thread/read', { threadId: sessionId });
    if (metadata?.thread?.id !== sessionId) throw new Error('Native export returned a different Codex thread');
    await emit({ method: 'thread/read', result: metadata });
    let cursor, pages = 0;
    const cursors = new Set();
    try {
      do {
        const result = await rpc('thread/turns/list', { threadId: sessionId, sortDirection: 'asc', itemsView: 'full', limit: 20, ...(cursor ? { cursor } : {}) });
        if (!Array.isArray(result?.data)) throw new Error('Unsupported native turn-page response');
        await emit({ method: 'thread/turns/list', result });
        cursor = result.nextCursor;
        if (cursor) {
          if (cursors.has(JSON.stringify(cursor))) throw new Error('Codex history pagination repeated a cursor');
          cursors.add(JSON.stringify(cursor));
        }
        if (++pages > 2000) throw new Error('Codex history exceeds 2000 pages; use an available rollout with --transcript');
      } while (cursor);
    } catch (error) {
      // Older servers expose read(includeTurns) but not turn pagination.
      if (pages !== 0 || !(error.code === -32601 || /unsupported|not supported|unknown method/i.test(error.message))) throw error;
      const result = await rpc('thread/read', { threadId: sessionId, includeTurns: true });
      if (result?.thread?.id !== sessionId || !Array.isArray(result.thread.turns)) throw new Error('Unsupported native full-history response');
      await emit({ method: 'thread/read', result, includesHistory: true });
    }
    return metadata.thread;
  } finally {
    clearTimeout(overall);
    for (const { timer } of pending.values()) clearTimeout(timer);
    child.stdin.end();
    const exited = new Promise(resolve => child.once('exit', resolve));
    const kill = signal => {
      try { if (child.pid && process.platform !== 'win32') process.kill(-child.pid, signal); else child.kill(signal); }
      catch (error) { if (error.code !== 'ESRCH') throw error; }
    };
    if (child.exitCode === null && child.signalCode === null) {
      kill('SIGTERM');
      let timer;
      await Promise.race([exited, new Promise(resolve => { timer = setTimeout(resolve, 1000); })]);
      clearTimeout(timer);
      if (child.exitCode === null && child.signalCode === null) { kill('SIGKILL'); await exited; }
    }
  }
}

function redactValue(value) {
  if (typeof value === 'string') return redact(value);
  if (Array.isArray(value)) return value.map(redactValue);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactValue(item)]));
  return value;
}

export async function captureCodexThread({ file, sessionId, codexHome, command, timeout }) {
  const fd = fs.openSync(file, 'wx', 0o600);
  const events = [];
  let objective = null, line = 0, unknownCount = 0;
  const add = (item, event) => {
    if (!event.text) return;
    const original = event.text;
    if (event.role === 'user' && !objective && !/^\s*(?:# AGENTS\.md instructions|<environment_context>)/.test(original)) objective = original.slice(0, 12000);
    events.push({ ...event, itemId: item.id, callId: item.id, line, text: original.slice(0, 12000), truncated: original.length > 12000 });
    if (events.length > 80) events.shift();
  };
  let thread;
  try {
    thread = await exportCodexThread({ sessionId, codexHome, command, timeout, onPage: page => {
      const value = redactValue(page);
      if (value.method === 'thread/read' && !value.includesHistory) value.result.thread.turns = [];
      const turns = value.includesHistory ? value.result.thread.turns : value.method === 'thread/turns/list' ? value.result.data : [];
      for (const turn of turns) {
        if (!Array.isArray(turn.items)) throw new Error('Native turn items were not fully loaded');
        // Hidden reasoning is unnecessary for a handoff. Public messages and
        // tool evidence remain recoverable in this redacted native export.
        turn.items = turn.items.filter(item => item?.type !== 'reasoning');
      }
      fs.writeSync(fd, JSON.stringify(value) + '\n');
      line++;
      for (const turn of turns) {
        for (const item of turn.items) {
          const type = item.type;
          if (type === 'userMessage') add(item, { type: 'message', role: 'user', text: (item.content ?? []).filter(part => part?.type === 'text').map(part => part.text ?? '').join('\n') });
          else if (type === 'agentMessage') add(item, { type: 'message', role: 'assistant', text: item.text ?? '' });
          else if (type === 'commandExecution') add(item, { type: 'tool', name: 'command', text: `${item.command}\nStatus: ${item.status}; exit code: ${item.exitCode ?? 'unknown'}\n${item.aggregatedOutput ?? ''}` });
          else if (type === 'fileChange') add(item, { type: 'tool', name: 'fileChange', text: JSON.stringify({ status: item.status, changes: item.changes }) });
          else if (type === 'mcpToolCall' || type === 'dynamicToolCall') add(item, { type: 'tool', name: item.tool ?? type, text: JSON.stringify(item) });
          else { unknownCount++; add(item, { type, text: JSON.stringify(item) }); }
        }
        if (turn.error) add({ id: turn.id }, { type: 'error', text: JSON.stringify(turn.error) });
      }
    } });
    if (!events.length) throw new Error('Native Codex export contained no usable conversation or tool evidence');
  } finally { fs.closeSync(fd); }
  const stat = fs.statSync(file);
  return { source: file, session: { id: thread.id, cwd: thread.cwd }, objective, events, malformedCount: 0, unknownCount, lineCount: line, capture: { size: stat.size, mtimeMs: stat.mtimeMs }, nativeExport: true };
}
