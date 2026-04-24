#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

cleanup() {
  local exit_code=$?
  if [[ -n "${ASTRO_PID:-}" ]] && kill -0 "$ASTRO_PID" 2>/dev/null; then
    kill "$ASTRO_PID" 2>/dev/null || true
  fi
  if [[ -n "${IMPORT_PID:-}" ]] && kill -0 "$IMPORT_PID" 2>/dev/null; then
    kill "$IMPORT_PID" 2>/dev/null || true
  fi
  wait 2>/dev/null || true
  exit "$exit_code"
}

trap cleanup EXIT INT TERM

PUBLIC_RUNTIME_MODE=local-import npm run dev -- --host 127.0.0.1 &
ASTRO_PID=$!

if lsof -iTCP:4327 -sTCP:LISTEN >/dev/null 2>&1; then
  echo "local-import server already running on 127.0.0.1:4327, reusing it"
else
  node ./scripts/local-import-server.mjs &
  IMPORT_PID=$!
fi

wait "$ASTRO_PID" ${IMPORT_PID:+"$IMPORT_PID"}
