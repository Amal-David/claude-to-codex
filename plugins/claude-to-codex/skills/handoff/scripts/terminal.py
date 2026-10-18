#!/usr/bin/env python3
"""Own the terminal so agent shell tools never have to steal their parent's TTY."""
import errno
import fcntl
import json
import os
from pathlib import Path
import pty
import re
import secrets
import select
import shutil
import signal
import struct
import subprocess
import sys
import tempfile
import termios
import time
import tty
import uuid

# Reset application modes explicitly: termios does not control terminal-emulator
# mouse tracking, and a forcibly stopped TUI may never send its cleanup codes.
TERMINAL_RESET = (b'\x1b[?9l\x1b[?1000l\x1b[?1002l\x1b[?1003l'
                  b'\x1b[?1005l\x1b[?1006l\x1b[?1015l\x1b[?1016l'
                  b'\x1b[?1004l\x1b[?2004l\x1b[?1049l\x1b[?25h\x1b[0m')


def reset_application_modes():
    view = memoryview(TERMINAL_RESET)
    while view:
        view = view[os.write(1, view):]


def transition_input(data):
    # Discard old mouse packets only at a CLI boundary. Preserve keyboard input
    # and literal escape sequences inside bracketed paste verbatim.
    parts = re.split(rb'(\x1b\[200~.*?(?:\x1b\[201~|$))', data, flags=re.DOTALL)
    return b''.join(part if part.startswith(b'\x1b[200~') else
                    re.sub(rb'\x1b\[<\d+;\d+;\d+[Mm]|\x1b\[M[\s\S]{3}', b'', part)
                    for part in parts)


def descendants(pid):
    # Include tool subprocesses that created their own process groups.
    try:
        result = subprocess.run(['ps', '-axo', 'pid=,ppid='], capture_output=True, text=True, timeout=2)
    except (OSError, subprocess.TimeoutExpired):
        return {pid}  # Sandboxes may forbid process inspection; still own the PTY group.
    pairs = [tuple(map(int, line.split())) for line in result.stdout.splitlines() if len(line.split()) == 2]
    found = {pid}
    while True:
        added = {child for child, parent in pairs if parent in found} - found
        if not added:
            return found
        found.update(added)


def signal_group(pid, signum):
    try:
        os.killpg(pid, signum)
    except (ProcessLookupError, PermissionError):
        # Some sandbox profiles allow signalling the owned child but deny a
        # group operation (especially after its leader has exited).
        pass


def wait_for_exit(pid, master, timeout):
    # macOS PTY teardown can wait for queued output to drain, even after
    # SIGKILL. Keep consuming output throughout every shutdown phase.
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            done, _ = os.waitpid(pid, os.WNOHANG)
            if done:
                return True
        except ChildProcessError:
            return True
        if master is not None and select.select([master], [], [], .05)[0]:
            try:
                data = os.read(master, 65536)
            except OSError as error:
                if error.errno not in (errno.EIO, errno.EAGAIN, errno.EWOULDBLOCK):
                    raise
                data = b''
            view = memoryview(data)
            while view:
                view = view[os.write(1, view):]
        else:
            time.sleep(.01)
    return False


def terminate(pid, master=None):
    if master is not None:
        os.set_blocking(master, False)
        for _ in range(2):
            try:
                os.write(master, b'\x03')
            except OSError:
                break
            if wait_for_exit(pid, master, .5):
                return
    owned = descendants(pid)
    signal_group(pid, signal.SIGTERM)
    for child in sorted(owned, reverse=True):
        try:
            os.kill(child, signal.SIGTERM)
        except ProcessLookupError:
            pass
        except PermissionError as error:
            if child == pid:
                raise PermissionError('Cannot stop the owned source CLI under this process-control policy; prepared context remains on disk') from error
    exited = wait_for_exit(pid, master, 3)
    signal_group(pid, signal.SIGKILL)
    for child in owned:
        try:
            os.kill(child, signal.SIGKILL)
        except ProcessLookupError:
            pass
        except PermissionError as error:
            if child == pid and not exited:
                raise PermissionError('Source CLI could not be stopped; process-control policy prevents this handoff') from error
    if exited or wait_for_exit(pid, master, 3):
        return
    raise RuntimeError(f'Source CLI {pid} did not exit after SIGTERM/SIGKILL and PTY drain; prepared context remains on disk')


