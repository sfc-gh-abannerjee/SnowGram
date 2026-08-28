#!/bin/bash
# PostToolUse(*) hook: clears the visual-verification marker once the agent
# actually calls the ask-user-question tool (matched case-insensitively on
# tool_name so it's robust to exact naming/casing). Conservative on purpose:
# any question clears it, since forgetting to clear is the failure mode that
# actually risks trapping the session, not clearing slightly too eagerly.
MARKER="$HOME/Documents/SnowGram/.cortex/PENDING_VISUAL_REVIEW"
INPUT="$(cat)"
TOOL="$(echo "$INPUT" | python3 -c "import json,sys
try:
    print(json.load(sys.stdin).get('tool_name',''))
except Exception:
    print('')" 2>/dev/null)"

if [ -f "$MARKER" ] && echo "$TOOL" | grep -qiE "question"; then
  rm -f "$MARKER"
  echo "Visual verification gate cleared -- ask_user_question was called."
fi
exit 0
