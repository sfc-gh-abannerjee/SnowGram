#!/usr/bin/env bash
# Stop the running viewer (reads PID from .runtime/viewer.json).
set -euo pipefail

VIEWER_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../viewer" && pwd)"
RUNTIME="$VIEWER_DIR/.runtime/viewer.json"

if [ ! -f "$RUNTIME" ]; then
  echo "No viewer.json found. Is the viewer running?"
  exit 0
fi

PID=$(python3 -c "import json,sys; print(json.load(open('$RUNTIME'))['pid'])")
PORT=$(python3 -c "import json,sys; print(json.load(open('$RUNTIME'))['port'])")

if kill -0 "$PID" 2>/dev/null; then
  kill "$PID"
  echo "Stopped viewer (pid=$PID, port=$PORT)"
else
  echo "Viewer pid $PID is not running (stale PID file)"
fi

rm -f "$RUNTIME"
