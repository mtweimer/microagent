#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export MICRO_CLAW_HOME="$ROOT_DIR"
PID_DIR="$ROOT_DIR/data"
PID_FILE="$PID_DIR/microclaw.pid"
LOG_FILE="$PID_DIR/microclaw.log"

mkdir -p "$PID_DIR"

command_exists() {
  command -v "$1" >/dev/null 2>&1
}

ensure_node() {
  if ! command_exists node; then
    echo "node is required but not found on PATH"
    exit 1
  fi
}

is_running() {
  if [[ ! -f "$PID_FILE" ]]; then
    return 1
  fi
  local pid
  pid="$(cat "$PID_FILE" 2>/dev/null || true)"
  [[ -n "$pid" ]] || return 1
  kill -0 "$pid" 2>/dev/null
}

start_daemon() {
  ensure_node
  local extra_args=("$@")
  if is_running; then
    echo "micro-claw already running (pid $(cat "$PID_FILE"))"
    return 0
  fi
  nohup bash -lc "cd '$ROOT_DIR' && exec npm run run -- ${extra_args[*]:-}" >"$LOG_FILE" 2>&1 &
  local pid=$!
  echo "$pid" >"$PID_FILE"
  echo "micro-claw started in daemon mode (pid $pid)"
  echo "log: $LOG_FILE"
}

start_foreground() {
  ensure_node
  cd "$ROOT_DIR"
  exec npm run run -- "$@"
}

stop_daemon() {
  if ! is_running; then
    echo "micro-claw is not running"
    rm -f "$PID_FILE"
    return 0
  fi

  local pid
  pid="$(cat "$PID_FILE")"
  kill "$pid" 2>/dev/null || true

  for _ in {1..20}; do
    if ! kill -0 "$pid" 2>/dev/null; then
      rm -f "$PID_FILE"
      echo "micro-claw stopped"
      return 0
    fi
    sleep 0.1
  done

  kill -9 "$pid" 2>/dev/null || true
  rm -f "$PID_FILE"
  echo "micro-claw force-stopped"
}

show_status() {
  if is_running; then
    echo "running (pid $(cat "$PID_FILE"))"
    echo "log: $LOG_FILE"
  else
    echo "stopped"
  fi
}

rebuild() {
  ensure_node
  if command_exists npm; then
    cd "$ROOT_DIR"
    exec npm run build
  fi
  echo "npm is required but not found on PATH"
  exit 1
}

update_local() {
  ensure_node
  if command_exists npm; then
    cd "$ROOT_DIR"
    exec npm run update
  fi
  echo "npm is required but not found on PATH"
  exit 1
}

show_help() {
  cat <<'EOF'
Usage:
  ./microclaw.sh run [--profile <name>]
  ./microclaw.sh up [--profile <name>]
  ./microclaw.sh down
  ./microclaw.sh start [--daemon]
  ./microclaw.sh stop
  ./microclaw.sh restart [--daemon]
  ./microclaw.sh status
  ./microclaw.sh rebuild
  ./microclaw.sh build
  ./microclaw.sh update
  ./microclaw.sh logs
  ./microclaw.sh help

Notes:
  - run/start (no daemon flag) run interactive CLI in foreground.
  - up: doctor then interactive run.
  - down: stop daemon mode if running.
  - start --daemon runs in background and writes logs to data/microclaw.log.
  - update: safe local refresh (npm install + build), no git pull.
EOF
}

main() {
  local cmd="${1:-help}"
  local flag="${2:-}"

  case "$cmd" in
    run)
      shift || true
      start_foreground "$@"
      ;;
    up)
      shift || true
      cd "$ROOT_DIR"
      npm run doctor -- "$@"
      exec npm run run -- "$@"
      ;;
    down)
      stop_daemon
      ;;
    start)
      if [[ "$flag" == "--daemon" ]]; then
        shift 2 || true
        start_daemon "$@"
      else
        shift || true
        start_foreground "$@"
      fi
      ;;
    stop)
      stop_daemon
      ;;
    restart)
      stop_daemon
      if [[ "$flag" == "--daemon" ]]; then
        shift 2 || true
        start_daemon "$@"
      else
        shift || true
        start_foreground "$@"
      fi
      ;;
    status)
      show_status
      ;;
    rebuild)
      rebuild
      ;;
    build)
      rebuild
      ;;
    update)
      update_local
      ;;
    logs)
      touch "$LOG_FILE"
      tail -n 100 -f "$LOG_FILE"
      ;;
    help|-h|--help)
      show_help
      ;;
    *)
      echo "unknown command: $cmd"
      show_help
      exit 1
      ;;
  esac
}

main "$@"
