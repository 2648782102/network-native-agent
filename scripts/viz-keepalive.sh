#!/bin/zsh
set -euo pipefail

ROOT="${0:A:h:h}"
LOG="/tmp/nna-viz-keepalive.log"
PORT="${NNA_VIZ_PORT:-8789}"
NODE_BIN="$(command -v node)"

while true; do
  if ! /usr/bin/curl -fsS --max-time 2 "http://127.0.0.1:${PORT}/health" >/dev/null 2>&1; then
    echo "$(date -u +%FT%TZ) starting viz server" >> "$LOG"
    /usr/bin/nohup "$NODE_BIN" "$ROOT/scripts/viz-server.mjs" >> "$LOG" 2>&1 &
  fi
  sleep 3
done
