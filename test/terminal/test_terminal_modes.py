import importlib.util
from pathlib import Path
import unittest
import subprocess
import sys
import textwrap
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('terminal_mode_helpers', Path(__file__).resolve().parents[2] / 'plugins/claude-to-codex/skills/handoff/scripts/terminal.py')
terminal = importlib.util.module_from_spec(spec)
spec.loader.exec_module(terminal)


class TerminalModeTests(unittest.TestCase):
    def test_shutdown_with_full_input_queue_and_unresponsive_source_is_bounded(self):
        script = textwrap.dedent(r"""
            import importlib.util, os, pty, signal, time, tty
            spec = importlib.util.spec_from_file_location('terminal', MODULE)
            terminal = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(terminal)
            pid, master = pty.fork()
            if pid == 0:
                tty.setraw(0)
                signal.signal(signal.SIGINT, signal.SIG_IGN)
                signal.signal(signal.SIGTERM, signal.SIG_IGN)
                os.write(1, b'READY')
                while True: time.sleep(1)
            def timeout(signum, frame):
                raise RuntimeError('Shutdown regression exceeded its deadline')
            signal.signal(signal.SIGALRM, timeout)
            signal.alarm(9)
            try:
                assert os.read(master, 5) == b'READY'
                os.set_blocking(master, False)
                while True:
                    try: os.write(master, b'x' * 65536)
                    except BlockingIOError: break
                os.set_blocking(master, True)
                terminal.terminate(pid, master)
            finally:
                signal.alarm(0)
                try: os.kill(pid, signal.SIGKILL)
                except ProcessLookupError: pass
                os.close(master)
        """).replace('MODULE', repr(str(Path(terminal.__file__))))
        result = subprocess.run([sys.executable, '-c', script], capture_output=True, timeout=12)
        self.assertEqual(result.returncode, 0, result.stderr.decode())

    def test_sgr_motion_and_release_packets_are_removed_at_the_boundary(self):
        self.assertEqual(terminal.transition_input(b'\x1b[<35;39;15M\x1b[<0;39;15m'), b'')

    def test_real_keyboard_input_and_unicode_survive_between_mouse_packets(self):
        self.assertEqual(terminal.transition_input(b'hello\x1b[<35;39;15M' + ' résumé'.encode() + b'\r'), 'hello résumé\r'.encode())

    def test_arrow_and_function_keys_are_not_mouse_packets(self):
        keys = b'\x1b[A\x1b[B\x1bOP\x1b[15~\x03\x7f'
        self.assertEqual(terminal.transition_input(keys), keys)

    def test_legacy_x10_mouse_packet_is_removed(self):
        self.assertEqual(terminal.transition_input(b'\x1b[M !!text'), b'text')

    def test_bracketed_paste_preserves_literal_mouse_sequences(self):
        paste = b'\x1b[200~example \x1b[<35;39;15M and \x1b[M !!\x1b[201~'
        self.assertEqual(terminal.transition_input(b'\x1b[<35;1;2M' + paste), paste)

    def test_incomplete_paste_is_preserved_for_the_receiving_cli(self):
        paste = b'\x1b[200~unfinished \x1b[<35;39;15M'
        self.assertEqual(terminal.transition_input(paste), paste)

    def test_reset_writes_every_byte_even_when_terminal_writes_are_partial(self):
        output = bytearray()
        def write(fd, data):
            self.assertEqual(fd, 1)
            output.extend(data[:3])
            return min(3, len(data))
        with patch.object(terminal.os, 'write', side_effect=write):
            terminal.reset_application_modes()
        self.assertEqual(output, terminal.TERMINAL_RESET)
        for mode in (1000, 1002, 1003, 1006, 1004, 2004):
            self.assertIn(f'\x1b[?{mode}l'.encode(), output)


if __name__ == '__main__':
    unittest.main()