def interactive_args(agent, executable, args):
    if agent != 'codex':
        return args
    if any(arg == '--remote' or arg.startswith('--remote=') for arg in args):
        raise ValueError('Managed handoffs require local terminal CLI execution; --remote is unsupported')
    # Preserve the native server choice. Forcing --no-daemon makes an existing
    # daemon-owned thread conflict with a separate writer during resume.
    return args


def context_args(agent, args, directories, environment=None):
    # Codex rejects --add-dir under effective read-only permissions, including
    # its default in an untrusted project. Do not change the user's policy or
    # make startup depend on whether a later collector needs write approval.
    if agent == 'codex':
        # Even shell-environment -c overrides exclude the shared daemon in Codex.
        # Preserve the user's argv exactly; use terminal output to rendezvous if
        # the daemon does not inherit this terminal's connection environment.
        return list(args)
    # Claude accepts additional directories independently of Codex's policy.
    args = list(args)
    boundary = args.index('--') if '--' in args else len(args)
    existing = [index for index, arg in enumerate(args[:boundary]) if arg == '--add-dir' or arg.startswith('--add-dir=')]
    if existing:
        index = existing[-1] + 1
        return [*args[:index], *directories, *args[index:]]
    # Claude's option is variadic. Put it after the positional prompt, or before
    # an explicit end-of-options marker, so it cannot swallow that prompt.
    return [*args[:boundary], '--add-dir', *directories, *args[boundary:]]


def accept_terminal_request(identity, agent, cwd, environment):
    directory = Path('/tmp', 'agent-handoff-requests-' + str(os.getuid()))
    request = directory / (identity + '.json')
    claimed = directory / (identity + '.claimed')
    stat = request.lstat()
    parent = directory.lstat()
    if request.is_symlink() or directory.is_symlink() or not request.is_file() or stat.st_uid != os.getuid() or parent.st_uid != os.getuid() or (stat.st_mode | parent.st_mode) & 0o077 or stat.st_size > 8192:
        raise ValueError('Invalid private terminal handoff request')
    spec = json.loads(request.read_text())
    if not isinstance(spec, dict) or spec.get('id') != identity or spec.get('source') != agent or agent != 'codex' or spec.get('cwd') != cwd:
        raise ValueError('Terminal handoff source or workspace mismatch')
    if not isinstance(spec.get('session'), str) or not re.fullmatch(r'[a-zA-Z0-9_-]{1,200}', spec['session']):
        raise ValueError('Terminal handoff requires an exact source session')
    if not isinstance(spec.get('createdAt'), (int, float)) or not 0 <= time.time() * 1000 - spec['createdAt'] <= 120000:
        raise ValueError('Terminal handoff request expired')
    request.rename(claimed)  # Only the terminal which sees this marker claims it.
    try:
        command = [shutil.which('node') or 'node', str(Path(__file__).with_name('handoff.mjs')), 'transfer', '--from', agent,
                   '--session', spec['session'], '--cwd', cwd, '--prepare-only']
        for option, key in (('--codex-model', 'codexModel'), ('--claude-model', 'claudeModel')):
            if spec.get(key):
                if not isinstance(spec[key], str):
                    raise ValueError('Invalid terminal handoff model')
                command.extend([option, spec[key]])
        result = subprocess.run(command, env=environment, cwd=cwd, capture_output=True, text=True, timeout=65)
        if result.returncode:
            raise ValueError('Cannot prepare terminal handoff: ' + result.stderr.strip()[:1000])
        prefix = 'Context transferred locally: '
        manifests = [line[len(prefix):] for line in result.stdout.splitlines() if line.startswith(prefix)]
        if len(manifests) != 1:
            raise ValueError('Collector did not return a handoff manifest')
        launch = Path(manifests[0]).with_name('launch.json')
        control = Path(environment['HANDOFF_CONTROL'])
        staged = control / (identity + '.pending')
        with staged.open('x') as output:
            os.chmod(staged, 0o600)
            json.dump({'token': environment['HANDOFF_NONCE'], 'launch': str(launch)}, output)
        staged.rename(control / (identity + '.request'))
    finally:
        claimed.unlink(missing_ok=True)


