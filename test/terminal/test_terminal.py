import errno
import fcntl
import struct
import termios
import json
import os
from pathlib import Path
import select
import shutil
import signal
import subprocess
import tempfile
import time
import unittest

REPO = Path(__file__).resolve().parents[2]
SCRIPTS = REPO / 'plugins/claude-to-codex/skills/handoff/scripts'


class TerminalTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='terminal space ')
        self.root = Path(self.temporary.name).resolve()
        self.fake = self.root / "fake cli's executable"
        shutil.copy(REPO / 'test/terminal/fake-agent.py', self.fake)
        self.fake.chmod(0o755)
        self.pid = None
        self.fd = None
        self.output = b''
        self.transcript = b''

    def tearDown(self):
        if self.pid:
            try:
                os.kill(self.pid, signal.SIGTERM)
                deadline = time.monotonic() + 5
                while time.monotonic() < deadline:
                    self.drain()
                    done, _ = os.waitpid(self.pid, os.WNOHANG)
                    if done:
                        self.pid = None
                        break
                if self.pid:
                    os.killpg(self.pid, signal.SIGKILL)
                    os.waitpid(self.pid, 0)
            except ProcessLookupError:
                pass
        if self.fd is not None:
            os.close(self.fd)
        self.temporary.cleanup()

    def drain(self):
        if select.select([self.fd], [], [], .05)[0]:
            try:
                data = os.read(self.fd, 65536)
                self.output += data
                self.transcript += data
            except OSError as error:
                if error.errno != errno.EIO:
                    raise

    def start(self, source='claude', missing=False, scenario=None):
        env = dict(os.environ, HANDOFF_CLAUDE_BIN=str(self.fake), HANDOFF_CODEX_BIN='/missing/codex' if missing else str(self.fake),
                   FIXTURE_ROOT=str(self.root), HANDOFF_ROOT=str(self.root / 'packages'),
                   CODEX_HOME=str(self.root / '.codex'), CLAUDE_CONFIG_DIR=str(self.root / '.claude'),
                   NODE_BIN=shutil.which('node'), HANDOFF_SCRIPT=str(SCRIPTS / 'handoff.mjs'))
        if scenario:
            env.update(FIXTURE_SCENARIO=scenario, FIXTURE_REPO=str(REPO))
        for key in ['HANDOFF_CONTROL', 'HANDOFF_NONCE', 'HANDOFF_SOURCE', 'HANDOFF_PREVIOUS', 'HANDOFF_CHAIN_ID']:
            env.pop(key, None)
        self.pid, self.fd = os.forkpty()
        if self.pid == 0:
            os.chdir(self.root)
            os.execve(shutil.which('node'), ['node', str(SCRIPTS / 'handoff.mjs'), source], env)
        self.until('READY:' + source)

    def until(self, marker, timeout=15):
        needle = marker.encode()
        deadline = time.monotonic() + timeout
        while needle not in self.output:
            if time.monotonic() > deadline:
                self.fail('Missing ' + marker + '\n' + self.output.decode(errors='replace')[-8000:])
            if select.select([self.fd], [], [], .1)[0]:
                try:
                    data = os.read(self.fd, 65536)
                except OSError as error:
                    if error.errno == errno.EIO:
                        self.fail('Terminal closed before ' + marker + '\n' + self.output.decode(errors='replace'))
                    raise
                self.output += data
                self.transcript += data
        self.output = self.output.split(needle, 1)[1]

    def send(self, text):
        os.write(self.fd, text.encode() + b'\n')

    def finish(self):
        self.send('exit')
        self.until('NORMAL_EXIT')
        self.wait_for_exit(0)

    def wait_for_exit(self, expected):
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            self.drain()
            done, status = os.waitpid(self.pid, os.WNOHANG)
            if done:
                self.pid = None
                self.assertEqual(os.waitstatus_to_exitcode(status), expected)
                self.assertTrue(termios.tcgetattr(self.fd)[3] & termios.ICANON)
                return
            time.sleep(.05)
        self.fail('Supervisor did not exit')

    def assert_application_modes_reset(self):
        import re
        modes = {}
        for mode, action in re.findall(rb'\x1b\[\?(\d+)([hl])', self.transcript):
            modes[int(mode)] = action == b'h'
        for mode in (9, 1000, 1002, 1003, 1005, 1006, 1015, 1016, 1004, 2004, 1049):
            self.assertFalse(modes.get(mode, False), f'Terminal mode {mode} leaked')

    def test_shutdown_drains_final_source_screen_before_reaping(self):
        self.start('claude')
        self.send('shutdown-output-handoff')
        self.until('READY:codex', timeout=12)
        self.assertTrue(b'FINAL_SCREEN_BEGIN' + b'z' * 150000 + b'FINAL_SCREEN_END' in self.transcript, 'Source final screen was lost or truncated during shutdown')
        self.assertLess(self.transcript.index(b'FINAL_SCREEN_END'), self.transcript.index(b'[Context transferred. Opening codex CLI]'))

    def test_full_input_queue_does_not_block_handoff_or_shutdown(self):
        self.start('claude')
        self.send('backpressure-handoff')
        self.until('BACKPRESSURE_READY')
        os.set_blocking(self.fd, False)
        sent = 0
        deadline = time.monotonic() + 1
        while sent < 262144 and time.monotonic() < deadline:
            try:
                sent += os.write(self.fd, b'x' * 8192)
            except BlockingIOError:
                self.drain()
        os.set_blocking(self.fd, True)
        self.assertGreater(sent, 8192)
        self.until('READY:codex', timeout=12)
        self.assertIn(b'[Finishing claude session for handoff]', self.transcript)

    def test_handoff_resets_mouse_modes_without_echoing_motion_or_losing_typeahead(self):
        self.start('claude'); self.send('dirty-handoff'); self.until('SOURCE_SHUTTING_DOWN')
        self.assertFalse(termios.tcgetattr(self.fd)[3] & termios.ECHO, 'Outer terminal echo resumed before source shutdown')
        self.assertFalse(termios.tcgetattr(self.fd)[3] & termios.ICANON)
        os.write(self.fd, b'\x1b[<35;39;15M\x1b[<35;44;15Mkeyboard survived\n')
        self.until('READY:codex'); self.until('ECHO:keyboard survived')
        boundary = self.transcript.split(b'SOURCE_SHUTTING_DOWN', 1)[1].split(b'READY:codex', 1)[0]
        self.assertIn(b'\x1b[?1003l', boundary); self.assertIn(b'\x1b[?1006l', boundary)
        self.assertNotIn(b'^[[<35', self.transcript)
        self.finish(); self.assert_application_modes_reset()

    def test_normal_exit_resets_mouse_focus_and_paste_modes(self):
        self.start('codex'); self.send('dirty-exit'); self.until('DIRTY_EXIT_DONE')
        self.wait_for_exit(0); self.assert_application_modes_reset()

    def test_crashed_cli_resets_mouse_modes_and_preserves_exit_status(self):
        self.start('claude'); self.send('dirty-crash'); self.until('DIRTY_EXIT_DONE')
        self.wait_for_exit(17); self.assert_application_modes_reset()

    def test_website_button_conversation_continues_work_across_two_terminal_switches(self):
        def git(*args):
            result = subprocess.run(['git', *args], cwd=self.root, capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            return result.stdout
        git('init', '-q')
        notes = self.root / 'notes.txt'; notes.write_text('staged user notes\n'); git('add', 'notes.txt')
        notes.write_text('staged user notes\nplus unstaged user edits\n')
        before = git('status', '--porcelain=v1', '--', 'notes.txt')
        self.start(scenario='button')
        self.assertIn('Add to cart', (self.root / 'index.html').read_text())
        self.assertFalse((self.root / 'button.js').exists())
        self.send('handoff'); self.until('READY:codex')
        self.assertIn('# pass 6', (self.root / 'button-checks-1.txt').read_text())
        self.assertIn('# fail 1', (self.root / 'button-checks-1.txt').read_text())
        self.send('handoff'); self.until('READY:claude')
        self.assertIn('# pass 7', (self.root / 'button-checks-2.txt').read_text())
        self.assertIn('# fail 0', (self.root / 'button-checks-2.txt').read_text())
        self.assertEqual(git('status', '--porcelain=v1', '--', 'notes.txt'), before)
        self.assertEqual(notes.read_text(), 'staged user notes\nplus unstaged user edits\n')
        self.assertEqual(git('show', ':notes.txt'), 'staged user notes\n')
        launches = [json.loads(line) for line in (self.root / 'launches.jsonl').read_text().splitlines()]
        self.assertEqual([item['scenarioPhase'] for item in launches], [0, 1, 2])
        self.assertEqual([item['source'] for item in launches], ['claude', 'codex', 'claude'])
        for item in launches:
            self.assertEqual(item['tty'], [True, True, True])
        self.finish()

    def test_codex_ignores_stale_daemon_connection(self):
        self.start(source='codex')
        self.send('stale-handoff')
        self.until('READY:claude')
        launches = [json.loads(line) for line in (self.root / 'launches.jsonl').read_text().splitlines()]
        manifest = json.loads(Path(launches[-1]['previous']).read_text())
        self.assertEqual(manifest['source'], 'codex')
        self.assertEqual(manifest['cwd'], str(self.root))
        self.assertEqual(manifest['originalObjective'], 'Implement the original feature without losing work')
        self.finish()

    def test_marker_from_another_workspace_keeps_source_usable(self):
        self.start('codex'); self.send('marker-other-workspace')
        self.until('source or workspace mismatch')
        self.send('still working'); self.until('ECHO:still working')
        self.assertEqual(len((self.root / 'launches.jsonl').read_text().splitlines()), 1)
        self.finish()

    def test_expired_marker_keeps_source_usable(self):
        self.start('codex'); self.send('marker-expired'); self.until('request expired')
        self.send('still working'); self.until('ECHO:still working'); self.finish()

    def test_invalid_marker_model_keeps_source_usable(self):
        self.start('codex'); self.send('marker-bad-model'); self.until('Invalid terminal handoff model')
        self.send('still working'); self.until('ECHO:still working'); self.finish()

    def test_marker_split_across_ansi_colored_output_still_switches(self):
        self.start('codex'); self.send('fragmented-handoff'); self.until('READY:claude'); self.finish()

    def test_old_marker_replay_cannot_switch_the_destination_again(self):
        self.start('codex'); self.send('handoff'); self.until('READY:claude')
        marker = (self.root / 'last-marker.txt').read_text()
        self.send(marker); self.until('ECHO:' + marker)
        self.send('still working'); self.until('ECHO:still working')
        self.assertEqual(len((self.root / 'launches.jsonl').read_text().splitlines()), 2)
        self.finish()

    def test_round_trip_preserves_terminal_chain_context_and_no_live_predecessors(self):
        self.start()
        for target in ['codex', 'claude', 'codex']:
            self.send('handoff')
            self.until('READY:' + target)
            self.send('keyboard works')
            self.until('ECHO:keyboard works')
        launches = [json.loads(line) for line in (self.root / 'launches.jsonl').read_text().splitlines()]
        self.assertEqual([item['source'] for item in launches], ['claude', 'codex', 'claude', 'codex'])
        for item in launches:
            self.assertEqual(item['tty'], [True, True, True])
            self.assertEqual(item['cwd'], str(self.root))
            if item['source'] == 'codex':
                self.assertNotIn('--no-daemon', item['args'])
                self.assertNotIn('-c', item['args'])
        for item in launches[:-1]:
            with self.assertRaises(ProcessLookupError):
                os.kill(item['pid'], 0)
        manifests = [json.loads(Path(item['previous']).read_text()) for item in launches[1:]]
        self.assertEqual(len({item['chainId'] for item in manifests}), 1)
        self.assertIsNone(manifests[0]['previous'])
        self.assertEqual(manifests[2]['previous'], launches[2]['previous'])
        self.assertEqual(manifests[-1]['originalObjective'], 'Implement the original feature without losing work')
        for item in launches[1:]:
            self.assertTrue(any('Read the local handoff manifest' in arg for arg in item['args']))
            if item['source'] == 'claude':
                self.assertIn('--add-dir', item['args'])
            else:
                self.assertNotIn('--add-dir', item['args'])
        address = launches[-1]['socket']
        self.finish()
        self.assertFalse(Path(address).exists())

    def test_missing_destination_keeps_source_session_interactive(self):
        self.start(missing=True)
        self.send('handoff')
        self.until('CLI is missing from PATH')
        self.send('still working')
        self.until('ECHO:still working')
        self.assertEqual(len((self.root / 'launches.jsonl').read_text().splitlines()), 1)
        self.finish()

    def test_failed_destination_returns_status_and_cleans_control_directory(self):
        failing = self.root / 'fails'
        failing.write_text('#!/bin/sh\necho DESTINATION_FAILED\nexit 42\n')
        failing.chmod(0o755)
        # The executable path is retained by the supervisor. Replacing the same
        # fixture after startup exercises an exec that succeeds but exits badly.
        self.start()
        self.fake.write_text(failing.read_text())
        self.send('handoff')
        self.until('DESTINATION_FAILED')
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            self.drain()
            done, status = os.waitpid(self.pid, os.WNOHANG)
            if done:
                self.pid = None
                self.assertEqual(os.waitstatus_to_exitcode(status), 42)
                return
            time.sleep(.05)
        self.fail('Failed destination left the supervisor running')

    def test_ctrl_c_reaches_destination_and_returns_conventional_exit_status(self):
        self.start('codex')
        os.write(self.fd, b'\x03')
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            self.drain()
            done, status = os.waitpid(self.pid, os.WNOHANG)
            if done:
                self.pid = None
                self.assertEqual(os.waitstatus_to_exitcode(status), 130)
                return
            time.sleep(.05)
        self.fail('Ctrl-C did not stop the active CLI: ' + self.output.decode(errors='replace'))

    def test_normal_exit_drains_final_streamed_output(self):
        self.start()
        self.send('flood-exit')
        self.until('FINAL_BYTES')
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            self.drain()
            done, status = os.waitpid(self.pid, os.WNOHANG)
            if done:
                self.pid = None
                self.assertEqual(os.waitstatus_to_exitcode(status), 0)
                self.assertTrue(termios.tcgetattr(self.fd)[3] & termios.ICANON)
                return
            time.sleep(.05)
        self.fail('Normal exit did not restore the shell')

    def test_malformed_control_request_keeps_source_alive(self):
        self.start()
        self.send('corrupt-request')
        self.until('Invalid terminal request object')
        self.send('still usable')
        self.until('ECHO:still usable')
        self.finish()

    def test_terminal_resize_is_forwarded_to_active_cli(self):
        self.start()
        fcntl.ioctl(self.fd, termios.TIOCSWINSZ, struct.pack('HHHH', 33, 105, 0, 0))
        time.sleep(.1)
        self.send('size')
        self.until('SIZE:33x105')
        self.finish()

    def test_direct_codex_shell_shortcut_needs_no_model_or_selection_flags(self):
        self.start('codex')
        self.send('native-shortcut')
        self.until('READY:claude')
        self.finish()

    def test_codex_can_be_initial_source(self):
        self.start('codex')
        self.send('handoff')
        self.until('READY:claude')
        self.finish()


if __name__ == '__main__':
    unittest.main()
