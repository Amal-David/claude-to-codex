#!/usr/bin/env python3
"""Opt-in, human-operated check of authenticated interactive CLI handoffs."""
import argparse
import json
import os
from pathlib import Path
import secrets
import shutil
import subprocess
import sys
import tempfile


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, help='New directory for retained test artifacts')
    args = parser.parse_args()
    if not sys.stdin.isatty() or not sys.stdout.isatty():
        parser.error('Run this check directly in your normal interactive terminal.')
    for binary in ('node', 'claude', 'codex'):
        if not shutil.which(binary):
            parser.error(f'Missing {binary}; install it and put it on PATH first.')
    auth = subprocess.run(['claude', 'auth', 'status'], capture_output=True, text=True)
    try:
        logged_in = json.loads(auth.stdout).get('loggedIn') is True
    except (ValueError, AttributeError):
        logged_in = False
    if not logged_in:
        parser.error('Claude authentication is unavailable to this process. Run in the terminal where claude auth status succeeds.')
    if os.environ.get('HANDOFF_CONTROL'):
        parser.error('Run from your normal shell, outside an existing supervised agent.')
    root = args.root.expanduser().resolve() if args.root else Path(tempfile.mkdtemp(prefix='authenticated-handoff-')).resolve()
    if args.root:
        root.mkdir(mode=0o700, parents=True, exist_ok=False)
    root.chmod(0o700)
    project = root / 'project'
    project.mkdir(mode=0o700)
    expected = {'phase-one.txt': 'ready', 'phase-two.txt': secrets.token_hex(16),
                'phase-three.txt': secrets.token_hex(16)}
    prompt = (
        'Authenticated terminal handoff integration test. Work only in this temporary project. '
        'Do not install dependencies, commit, access credentials, or modify any other project. '
        'Keep usage minimal: do not browse, run tests, delegate, or explore unrelated files. '
        'Use one file-writing tool call for the selected phase and reply only: phase complete. '
        'Retain these exact instructions across transfers. On each invocation choose ONLY the '
        'first missing phase file below, write exactly its specified content plus an optional newline, '
        'then stop and wait for the user. Do not create subsequent phase files in the same session. '
        'The initial Claude session must create phase-one.txt. After handoff Codex must read '
        'the handoff package and create phase-two.txt. After handoff back Claude must read '
        'the package and create phase-three.txt. Required contents: ' + json.dumps(expected)
    )
    env = dict(os.environ)
    for key in list(env):
        if key.startswith('HANDOFF_') or key in ('CODEX_THREAD_ID', 'CLAUDECODE', 'CLAUDE_SESSION_ID'):
            env.pop(key)
    env['HANDOFF_ROOT'] = str(root / 'packages')
    # Keep normal HOME/config/authentication and normal CLI permission policies.
    entry = Path(__file__).resolve().parents[1] / 'plugins/claude-to-codex/skills/handoff/scripts/handoff.mjs'
    print(f'Artifacts will remain at {root}\n'
          'This uses your authenticated accounts and sends model requests. Approve normal trust/tool prompts as needed.\n'
          '1. Wait for Claude to create phase-one.txt, then type /handoff.\n'
          '2. Wait for Codex to create phase-two.txt, then type $handoff (or !agent-handoff).\n'
          '3. Wait for Claude to create phase-three.txt, then type /exit.\n', flush=True)
    result = subprocess.run(['node', str(entry), 'claude', prompt], cwd=project, env=env)
    phases = {name: (project / name).is_file() and (project / name).read_text().rstrip('\n') == value
              for name, value in expected.items()}
    manifests = []
    for file in sorted((root / 'packages').glob('**/transfer.json'), key=lambda file: file.stat().st_mtime_ns):
        manifests.append((file, json.loads(file.read_text())))
    directions = [(item.get('source', {}).get('agent') if isinstance(item.get('source'), dict) else item.get('source'),
                   item.get('target')) for _, item in manifests]
    # Check the actual manifest schema rather than inferred terminal output.
    chains = {item.get('chainId') for _, item in manifests}
    linked = len(manifests) == 2 and len(chains) == 1 and None not in chains
    if linked:
        linked = Path(manifests[1][1].get('previous') or '').resolve() == manifests[0][0].resolve()
    objectives = all(all(value in item.get('originalObjective', '') for value in list(expected.values())[1:])
                     for _, item in manifests) and len(manifests) == 2
    report = {'artifacts': str(root), 'cliExitCode': result.returncode, 'phases': phases,
              'directions': directions, 'linkedChain': linked, 'originalObjectivePreserved': objectives}
    report['authenticatedRoundTrip'] = (result.returncode == 0 and all(phases.values()) and linked and objectives
                                        and directions == [('claude', 'codex'), ('codex', 'claude')])
    (root / 'result.json').write_text(json.dumps(report, indent=2) + '\n')
    (root / 'result.json').chmod(0o600)
    print(json.dumps(report, indent=2))
    return 0 if report['authenticatedRoundTrip'] else 1


if __name__ == '__main__':
    sys.exit(main())
