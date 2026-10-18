#!/usr/bin/env python3
"""Interactive CLI fixture: real terminal I/O and real transfer collectors."""
import json
import os
import re
from pathlib import Path
import subprocess
import sys
import uuid

if '--help' in sys.argv:
    print('--no-daemon')
    sys.exit(0)

connection = os.environ
source = connection['HANDOFF_SOURCE']
root = Path(os.environ['FIXTURE_ROOT'])
identity = str(uuid.uuid4())
if source == 'codex':
    os.environ['CODEX_THREAD_ID'] = identity
    transcript = Path(os.environ['CODEX_HOME']) / 'sessions' / ('rollout-' + identity + '.jsonl')
else:
    slug = re.sub(r'[^A-Za-z0-9_-]', '-', os.getcwd())
    transcript = Path(os.environ['CLAUDE_CONFIG_DIR']) / 'projects' / slug / (identity + '.jsonl')
transcript.parent.mkdir(parents=True, exist_ok=True)
if source == 'codex':
    rows = [
        {'type': 'session_meta', 'payload': {'id': identity, 'cwd': os.getcwd(), 'cli_version': 'fixture'}},
        {'type': 'response_item', 'payload': {'type': 'message', 'role': 'user', 'content': [{'type': 'input_text', 'text': 'Implement the original feature without losing work'}]}},
        {'type': 'response_item', 'payload': {'type': 'function_call', 'name': 'exec_command', 'call_id': 'test', 'arguments': '{"cmd":"npm test"}'}},
        {'type': 'response_item', 'payload': {'type': 'function_call_output', 'call_id': 'test', 'output': 'Tests pass'}},
        {'type': 'response_item', 'payload': {'type': 'message', 'role': 'assistant', 'content': [{'type': 'output_text', 'text': 'Decision: keep existing architecture. Next: finish integration.'}]}}
    ]
else:
    rows = [
        {'type': 'user', 'uuid': 'u', 'sessionId': identity, 'message': {'role': 'user', 'content': 'Implement the original feature without losing work'}},
        {'type': 'assistant', 'uuid': 'a', 'parentUuid': 'u', 'sessionId': identity, 'message': {'role': 'assistant', 'model': 'claude-sonnet-4-6', 'content': 'Decision: keep existing architecture. Next: finish integration.'}}
    ]
scenario_phase = None
if os.environ.get('FIXTURE_SCENARIO') == 'button':
    import shutil
    fixture = Path(os.environ['FIXTURE_REPO']) / 'test/fixtures/website-button'
    conversation = json.loads((fixture / 'conversation.json').read_text())
    launches = root / 'launches.jsonl'
    scenario_phase = len(launches.read_text().splitlines()) if launches.exists() else 0
    if scenario_phase not in (0, 1, 2) or source != ('codex' if scenario_phase == 1 else 'claude'):
        raise RuntimeError('Unexpected button conversation phase')
    previous = os.environ.get('HANDOFF_PREVIOUS', '')
    if scenario_phase:
        manifest = json.loads(Path(previous).read_text())
        digest = Path(manifest['evidence']['digest']).read_text()
        if manifest['originalObjective'] != conversation['objective']:
            raise RuntimeError('The receiving agent lost the original button requirements')
        required = ('native button', 'click listener') if scenario_phase == 1 else ('# pass 6', '# fail 1', '3px outline')
        if not all(value in digest for value in required):
            raise RuntimeError('The receiving agent cannot recover its next step from the package')
    name = ('claudeStart', 'codexWork', 'claudeFinish')[scenario_phase]
    rows = conversation[name]
    if scenario_phase == 0:
        shutil.copy(fixture / 'index.html', root / 'index.html')
        (root / 'button.css').write_text('button { padding: 0.75rem; }\n')
    else:
        for file in (('button.js', 'button.test.mjs') if scenario_phase == 1 else ('button.css',)):
            shutil.copy(fixture / file, root / file)
        clean_env = {key: value for key, value in os.environ.items() if not key.startswith('NODE_TEST_')}
        checks = subprocess.run([os.environ['NODE_BIN'], '--test', '--test-reporter=tap', 'button.test.mjs'], cwd=root, env=clean_env, capture_output=True, text=True)
        expected_code = 1 if scenario_phase == 1 else 0
        if checks.returncode != expected_code:
            raise RuntimeError('Unexpected button project check result: ' + checks.stdout + checks.stderr)
        (root / f'button-checks-{scenario_phase}.txt').write_text(checks.stdout)
        if scenario_phase == 1:
            next(row for row in rows if row.get('payload', {}).get('call_id') == 'button-tests' and row['payload']['type'] == 'function_call_output')['payload']['output'] = checks.stdout
        else:
            next(row for row in rows if row.get('uuid') == 'button-tests-result')['message']['content'][0]['content'] = checks.stdout
    def fill(value):
        if isinstance(value, str):
            for old, new in [('__CWD__', str(root)), ('__PREVIOUS__', previous), ('button-claude-start', identity), ('button-codex', identity), ('button-claude-finish', identity)]:
                value = value.replace(old, new)
            return value
        if isinstance(value, list):
            return [fill(item) for item in value]
        if isinstance(value, dict):
            return {key: fill(item) for key, item in value.items()}
        return value
    rows = fill(rows)
transcript.write_text('\n'.join(json.dumps(row) for row in rows) + '\n')
with (root / 'launches.jsonl').open('a') as log:
    log.write(json.dumps({'source': source, 'pid': os.getpid(), 'cwd': os.getcwd(), 'tty': [os.isatty(fd) for fd in (0, 1, 2)], 'args': sys.argv[1:], 'previous': connection.get('HANDOFF_PREVIOUS'), 'socket': os.environ['HANDOFF_CONTROL'], 'scenarioPhase': scenario_phase}) + '\n')
