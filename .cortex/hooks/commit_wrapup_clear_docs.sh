#!/bin/bash
# PostToolUse(Bash) hook: clears PENDING_LIVING_DOCS when EITHER (a) a git
# commit's changed-file list includes CHANGELOG.md / docs/STATUS.md /
# docs/decisions/* (whichever exist), or (b) the agent explicitly
# acknowledges none apply via the ACK file. (b) can't verify the reasoning
# behind the acknowledgment -- no hook can -- but it does force a
# deliberate, visible, auditable action instead of silent skipping.
REPO="$HOME/Documents/SnowGram"
DOCS_MARKER="$REPO/.cortex/PENDING_LIVING_DOCS"
ACK_FILE="$REPO/.cortex/ACK_NO_DOCS_NEEDED"
INPUT="$(cat)"
CMD="$(echo "$INPUT" | python3 -c "import json,sys
try:
    print(json.load(sys.stdin).get('tool_input', {}).get('command', ''))
except Exception:
    print('')" 2>/dev/null)"

[ -f "$DOCS_MARKER" ] || exit 0

if echo "$CMD" | grep -qE '\bgit\s+commit\b' && ! echo "$CMD" | grep -q -- "--dry-run"; then
  CHANGED="$(git -C "$REPO" show --stat --name-only HEAD 2>/dev/null)"
  if echo "$CHANGED" | grep -qE '^(CHANGELOG\.md|docs/STATUS\.md|docs/decisions/)'; then
    rm -f "$DOCS_MARKER"
    echo "Commit wrap-up gate: living-docs half cleared (commit touched living docs)."
  fi
fi

if [ -f "$ACK_FILE" ]; then
  rm -f "$DOCS_MARKER" "$ACK_FILE"
  echo "Commit wrap-up gate: living-docs half cleared (explicit ACK -- none applicable)."
fi
exit 0
