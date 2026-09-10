#!/bin/bash
# PostToolUse(Bash) hook: on a real `git commit` (not --dry-run, not a
# read-only lookup), arm TWO markers for the two halves of the existing
# ctx-tracker-reminder.sh checklist -- that hook is deliberately
# non-blocking (informational only); this one gives it actual teeth via the
# Stop hook (commit_wrapup_stop.sh).
CTX_MARKER="$HOME/Documents/SnowGram/.cortex/PENDING_CTX_SYNC"
DOCS_MARKER="$HOME/Documents/SnowGram/.cortex/PENDING_LIVING_DOCS"
INPUT="$(cat)"
CMD="$(echo "$INPUT" | python3 -c "import json,sys
try:
    print(json.load(sys.stdin).get('tool_input', {}).get('command', ''))
except Exception:
    print('')" 2>/dev/null)"

if echo "$CMD" | grep -qE '\bgit\s+commit\b' && ! echo "$CMD" | grep -q -- "--dry-run"; then
  mkdir -p "$(dirname "$CTX_MARKER")"
  touch "$CTX_MARKER" "$DOCS_MARKER"
  echo "COMMIT WRAP-UP GATE ARMED: before ending this turn you must (a) reconcile cortex ctx (step done / task done) for this commit's work, AND (b) either update living docs (CHANGELOG.md / docs/STATUS.md / docs/decisions/ / your docs/HANDOFF_<author>.md -- whichever exist in this repo) in a later commit, or explicitly acknowledge none apply by running: touch $HOME/Documents/SnowGram/.cortex/ACK_NO_DOCS_NEEDED"
fi
exit 0
