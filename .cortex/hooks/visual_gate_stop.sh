#!/bin/bash
# Stop hook: refuses to let the agent end its turn while a layout/render
# artifact was regenerated but never shown to the user for explicit visual
# confirmation. This is the actual enforcement point -- the PostToolUse
# hooks just set/clear the marker this checks.
MARKER="$HOME/Documents/SnowGram/.cortex/PENDING_VISUAL_REVIEW"
if [ -f "$MARKER" ]; then
  cat <<EOF
{"continue": false, "stopReason": "A layout/render artifact was generated or deployed but not yet confirmed by the user. Call ask_user_question now -- reference the specific new screenshot(s) -- and wait for their explicit visual sign-off before ending this turn. This is not optional; do not summarize or declare the change done first."}
EOF
  exit 0
fi
exit 0
