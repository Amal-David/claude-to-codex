"""Trust-boundary and compatibility checks for terminal handoff discovery."""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import time
import unittest
from unittest.mock import patch
import uuid

REPO = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('handoff_terminal', REPO / 'plugins/claude-to-codex/skills/handoff/scripts/terminal.py')
terminal = importlib.util.module_from_spec(spec)
spec.loader.exec_module(terminal)


class RendezvousTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="button broker's ")
        self.root = Path(self.temporary.name).resolve()
        self.queue = Path('/tmp', 'agent-handoff-requests-' + str(os.getuid()))
        self.queue.mkdir(mode=0o700, exist_ok=True)
        self.identity = uuid.uuid4().hex
        self.request = self.queue / (self.identity + '.json')
        self.control = self.root / 'control'
        self.control.mkdir(mode=0o700)
        self.environment = {**os.environ, 'HANDOFF_CONTROL': str(self.control), 'HANDOFF_NONCE': 'test-private-nonce'}
        self.record = {'id': self.identity, 'source': 'codex', 'session': 'exact-button-session',
                       'cwd': str(self.root), 'createdAt': time.time() * 1000}

    def tearDown(self):
        self.request.unlink(missing_ok=True)
        self.request.with_suffix('.claimed').unlink(missing_ok=True)
        self.temporary.cleanup()

    def write(self, record=None):
        self.request.write_text(json.dumps(self.record if record is None else record))
        self.request.chmod(0o600)

    def reject(self, changes, message):
        self.write({**self.record, **changes})
        with patch.object(terminal.subprocess, 'run') as runner:
            with self.assertRaisesRegex(ValueError, message):
                terminal.accept_terminal_request(self.identity, 'codex', str(self.root), self.environment)
            runner.assert_not_called()
        self.assertEqual(list(self.control.iterdir()), [])

    def test_another_workspace_cannot_claim_this_terminal(self):
        self.reject({'cwd': str(self.root / 'other-project')}, 'workspace mismatch')

    def test_another_source_agent_cannot_claim_this_terminal(self):
        self.reject({'source': 'claude'}, 'source or workspace mismatch')

    def test_request_identity_must_match_its_observed_marker(self):
        self.reject({'id': uuid.uuid4().hex}, 'source or workspace mismatch')

    def test_session_identity_cannot_be_a_path_or_shell_command(self):
        self.reject({'session': '../../other; touch unexpected'}, 'exact source session')

    def test_missing_session_is_rejected_instead_of_selecting_latest(self):
        self.reject({'session': None}, 'exact source session')

    def test_expired_marker_does_not_trigger_a_new_transfer(self):
        self.reject({'createdAt': (time.time() - 121) * 1000}, 'expired')

    def test_future_marker_is_rejected(self):
        self.reject({'createdAt': (time.time() + 60) * 1000}, 'expired')

    def test_timestamp_must_be_numeric(self):
        self.reject({'createdAt': 'yesterday'}, 'expired')

    def test_array_record_is_rejected_without_starting_a_collector(self):
        self.write([])
        with patch.object(terminal.subprocess, 'run') as runner:
            with self.assertRaisesRegex(ValueError, 'source or workspace mismatch'):
                terminal.accept_terminal_request(self.identity, 'codex', str(self.root), self.environment)
            runner.assert_not_called()

    def test_world_readable_request_is_rejected(self):
        self.write(); self.request.chmod(0o644)
        with self.assertRaisesRegex(ValueError, 'Invalid private'):
            terminal.accept_terminal_request(self.identity, 'codex', str(self.root), self.environment)

    def test_symlink_request_is_rejected(self):
        target = self.root / 'target.json'; target.write_text(json.dumps(self.record)); target.chmod(0o600)
        self.request.symlink_to(target)
        with self.assertRaisesRegex(ValueError, 'Invalid private'):
            terminal.accept_terminal_request(self.identity, 'codex', str(self.root), self.environment)
        self.assertTrue(target.exists())

    def test_oversized_request_is_rejected_before_parsing(self):
        self.request.write_text('x' * 8193); self.request.chmod(0o600)
        with self.assertRaisesRegex(ValueError, 'Invalid private'):
            terminal.accept_terminal_request(self.identity, 'codex', str(self.root), self.environment)

    def test_invalid_model_type_never_launches_a_collector(self):
        self.reject({'claudeModel': {'command': 'unexpected'}}, 'Invalid terminal handoff model')

    def test_collector_failure_leaves_no_switch_request(self):
        self.write()
        with patch.object(terminal.subprocess, 'run', return_value=subprocess.CompletedProcess([], 1, '', 'Exact session missing')):
            with self.assertRaisesRegex(ValueError, 'Exact session missing'):
                terminal.accept_terminal_request(self.identity, 'codex', str(self.root), self.environment)
        self.assertEqual(list(self.control.iterdir()), [])
        self.assertFalse(self.request.with_suffix('.claimed').exists())

    def test_success_keeps_exact_identity_and_uses_only_private_control_files(self):
        self.write({**self.record, 'claudeModel': 'sonnet'})
        manifest = self.root / 'package/transfer.json'
        result = subprocess.CompletedProcess([], 0, 'Context transferred locally: ' + str(manifest) + '\n', '')
        with patch.object(terminal.subprocess, 'run', return_value=result) as runner:
            terminal.accept_terminal_request(self.identity, 'codex', str(self.root), self.environment)
            argv = runner.call_args.args[0]
            self.assertEqual(argv[argv.index('--session') + 1], 'exact-button-session')
            self.assertEqual(argv[-2:], ['--claude-model', 'sonnet'])
            self.assertIn('--prepare-only', argv)
            self.assertNotIn('shell', runner.call_args.kwargs)
        control_request = self.control / (self.identity + '.request')
        self.assertEqual(control_request.stat().st_mode & 0o777, 0o600)
        self.assertEqual(json.loads(control_request.read_text()), {'token': 'test-private-nonce', 'launch': str(manifest.with_name('launch.json'))})
        self.assertFalse(self.request.exists())

    def test_successful_request_cannot_be_replayed(self):
        self.write()
        result = subprocess.CompletedProcess([], 0, 'Context transferred locally: ' + str(self.root / 'package/transfer.json') + '\n', '')
        with patch.object(terminal.subprocess, 'run', return_value=result) as runner:
            terminal.accept_terminal_request(self.identity, 'codex', str(self.root), self.environment)
            with self.assertRaises(FileNotFoundError):
                terminal.accept_terminal_request(self.identity, 'codex', str(self.root), self.environment)
            self.assertEqual(runner.call_count, 1)

    def test_default_codex_start_adds_no_backend_or_permission_arguments(self):
        self.assertEqual(terminal.context_args('codex', [], ['/private/task', '/private/control'], self.environment), [])

    def test_native_resume_argv_is_preserved_exactly(self):
        argv = ['resume', 'exact-button-session']
        self.assertEqual(terminal.context_args('codex', argv, ['/private/task'], self.environment), argv)
        self.assertEqual(terminal.interactive_args('codex', 'codex', argv), argv)

    def test_explicit_user_settings_and_prompt_are_preserved_exactly(self):
        argv = ['--no-daemon', '-c', 'model_reasoning_effort="low"', '--sandbox', 'read-only', '-C', "a project's directory", 'build the button']
        self.assertEqual(terminal.context_args('codex', argv, ['/private/task'], self.environment), argv)
        self.assertEqual(terminal.interactive_args('codex', 'codex', argv), argv)


if __name__ == '__main__':
    unittest.main()
