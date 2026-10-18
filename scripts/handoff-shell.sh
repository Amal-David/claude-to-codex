# Loaded by the installer from the interactive shell's startup file.
# Executable lookup inside the supervisor bypasses these shell functions.
_agent_handoff_run() {
  local handoff_cli="$1"
  shift
  local handoff_interactive=yes handoff_arg
  if [ ! -t 0 ] || [ ! -t 1 ] || [ -n "${HANDOFF_CONTROL:-}" ]; then
    handoff_interactive=no
  fi
  for handoff_arg in "$@"; do
    case "$handoff_arg" in
      -h|--help|-v|-V|--version|--print|--print=*) handoff_interactive=no ;;
    esac
    # -p is Claude print mode but Codex's interactive profile option.
    case "$handoff_cli:$handoff_arg" in
      claude:-p|claude:-p?*) handoff_interactive=no ;;
    esac
  done
  case "$handoff_cli:${1:-}" in
    codex:exec|codex:e|codex:review|codex:login|codex:logout|codex:mcp|codex:mcp-server|codex:plugin|codex:app-server|codex:exec-server|codex:remote-control|codex:app|codex:update|codex:doctor|codex:agents|codex:queue|codex:archive|codex:delete|codex:unarchive|codex:migrate-rollouts|codex:completion|codex:sandbox|codex:debug|codex:apply|codex:a|codex:cloud|codex:features|codex:help)
      handoff_interactive=no ;;
    claude:auth|claude:doctor|claude:update|claude:upgrade|claude:install|claude:uninstall|claude:mcp|claude:plugin|claude:setup-token|claude:agents|claude:help)
      handoff_interactive=no ;;
  esac
  if [ "$handoff_interactive" = yes ]; then
    "$HOME/.local/bin/agent-handoff" "$handoff_cli" "$@"
  else
    command "$handoff_cli" "$@"
  fi
}
codex() { _agent_handoff_run codex "$@"; }
claude() { _agent_handoff_run claude "$@"; }
