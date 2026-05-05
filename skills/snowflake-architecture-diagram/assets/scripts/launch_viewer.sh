#!/usr/bin/env bash
# Launch the lightweight viewer locally.
#
# Picks a free port starting at 4380, spawns python3 -m http.server in
# the background, writes a PID file, and opens the default browser
# (cross-platform). The skill's mode sub-skills write state.json before
# calling this script.
#
# Usage:
#   launch_viewer.sh                    # default port range, open browser
#   launch_viewer.sh --no-open          # spawn server, print URL only
#   launch_viewer.sh --port 4400        # request specific starting port

set -euo pipefail

VIEWER_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../viewer" && pwd)"
RUNTIME_DIR="$VIEWER_DIR/.runtime"
mkdir -p "$RUNTIME_DIR"

START_PORT=4380
OPEN_BROWSER=1
while [ $# -gt 0 ]; do
  case "$1" in
    --no-open) OPEN_BROWSER=0; shift ;;
    --port) START_PORT="$2"; shift 2 ;;
    *) echo "Unknown flag: $1" >&2; exit 2 ;;
  esac
done

# Find a free port (try up to 20 in sequence)
port_in_use() {
  if command -v lsof >/dev/null 2>&1; then
    lsof -iTCP:"$1" -sTCP:LISTEN -P -n >/dev/null 2>&1
  else
    (echo > "/dev/tcp/127.0.0.1/$1") >/dev/null 2>&1
  fi
}

PORT=$START_PORT
for i in $(seq 0 19); do
  P=$((START_PORT + i))
  if ! port_in_use "$P"; then PORT=$P; break; fi
done

if port_in_use "$PORT"; then
  echo "ERROR: no free port in $START_PORT-$((START_PORT+19))" >&2
  exit 1
fi

# Spawn the server, redirecting logs to a per-PID file
LOG_FILE="$RUNTIME_DIR/viewer.log"
python3 -m http.server "$PORT" --directory "$VIEWER_DIR" >"$LOG_FILE" 2>&1 &
SERVER_PID=$!

# Wait briefly for it to bind, then verify
sleep 0.4
if ! kill -0 "$SERVER_PID" 2>/dev/null; then
  echo "ERROR: viewer server failed to start. Last log:" >&2
  tail -5 "$LOG_FILE" >&2
  exit 1
fi

# Persist runtime metadata
cat > "$RUNTIME_DIR/viewer.json" <<JSON
{
  "pid": $SERVER_PID,
  "port": $PORT,
  "url": "http://localhost:$PORT/",
  "started_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "viewer_dir": "$VIEWER_DIR"
}
JSON

URL="http://localhost:$PORT/"
echo "Viewer running at: $URL"
echo "PID:               $SERVER_PID"
echo "Stop with:         $(dirname "${BASH_SOURCE[0]}")/stop_viewer.sh"

if [ "$OPEN_BROWSER" -eq 1 ]; then
  if command -v open >/dev/null 2>&1; then
    open "$URL"
  elif command -v xdg-open >/dev/null 2>&1; then
    xdg-open "$URL" >/dev/null 2>&1 &
  elif command -v start >/dev/null 2>&1; then
    start "$URL" >/dev/null 2>&1 &
  else
    echo "(no browser-open command found; visit the URL above manually)"
  fi
fi