print('READY:' + source, flush=True)
probe_requests = []
for line in sys.stdin:
    if line.strip().startswith('dirty-'):
        import signal
        import time
        sys.stdout.write('\x1b[?1003h\x1b[?1006h\x1b[?1004h\x1b[?2004h'); sys.stdout.flush()
        if line.strip() in ('dirty-exit', 'dirty-crash'):
            print('DIRTY_EXIT_DONE', flush=True)
            os._exit(17 if line.strip() == 'dirty-crash' else 0)
        def dirty_shutdown(signum, frame):
            print('SOURCE_SHUTTING_DOWN', flush=True)
            time.sleep(.3)
            os._exit(0)  # Deliberately omit TUI cleanup.
        signal.signal(signal.SIGINT, dirty_shutdown)
    if line.strip() in ('marker-expired', 'marker-other-workspace', 'marker-bad-model'):
        import time
        marker_id = uuid.uuid4().hex
        directory = Path('/tmp', 'agent-handoff-requests-' + str(os.getuid()))
        directory.mkdir(mode=0o700, exist_ok=True)
        request = directory / (marker_id + '.json')
        record = {'id': marker_id, 'source': source, 'session': identity, 'cwd': str(root), 'createdAt': time.time() * 1000}
        if line.strip() == 'marker-expired':
            record['createdAt'] -= 121000
        elif line.strip() == 'marker-other-workspace':
            record['cwd'] = str(root / 'different-project')
        else:
            record['claudeModel'] = {'unexpected': 'object'}
        request.write_text(json.dumps(record)); request.chmod(0o600)
        probe_requests.append(request)
        print('HANDOFF_READY_' + marker_id, flush=True)
        continue
    if line.strip() == 'size':
        size = os.get_terminal_size(0)
        print(f'SIZE:{size.lines}x{size.columns}', flush=True)
        continue
    if line.strip() == 'corrupt-request':
        import time
        control = Path(os.environ['HANDOFF_CONTROL'])
        request = control / 'corrupted.request'
        request.write_text('[]')
        response = control / 'corrupted.response'
        deadline = time.monotonic() + 3
        while not response.exists() and time.monotonic() < deadline:
            time.sleep(.05)
        print('CORRUPT_REPLY:' + response.read_text(), flush=True)
        request.unlink()
        response.unlink()
        continue
    if line.strip() == 'flood-exit':
        print('x' * 150000 + 'FINAL_BYTES', flush=True)
        sys.exit(0)
    if line.strip() == 'exit':
        for request in probe_requests:
            request.unlink(missing_ok=True)
        print('NORMAL_EXIT', flush=True)
        sys.exit(0)
    if line.strip() in ('handoff', 'native-shortcut', 'stale-handoff', 'fragmented-handoff', 'dirty-handoff', 'backpressure-handoff', 'shutdown-output-handoff'):
        if line.strip() == 'shutdown-output-handoff':
            import signal
            signal.signal(signal.SIGINT, signal.SIG_IGN)
            def final_screen(signum, frame):
                print('FINAL_SCREEN_BEGIN' + 'z' * 150000 + 'FINAL_SCREEN_END', flush=True)
                os._exit(0)
            signal.signal(signal.SIGTERM, final_screen)
        if line.strip() == 'backpressure-handoff':
            import signal, time, tty
            tty.setraw(0)
            signal.signal(signal.SIGINT, signal.SIG_IGN)
            signal.signal(signal.SIGTERM, signal.SIG_IGN)
            print('BACKPRESSURE_READY', flush=True)
            time.sleep(.3)
        if source == 'claude':
            # Same exact-session command as the installed /handoff integration.
            command = [os.environ['NODE_BIN'], str(Path(os.environ['HANDOFF_SCRIPT']).with_name('claude-to-codex.mjs')), '--session', identity]
        elif line.strip() == 'native-shortcut':
            command = [os.environ['NODE_BIN'], os.environ['HANDOFF_SCRIPT']]
        else:
            # Same zero-selection-flags collector invoked by native $handoff.
            command = [os.environ['NODE_BIN'], os.environ['HANDOFF_SCRIPT'], 'transfer', '--from', source]
        # A reused Codex daemon cannot inherit the new terminal's environment.
        # Exercise the output-marker rendezvous through the real collector.
        tool_env = {key: value for key, value in os.environ.items() if not key.startswith('HANDOFF_')} if source == 'codex' else None
        if line.strip() == 'stale-handoff':
            tool_env.update(HANDOFF_CONTROL='/no-longer-the-current-terminal', HANDOFF_NONCE='stale', HANDOFF_SOURCE='claude')
        result = subprocess.run(command, capture_output=True, text=True, env=tool_env)
        marker = re.search(r'HANDOFF_READY_[a-f0-9]{32}', result.stdout)
        if marker:
            (root / 'last-marker.txt').write_text(marker.group())
        if line.strip() == 'fragmented-handoff':
            import time
            output = result.stdout.replace('HANDOFF_READY_', 'HANDOFF_\x1b[32mREADY_\x1b[0m')
            for offset in range(0, len(output), 7):
                sys.stdout.write(output[offset:offset + 7]); sys.stdout.flush(); time.sleep(.005)
        else:
            print('COLLECTOR:' + str(result.returncode) + ':' + result.stdout + result.stderr, flush=True)
        if line.strip() == 'backpressure-handoff':
            while True: time.sleep(1)
    else:
        print('ECHO:' + line.strip(), flush=True)
