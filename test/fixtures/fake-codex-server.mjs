#!/usr/bin/env node
import fs from 'node:fs';
import readline from 'node:readline';
if (process.argv[2] !== 'app-server') process.exit(2);
const fixture = JSON.parse(fs.readFileSync(process.env.TEST_NATIVE_FIXTURE, 'utf8'));
const send = message => process.stdout.write(JSON.stringify(message) + '\n');
const input = readline.createInterface({ input: process.stdin });
for await (const line of input) {
  const message = JSON.parse(line);
  fs.appendFileSync(process.env.TEST_NATIVE_LOG, JSON.stringify({ pid: process.pid, method: message.method, params: message.params }) + '\n');
  if (message.id === undefined) continue;
  if (message.method === 'initialize') send({ id: message.id, result: { userAgent: 'fixture' } });
  else if (message.method === 'thread/read' && fixture.hang) continue;
  else if (message.method === 'thread/read') send({ id: message.id, result: { thread: { id: fixture.id, cwd: fixture.cwd, turns: message.params.includeTurns ? fixture.turns : [] } } });
  else if (message.method === 'thread/turns/list') {
    if (fixture.legacy) send({ id: message.id, error: { code: -32601, message: 'Method not found' } });
    else {
      const offset = message.params.cursor ? 1 : 0;
      send({ id: message.id, result: { data: fixture.turns.slice(offset, offset + 1), nextCursor: offset === 0 && fixture.turns.length > 1 ? 'second' : null } });
    }
  } else send({ id: message.id, error: { code: -32601, message: 'Unsupported method' } });
}
