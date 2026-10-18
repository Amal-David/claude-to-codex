#!/usr/bin/env python3
"""Opt-in native startup smoke. Uses no credentials and sends no model request.

This checks real interactive CLI startup/terminal cleanup, not context consumption.
--handoff also drives a native shell-command transfer after interrupting an
unavailable localhost model request; no external model is contacted.
"""
import errno
import re
import fcntl
import struct
import termios
import json
import os
from pathlib import Path
import select
import shutil
import signal
import shlex
import sys
import subprocess
import tempfile
import time

repo = Path(__file__).resolve().parents[1]
entry = repo / 'plugins/claude-to-codex/skills/handoff/scripts/handoff.mjs'
claude_handoff = '--claude-handoff' in sys.argv
attempt_handoff = '--handoff' in sys.argv or claude_handoff
destination = 'codex' if claude_handoff else 'claude'
successful = True
for agent in (('claude',) if claude_handoff else ('codex',) if attempt_handoff or '--codex-only' in sys.argv else ('codex', 'claude')):
    binary = shutil.which(agent)
    if not binary:
        print(json.dumps({'agent': agent, 'result': 'not installed'}))
        successful = False
        continue
    with tempfile.TemporaryDirectory(prefix='real-cli-handoff-') as directory:
        root = Path(directory)
        (root / 'home/.codex').mkdir(parents=True)
        (root / 'home/.claude').mkdir()
        (root / 'project').mkdir()
        (root / 'project' / 'README.md').write_text('# Isolated terminal handoff smoke\n')
        env = dict(os.environ)
        for name in list(env):
            if name.startswith(('HANDOFF_', 'ANTHROPIC_', 'CLAUDE_', 'CODEX_', 'OPENAI_')) or name == 'ZDOTDIR':
                env.pop(name)
        env.update(HOME=str(root / 'home'), CODEX_HOME=str(root / 'home/.codex'),
                   CLAUDE_CONFIG_DIR=str(root / 'home/.claude'), HANDOFF_ROOT=str(root / 'packages'),
                   HANDOFF_CODEX_BIN=shutil.which('codex') or 'codex', HANDOFF_CLAUDE_BIN=shutil.which('claude') or 'claude', TERM='xterm-256color')
        if attempt_handoff:
            env['PATH'] = str(root / 'home/.local/bin') + os.pathsep + env['PATH']
            install = subprocess.run([shutil.which('node'), str(repo / 'scripts/install-standalone.mjs')], env=env, capture_output=True, text=True)
            if install.returncode:
                raise RuntimeError(install.stderr)
            config = '\n'.join([
                'model = "handoff-local-probe"', 'model_provider = "handoff_probe"',
                '[model_providers.handoff_probe]', 'name = "Local unavailable integration probe"',
                'base_url = "http://127.0.0.1:9/v1"', 'wire_api = "responses"',
                'requires_openai_auth = false', 'request_max_retries = 0', 'stream_max_retries = 0',
                '[projects.' + json.dumps(str((root / 'project').resolve())) + ']', 'trust_level = "trusted"'
            ])
            (root / 'home/.codex/config.toml').write_text(config)
        if claude_handoff:
            # Native Claude creates its own transcript; no fixture session is injected.
            # A deliberately unavailable local provider prevents external model traffic.
            env.update(ANTHROPIC_API_KEY='local-probe-not-a-credential',
                       ANTHROPIC_BASE_URL='http://127.0.0.1:9',
                       CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC='1')
            claude_config = json.dumps({
                'hasCompletedOnboarding': True, 'theme': 'dark',
                'projects': {str((root / 'project').resolve()): {'hasTrustDialogAccepted': True}}
            })
            for config_path in (root / 'home/.claude.json', root / 'home/.claude/.claude.json'):
                config_path.write_text(claude_config)
            # Only this isolated smoke avoids daemon process inspection, which
            # this sandbox denies. Production launch arguments stay untouched.
            codex_probe = root / 'codex-probe'
            codex_probe.write_text('#!/bin/sh\nexec ' + shlex.quote(shutil.which('codex')) + ' --no-daemon "$@"\n')
            codex_probe.chmod(0o755)
            env['HANDOFF_CODEX_BIN'] = str(codex_probe)

        cli_args = ['--no-daemon'] if agent == 'codex' and '--no-daemon' in subprocess.run([binary, '--help'], capture_output=True, text=True).stdout else []
        if attempt_handoff:
            cli_args += ['Integration objective: preserve this native session and hand it to the other CLI. Do not modify project files.']
        pid, fd = os.forkpty()
        if pid == 0:
            os.chdir(root / 'project')
            os.execve(shutil.which('node'), ['node', str(entry), agent, *cli_args], env)
        fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack('HHHH', 30, 100, 0, 0))
        screen = b''
        exited = False
        started = time.monotonic()
        injected = False
        interrupted = False
        deadline = started + (25 if attempt_handoff else 8)
        try:
            while time.monotonic() < deadline:
                if select.select([fd], [], [], .1)[0]:
                    try:
                        block = os.read(fd, 65536)
                    except OSError as error:
                        if error.errno == errno.EIO:
                            break
                        raise
                    if block:
                        screen = (screen + block)[-65536:]
                        # Answer terminal capability queries; no conversational input.
                        if b'\x1b[6n' in block:
                            os.write(fd, b'\x1b[1;1R')
                        if b'\x1b]10;?' in block:
                            os.write(fd, b'\x1b]10;rgb:ffff/ffff/ffff\x1b\\')
                        if b'\x1b]11;?' in block:
                            os.write(fd, b'\x1b]11;rgb:0000/0000/0000\x1b\\')
                        if b'\x1b[?u' in block:
                            os.write(fd, b'\x1b[?0u')
                        if b'\x1b[c' in block:
                            os.write(fd, b'\x1b[?1;2c')
                if attempt_handoff and not interrupted and time.monotonic() - started > 3:
                    os.write(fd, b'\x1b')
                    interrupted = True
                if attempt_handoff and not injected and time.monotonic() - started > 5:
                    command = '/handoff' if claude_handoff else '!agent-handoff'
                    if '--stale-environment' in sys.argv and not claude_handoff:
                        command = '!env ' + ' '.join('-u ' + key for key in ('HANDOFF_CONTROL', 'HANDOFF_NONCE', 'HANDOFF_CHAIN_ID', 'HANDOFF_ROOT', 'HANDOFF_SOURCE', 'HANDOFF_PREVIOUS')) + ' agent-handoff'
                    os.write(fd, b'\x1b[200~' + command.encode() + b'\x1b[201~\r')
                    injected = True
                done, status = os.waitpid(pid, os.WNOHANG)
                if done:
                    exited = True
                    break
            readable = screen.decode(errors='replace')
            plain = re.sub(r'\x1b\][^\x07]*(?:\x07|\x1b\\)|\x1b\[[0-?]*[ -/]*[@-~]', '', readable)
            native_ui = ('OpenAI' in readable or 'Codex' in readable or 'codex' in readable) if agent == 'codex' else ('Claude' in readable or 'claude' in readable)
            manifests = list((root / 'packages').glob('**/transfer.json'))
            manifest = json.loads(manifests[-1].read_text()) if manifests else None
            switch_message = '[Context transferred. Opening ' + destination + ' CLI]'
            switch_ack = switch_message in readable
            destination_screen = plain.split(switch_message, 1)[-1] if switch_ack else ''
            destination_ready = bool(re.search(r'Welcome\s*to\s*Claude\s*Code\s*v', destination_screen)) if destination == 'claude' else bool(re.search(r'Sign in.*OpenAI|Welcome to Codex|OpenAI Codex|Ask\s*Codex|Reconnecting', destination_screen, re.DOTALL))
            if attempt_handoff:
                successful = successful and bool(manifest and 'Integration objective' in manifest['originalObjective'] and switch_ack and destination_ready)
            else:
                successful = successful and native_ui and not exited
            print(json.dumps({'agent': agent, 'handoffAttempt': attempt_handoff,
                              'nativeShellCommandSent': injected,
                              'packageCreated': manifest is not None,
                              'originalObjectivePreserved': bool(manifest and 'Integration objective' in manifest['originalObjective']),
                              'switchAcknowledged': switch_ack,
                              'destinationStartupObserved': destination_ready,
                               'startupOutputObserved': bool(screen), 'interactiveReady': native_ui and not exited, 'screenTail': plain[-2500:], 'bytesObserved': len(screen), 'earlyExit': exited, 'modelProbeAttempted': attempt_handoff, 'externalModelContacted': False, 'authenticatedRoundTrip': False}), flush=True)
        finally:
            if not exited:
                os.kill(pid, signal.SIGTERM)
                cleanup_deadline = time.monotonic() + 5
                while time.monotonic() < cleanup_deadline:
                    if select.select([fd], [], [], .05)[0]:
                        try:
                            os.read(fd, 65536)
                        except OSError:
                            pass
                    done, _ = os.waitpid(pid, os.WNOHANG)
                    if done:
                        break
                else:
                    os.killpg(pid, signal.SIGKILL)
                    os.waitpid(pid, 0)
            os.close(fd)
sys.exit(0 if successful else 1)
