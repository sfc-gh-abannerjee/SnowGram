#!/usr/bin/env bash
# deploy_layout_diagram.sh — the ONLY supported way to deploy
# deploy/LAYOUT_DIAGRAM.sql via the snow CLI.
#
# Why this script exists (do not bypass it with a bare `snow sql -f`):
# `snow sql -f`/`-q` performs client-side legacy SnowSQL-style variable
# substitution by default (--enable-templating defaults to LEGACY,STANDARD),
# which treats `&&` in the UDF's JavaScript body as an *escaped single
# ampersand* and silently collapses it to `&` (bitwise AND, non-short-
# circuiting) before the statement reaches Snowflake. CREATE OR REPLACE
# FUNCTION still succeeds with no error -- the corruption only surfaces at
# CALL time as `TypeError: Cannot read properties of undefined (reading
# 'length')` on the first `x && x.length`-shaped guard, usually on the very
# first invocation. Documented 2026-08-28 in AGENT_INTEGRATION_RUNBOOK.md;
# re-discovered the hard way 2026-09-09 after a route.mjs fix appeared to
# break the live agent, when the real cause was this exact corruption in
# a deploy that forgot the flag.
#
# Usage:
#   ./deploy_layout_diagram.sh <TARGET_DB.SCHEMA> [snow-connection-name]
# Example:
#   ./deploy_layout_diagram.sh TEMP.ABANNERJEE snowhouse
#   ./deploy_layout_diagram.sh SNOWGRAM_DB.CORE        # uses default connection

set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="$HERE/LAYOUT_DIAGRAM.sql"

if [ $# -lt 1 ]; then
  echo "usage: $0 <TARGET_DB.SCHEMA> [snow-connection-name]" >&2
  exit 1
fi
TARGET="$1"
CONN_ARGS=()
if [ $# -ge 2 ]; then
  CONN_ARGS=(-c "$2")
fi

TMP_SQL="$(mktemp -t layout_diagram_deploy).sql"
trap 'rm -f "$TMP_SQL"' EXIT
sed "s/SNOWGRAM_DB\.CORE\.LAYOUT_DIAGRAM/${TARGET}.LAYOUT_DIAGRAM/" "$SRC" > "$TMP_SQL"

echo "Deploying LAYOUT_DIAGRAM to ${TARGET} (--enable-templating NONE, required -- see header comment)..."
snow sql -f "$TMP_SQL" "${CONN_ARGS[@]}" --enable-templating NONE

echo
echo "Verifying no && -> & corruption in the deployed body..."
python3 - "$TARGET" "${2:-}" <<'PYEOF'
import subprocess, sys, json, re
target, conn = sys.argv[1], sys.argv[2]
db, schema = target.split('.')
args = ["snow", "sql", "-q",
        f"SELECT GET_DDL('FUNCTION', '{target}.LAYOUT_DIAGRAM(VARCHAR)') AS ddl;",
        "--format", "JSON"]
if conn:
    args += ["-c", conn]
out = subprocess.run(args, capture_output=True, text=True, check=True).stdout
rows = json.loads(out)
ddl = rows[0]['DDL'] if rows else ''
bad = len(re.findall(r'(?<!&)&(?!&)', ddl))
if bad:
    print(f"CORRUPTION DETECTED: {bad} lone '&' found where '&&' should be -- deploy is BROKEN.", file=sys.stderr)
    sys.exit(1)
print("OK -- no && corruption detected in the deployed function body.")
PYEOF