def run(agent, cli_args):
    if agent not in ('claude', 'codex'):
        raise ValueError('Choose codex or claude')
    if not sys.stdin.isatty() or not sys.stdout.isatty():
        raise ValueError('An interactive terminal is required. Run agent-handoff from a terminal shell.')
    if os.environ.get('HANDOFF_CONTROL'):
        raise ValueError('Nested terminal supervisors are disabled')
    commands = {name: shutil.which(os.environ.get('HANDOFF_' + name.upper() + '_BIN', name)) for name in ('claude', 'codex')}
    if not commands[agent]:
        raise ValueError(agent + ' CLI is missing from PATH; install and authenticate it first')
    cli_args = interactive_args(agent, commands[agent], cli_args)
    cwd = os.path.realpath(os.getcwd())
    chain = str(uuid.uuid4())
    root = os.path.abspath(os.path.expanduser(os.environ.get('HANDOFF_ROOT', '~/.claude/handoffs')))
    Path(root, chain).mkdir(parents=True, mode=0o700)
    previous = ''
    terminal_state = termios.tcgetattr(0)
    active = None
    master = None
    shutting_down = False
    shutdown_signal = 0

    def shutdown(signum, frame):
        nonlocal shutting_down, shutdown_signal
        shutting_down = True
        shutdown_signal = signum

    def resize(signum=None, frame=None):
        # pty.fork() returns master=-1 in the child. A SIGWINCH can arrive
        # between fork and exec while the child still has our signal handler.
        if master is not None and master >= 0:
            try:
                size = fcntl.ioctl(0, termios.TIOCGWINSZ, struct.pack('HHHH', 0, 0, 0, 0))
                rows, columns, _, _ = struct.unpack("HHHH", size)
                if not rows or not columns:
                    size = struct.pack("HHHH", 24, 80, 0, 0)
                fcntl.ioctl(master, termios.TIOCSWINSZ, size)
            except OSError:
                pass

    old_handlers = {sig: signal.signal(sig, shutdown) for sig in (signal.SIGTERM, signal.SIGHUP, signal.SIGINT)}
    old_handlers[signal.SIGWINCH] = signal.signal(signal.SIGWINCH, resize)
    buffered_input = b''
    with tempfile.TemporaryDirectory(prefix='agent-handoff-', dir='/tmp') as temporary:
        os.chmod(temporary, 0o700)
        try:
            tty.setraw(0)
            while not shutting_down:
                token = secrets.token_hex(32)  # Old clients cannot switch a later CLI.
                env = dict(os.environ, HANDOFF_CONTROL=temporary, HANDOFF_NONCE=token,
                           HANDOFF_CHAIN_ID=chain, HANDOFF_ROOT=root,
                           HANDOFF_SOURCE=agent, HANDOFF_PREVIOUS=previous)
                # Native session ids must come from the current CLI, never its predecessor.
                for key in ('CLAUDECODE', 'CLAUDE_SESSION_ID', 'CLAUDE_CODE_SESSION_ID', 'CODEX_THREAD_ID'):
                    env.pop(key, None)
                launch_args = context_args(agent, cli_args, [str(Path(root, chain)), temporary], env)
                active, master = pty.fork()
                if active == 0:
                    try:
                        # Each child receives a normal baseline on its own PTY;
                        # the outer terminal stays raw throughout every switch.
                        termios.tcsetattr(0, termios.TCSANOW, terminal_state)
                        os.chdir(cwd)
                        os.execve(commands[agent], [commands[agent], *launch_args], env)
                    except Exception as error:
                        os.write(2, ('Cannot launch ' + agent + ': ' + str(error) + '\n').encode())
                        os._exit(127)
                generation_pid = active
                os.set_blocking(master, False)
                registration = Path(temporary, 'supervisor.json')
                with registration.open('w') as output:
                    os.chmod(registration, 0o600)
                    json.dump({'pid': os.getpid(), 'source': agent, 'cwd': cwd}, output)
                heartbeat = time.monotonic()
                resize()
                input_queue = bytearray(buffered_input)
                buffered_input = b''
                pending = None
                switch_at = None
                exit_status = None
                terminal_tail = b''
                seen_markers = set()
                while not shutting_down:
                    if time.monotonic() - heartbeat >= 1:
                        registration.touch()
                        heartbeat = time.monotonic()
                    readers = [master] + ([0] if len(input_queue) < 1024 * 1024 else [])
                    ready, writable, _ = select.select(readers, [master] if input_queue else [], [], .1)
                    if master in writable:
                        try:
                            written = os.write(master, input_queue)
                            del input_queue[:written]
                        except OSError as error:
                            if error.errno not in (errno.EIO, errno.EAGAIN, errno.EWOULDBLOCK):
                                raise
                    if 0 in ready:
                        data = os.read(0, 65536)
                        if not data:
                            shutting_down = True
                            break
                        input_queue.extend(data)
                    if master in ready:
                        try:
                            data = os.read(master, 65536)
                        except OSError as error:
                            if error.errno not in (errno.EIO, errno.EAGAIN, errno.EWOULDBLOCK):
                                raise
                            data = b''
                        if data:
                            # A terminal write may be partial.
                            view = memoryview(data)
                            while view:
                                view = view[os.write(1, view):]
                            terminal_tail = (terminal_tail + data)[-32768:]
                            plain = re.sub(r'\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07]*(?:\x07|\x1b\\)', '', terminal_tail.decode(errors='replace'))
                            for identity in re.findall(r'HANDOFF_READY_([a-f0-9]{32})', re.sub(r'\s+', '', plain)):
                                if identity in seen_markers or pending:
                                    continue
                                seen_markers.add(identity)
                                try:
                                    accept_terminal_request(identity, agent, cwd, env)
                                except FileNotFoundError:
                                    pass  # Old markers in resumed history are harmless.
                                except (ValueError, OSError, TypeError, subprocess.TimeoutExpired) as error:
                                    os.write(1, ('\r\n[Handoff preparation failed; source remains open: ' + str(error) + ']\r\n').encode())
                    for request_file in Path(temporary).glob('*.request'):
                        response_file = request_file.with_suffix('.response')
                        if response_file.exists():
                            continue
                        try:
                            if request_file.stat().st_size > 8192:
                                raise ValueError('Request too large')
                            request = json.loads(request_file.read_text())
                            if not isinstance(request, dict):
                                raise ValueError('Invalid terminal request object')
                            if not secrets.compare_digest(request.get('token', ''), token):
                                raise ValueError('Stale or invalid terminal token')
                            if pending:
                                raise ValueError('A handoff is already pending')
                            launch_file = Path(request['launch']).resolve(strict=True)
                            if not launch_file.is_relative_to(Path(root, chain).resolve()):
                                raise ValueError('Handoff package is outside the active chain')
                            spec = json.loads(launch_file.read_text())
                            manifest_file = Path(spec['manifest']).resolve(strict=True)
                            if manifest_file != launch_file.with_name('transfer.json'):
                                raise ValueError('Manifest must be in the transfer package')
                            manifest = json.loads(manifest_file.read_text())
                            target = 'claude' if agent == 'codex' else 'codex'
                            if spec['target'] != target or spec['cwd'] != cwd or spec['chainId'] != chain:
                                raise ValueError('Handoff target, chain or workspace mismatch')
                            if manifest['source'] != agent or manifest['previous'] != (previous or None) or manifest['chainId'] != chain or manifest['cwd'] != cwd or manifest['target'] != target:
                                raise ValueError('Handoff source or predecessor mismatch')
                            executable = shutil.which(os.environ.get('HANDOFF_' + target.upper() + '_BIN', target))
                            if not executable:
                                raise ValueError(target + ' CLI is missing from PATH; install it and retry. Source session remains active.')
                            if not isinstance(spec['args'], list) or not all(isinstance(arg, str) for arg in spec['args']):
                                raise ValueError('Invalid CLI arguments')
                            spec['args'] = interactive_args(target, executable, spec['args'])
                            commands[target] = executable
                            reply = {'ok': True}
                            pending = spec
                            switch_at = time.monotonic() + .5
                        except (ValueError, KeyError, OSError, TypeError) as error:
                            reply = {'ok': False, 'error': str(error)}
                            if request_file.stem in seen_markers:
                                os.write(1, ('\r\n[Handoff failed; source remains open: ' + str(error) + ']\r\n').encode())
                        staged = response_file.with_suffix('.tmp')
                        with staged.open('x') as output:
                            os.chmod(staged, 0o600)
                            json.dump(reply, output)
                        staged.replace(response_file)
                    done, status = os.waitpid(active, os.WNOHANG)
                    if done:
                        active = None
                        exit_status = os.waitstatus_to_exitcode(status)
                        break
                    if pending and time.monotonic() >= switch_at:
                        break
                if active:
                    if pending:
                        os.write(1, ('\r\n[Finishing ' + agent + ' session for handoff]\r\n').encode())
                    terminate(active, master)
                    active = None
                # Reap normal exits too: a CLI must not leave children holding its PTY.
                signal_group(generation_pid, signal.SIGKILL)
                # Drain final buffered output before closing the PTY.
                drain_deadline = time.monotonic() + .5
                while time.monotonic() < drain_deadline and select.select([master], [], [], 0)[0]:
                    try:
                        final_output = os.read(master, 65536)
                    except OSError as error:
                        if error.errno in (errno.EIO, errno.EAGAIN, errno.EWOULDBLOCK):
                            break
                        raise
                    if not final_output:
                        break
                    view = memoryview(final_output)
                    while view:
                        view = view[os.write(1, view):]
                os.close(master)
                master = None
                reset_application_modes()
                if shutting_down or not pending:
                    if shutdown_signal:
                        return 128 + shutdown_signal
                    return 128 - exit_status if exit_status is not None and exit_status < 0 else (exit_status or 0)
                previous = pending['manifest']
                cli_args = pending['args']
                agent = pending['target']
                # The terminal may have queued mouse reports before the reset.
                # Collect complete input batches and retain real type-ahead.
                queued = bytearray(input_queue)
                while len(queued) < 1024 * 1024 and select.select([0], [], [], 0)[0]:
                    block = os.read(0, 65536)
                    if not block:
                        break
                    queued.extend(block)
                buffered_input = transition_input(bytes(queued))
                os.write(1, ('\r\n[Context transferred. Opening ' + agent + ' CLI]\r\n').encode())
        finally:
            try:
                try:
                    if active:
                        terminate(active, master)
                finally:
                    if master is not None:
                        os.close(master)
            finally:
                try:
                    reset_application_modes()
                finally:
                    try:
                        # Discard queued application input only on final exit;
                        # do not expose stale mouse reports to the parent shell.
                        try:
                            termios.tcflush(0, termios.TCIFLUSH)
                        finally:
                            termios.tcsetattr(0, termios.TCSADRAIN, terminal_state)
                    finally:
                        for sig, handler in old_handlers.items():
                            signal.signal(sig, handler)


if __name__ == '__main__':
    try:
        if len(sys.argv) < 2:
            raise ValueError('Usage: terminal.py codex|claude [CLI options]')
        sys.exit(run(sys.argv[1], sys.argv[2:]))
    except (ValueError, OSError, RuntimeError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
