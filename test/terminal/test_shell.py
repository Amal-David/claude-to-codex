import errno
import json
import os
from pathlib import Path
import select
import shutil
import subprocess
import tempfile
import unittest

REPO = Path(__file__).resolve().parents[2]


class AutomaticShellTests(unittest.TestCase):
    def test_normal_launches_and_native_commands(self):
        for shell in ('bash', 'zsh'):
            executable = shutil.which(shell)
            if not executable:
                continue
            with self.subTest(shell=shell), tempfile.TemporaryDirectory(prefix="shell home's ") as directory:
                root = Path(directory)
                env = {key: value for key, value in os.environ.items()
                       if not key.startswith('HANDOFF_') and key not in ('ZDOTDIR', 'BASH_ENV')}
                env.update(HOME=str(root), SHELL=executable)
                profile = root / ('.zshrc' if shell == 'zsh' else '.bashrc')
                profile.write_text('# existing user configuration\n')
                for _ in range(2):
                    result = subprocess.run(['node', str(REPO / 'scripts/install-standalone.mjs')], env=env, capture_output=True, text=True)
                    self.assertEqual(result.returncode, 0, result.stderr)
                contents = profile.read_text()
                self.assertTrue(contents.startswith('# existing user configuration\n'))
                self.assertEqual(contents.count('source "$HOME/.claude/skills/claude-to-codex/scripts/handoff-shell.sh"'), 1)
                self.assertEqual(len(list(root.glob(profile.name + '.backup-*'))), 1)
                bindir = root / '.local/bin'
                for name in ('codex', 'claude', 'agent-handoff'):
                    file = bindir / name
                    route = 'SUPERVISED' if name == 'agent-handoff' else 'NATIVE'
                    file.write_text('#!/usr/bin/env python3\nimport json,sys\nprint(' + repr(route + ':') + '+json.dumps(sys.argv[1:]))\n')
                    file.chmod(0o755)
                env['PATH'] = str(bindir) + os.pathsep + env['PATH']

                def run(command, interactive=True, extra=None):
                    master, slave = os.openpty()
                    try:
                        process = subprocess.Popen([executable, '-ic', command], env={**env, **(extra or {})},
                                                   stdin=slave if interactive else subprocess.DEVNULL,
                                                   stdout=slave, stderr=slave)
                        os.close(slave)
                        slave = None
                        output = b''
                        while True:
                            if select.select([master], [], [], 5)[0]:
                                try:
                                    block = os.read(master, 65536)
                                except OSError as error:
                                    if error.errno == errno.EIO:
                                        break
                                    raise
                                if not block:
                                    break
                                output += block
                            elif process.poll() is not None:
                                break
                            else:
                                process.kill()
                                self.fail('Shell command timed out')
                        self.assertEqual(process.wait(timeout=5), 0, output.decode())
                        return output.decode()
                    finally:
                        os.close(master)
                        if slave is not None:
                            os.close(slave)

                self.assertIn('SUPERVISED:["codex"]', run('codex'))
                self.assertIn('SUPERVISED:["claude", "--model", "sonnet", "prompt with spaces"]', run('claude --model sonnet "prompt with spaces"'))
                self.assertIn('SUPERVISED:["codex", "resume", "session-id"]', run('codex resume session-id'))
                self.assertIn('SUPERVISED:["codex", "-p", "work", "resume"]', run('codex -p work resume'))
                self.assertIn('NATIVE:["auth", "status"]', run('claude auth status'))
                self.assertIn('NATIVE:["-p", "hello"]', run('claude -p hello'))
                self.assertIn('NATIVE:["exec", "hello"]', run('codex exec hello'))
                self.assertIn('NATIVE:["--help"]', run('codex --help'))
                self.assertIn('NATIVE:[]', run('codex', interactive=False))
                self.assertIn('NATIVE:[]', run('claude', extra={'HANDOFF_CONTROL': '/active-supervisor'}))


if __name__ == '__main__':
    unittest.main()
