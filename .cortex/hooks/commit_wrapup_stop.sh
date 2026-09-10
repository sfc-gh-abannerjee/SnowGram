#!/bin/bash
# Stop hook: refuses to let the agent end its turn while either half of the
# commit wrap-up checklist is still pending -- gives the existing (and
# deliberately non-blocking) ctx-tracker-reminder.sh actual teeth for this
# repo specifically.
REPO="$HOME/Documents/SnowGram"
CTX_MARKER="$REPO/.cortex/PENDING_CTX_SYNC"
DOCS_MARKER="$REPO/.cortex/PENDING_LIVING_DOCS"

PENDING=""
[ -f "$CTX_MARKER" ] && PENDING="${PENDING}ctx tracker (run cortex ctx step/task done for the just-committed work); "
[ -f "$DOCS_MARKER" ] && PENDING="${PENDING}living docs (update CHANGELOG.md/docs/STATUS.md/docs/decisions/your docs/HANDOFF_<author>.md in a follow-up commit, OR run 'touch $REPO/.cortex/ACK_NO_DOCS_NEEDED' if genuinely none apply); "

if [ -n "$PENDING" ]; then
  PENDING="$PENDING" python3 -c "
import json, os
pending = os.environ['PENDING']
reason = 'Commit wrap-up is incomplete for a commit made this turn -- still pending: ' + pending + 'Address these before ending the turn. This is the same checklist ctx-tracker-reminder.sh already suggests after every git commit; this hook just enforces it.'
print(json.dumps({'continue': False, 'stopReason': reason}))
"
  exit 0
fi
exit 0
