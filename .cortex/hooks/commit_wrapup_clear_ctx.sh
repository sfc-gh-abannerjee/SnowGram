#!/bin/bash
# PostToolUse(Bash) hook: clears PENDING_CTX_SYNC once a `cortex ctx step`
# or `cortex ctx task` command actually runs (any subcommand -- add/done/
# start/show -- since the point is that the tracker got touched, not that
# one specific verb was used).
CTX_MARKER="$HOME/Documents/SnowGram/.cortex/PENDING_CTX_SYNC"
INPUT="$(cat)"
CMD="$(echo "$INPUT" | python3 -c "import json,sys
try:
    print(json.load(sys.stdin).get('tool_input', {}).get('command', ''))
except Exception:
    print('')" 2>/dev/null)"

if [ -f "$CTX_MARKER" ] && echo "$CMD" | grep -qE 'cortex\s+ctx\s+(step|task)'; then
  rm -f "$CTX_MARKER"
  echo "Commit wrap-up gate: ctx tracker half cleared."
fi
exit 0
