#!/usr/bin/env bash
# Symlink this skill into the user-global Cortex Code skills directory
# so it is discoverable across all your projects.
set -euo pipefail

SKILL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET_PARENT="${SNOWFLAKE_HOME:-$HOME/.snowflake}/cortex/skills"
TARGET="$TARGET_PARENT/snowflake-architecture-diagram"

mkdir -p "$TARGET_PARENT"

if [ -L "$TARGET" ]; then
  echo "Skill already symlinked at: $TARGET"
  echo "Pointing to: $(readlink "$TARGET")"
  exit 0
fi

if [ -e "$TARGET" ]; then
  echo "ERROR: $TARGET already exists and is not a symlink." >&2
  echo "Remove or rename it before re-running." >&2
  exit 1
fi

ln -s "$SKILL_DIR" "$TARGET"
echo "Installed: $TARGET -> $SKILL_DIR"
echo
echo "Verify discovery:"
echo "  cortex skill list | grep snowflake-architecture-diagram"
