#!/bin/bash
# PostToolUse(Bash) hook: after any bash command that (re)generates a
# layout/render artifact for the SnowGram project, require the agent to get
# the user's explicit visual sign-off before the turn ends. Sets a marker
# file that the Stop hook (visual_gate_stop.sh) checks.
MARKER="$HOME/Documents/SnowGram/.cortex/PENDING_VISUAL_REVIEW"
INPUT="$(cat)"
CMD="$(echo "$INPUT" | python3 -c "import json,sys
try:
    d = json.load(sys.stdin)
    print(d.get('tool_input', {}).get('command', ''))
except Exception:
    print('')" 2>/dev/null)"

if echo "$CMD" | grep -qE "review_harness\.py|render_local\.py|LAYOUT_DIAGRAM\.(devtemp\.)?sql|render_diagram\.dev\.sql|GENERATE_(DIAGRAM|TEMPLATE)_ARTIFACTS"; then
  mkdir -p "$(dirname "$MARKER")"
  touch "$MARKER"
  echo "VISUAL VERIFICATION GATE ARMED: a layout/render artifact was just (re)generated or deployed. Before ending this turn you MUST call ask_user_question, referencing the specific new screenshot(s)/artifact(s), and get the user's explicit visual confirmation -- do not just describe or summarize it as done. Once you have asked (regardless of their answer), the gate clears automatically. Marker: $MARKER"
fi
exit 0
