#!/bin/bash
# SnowGram Lane Layout Debug - Autonomous Feedback Loop Runner
# This script enables Cortex Code to run debug iterations autonomously

set -e

PROJECT_DIR="/Users/abannerjee/Documents/SnowGram"
STATE_FILE="$PROJECT_DIR/DEBUG_LANE_LAYOUT.md"
LOG_FILE="$PROJECT_DIR/debug_loop.log"
MAX_ITERATIONS=5

# Initialize state
init_state() {
    cat > "$STATE_FILE" << 'EOF'
# Lane Layout Debug - Autonomous Loop State

## Current Status

```json
{
  "loop_iteration": 0,
  "status": "INITIALIZED",
  "last_action": "none",
  "timestamp": "$(date -Iseconds)"
}
```

## Iteration Log

| Iteration | Action | Result | Timestamp |
|-----------|--------|--------|-----------|

## Debug Output Capture

```
[Awaiting first iteration]
```

## Root Cause Analysis

```
[Awaiting analysis]
```

## Fixes Applied

| Iteration | File | Change | Verified |
|-----------|------|--------|----------|

## Verification Checklist

- [ ] Subgraphs parsed correctly (expect 10)
- [ ] LayoutInfo built correctly (expect 10 entries)
- [ ] Nodes have layoutType metadata
- [ ] hasLayoutMetadata returns true
- [ ] usedLaneLayout is true
- [ ] Lane badges visible (1A, 1B, 1C, 1D)
- [ ] Section badges visible (2, 3, 4, 5)
- [ ] Layout matches reference PDF

## Reference

- Template: STREAMING_DATA_STACK
- Reference PDF: pdf_images/streaming_page4_img0.png
EOF
    echo "[$(date)] State initialized" >> "$LOG_FILE"
}

# Check if debug logging is already injected
check_debug_logging() {
    if grep -q "LOOP-DEBUG" "$PROJECT_DIR/frontend/src/lib/mermaidToReactFlow.ts" 2>/dev/null; then
        echo "present"
    else
        echo "missing"
    fi
}

# Main execution hint for Cortex Code
echo "=================================================="
echo "LANE LAYOUT DEBUG - AUTONOMOUS FEEDBACK LOOP"
echo "=================================================="
echo ""
echo "To run this debug loop with Cortex Code:"
echo ""
echo "  1. Start Cortex Code in this directory:"
echo "     cd $PROJECT_DIR && cortex"
echo ""
echo "  2. Invoke the skill:"
echo "     \$lane-layout-debugger"
echo ""
echo "  3. For fully autonomous mode:"
echo "     \$lane-layout-debugger --autonomous"
echo ""
echo "The agent will:"
echo "  - Inject debug logging (once)"
echo "  - Build and capture console output"
echo "  - Analyze failure point"
echo "  - Apply targeted fix"
echo "  - Loop until success (max $MAX_ITERATIONS iterations)"
echo ""
echo "State tracked in: $STATE_FILE"
echo "Logs written to: $LOG_FILE"
echo "=================================================="

# Initialize if state file doesn't exist
if [ ! -f "$STATE_FILE" ]; then
    init_state
fi
