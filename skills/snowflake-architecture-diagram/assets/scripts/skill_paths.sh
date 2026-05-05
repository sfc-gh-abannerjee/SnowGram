#!/usr/bin/env bash
# Canonical path resolver for the snowflake-architecture-diagram skill.
#
# SOURCE this file from any bash workflow inside a SKILL.md to get
# consistent absolute paths to all skill assets, regardless of where
# the skill was invoked from or whether it was loaded via symlink.
#
# Usage:
#   source "$(dirname "${BASH_SOURCE[0]}")/skill_paths.sh"
# OR (when called from elsewhere):
#   source "<absolute_path_to>/assets/scripts/skill_paths.sh"
#
# After sourcing, these variables are exported:
#   SKILL_DIR        absolute path to the skill root
#   ASSETS_DIR       $SKILL_DIR/assets
#   TEMPLATES_DIR    $ASSETS_DIR/templates
#   COMPOSER_DIR     $ASSETS_DIR/composer
#   VIEWER_DIR       $ASSETS_DIR/viewer
#   SCRIPTS_DIR      $ASSETS_DIR/scripts
#   FUNCTIONS_DIR    $ASSETS_DIR/functions
#   STATE_FILE       $VIEWER_DIR/state.json
#
# These are also exposed as a JSON blob via:
#   skill_paths.sh --print-json

set +u  # be tolerant of unset vars when sourced

# Resolve symlinks so the helper works after install.sh symlinks the skill
# into ~/.snowflake/cortex/skills/...
__skill_paths_resolve_self() {
  local src="${BASH_SOURCE[0]}"
  while [ -L "$src" ]; do
    local target
    target="$(readlink "$src")"
    case "$target" in
      /*) src="$target" ;;
      *)  src="$(cd "$(dirname "$src")" && pwd)/$target" ;;
    esac
  done
  cd "$(dirname "$src")" && pwd
}

__SCRIPTS_ABS="$(__skill_paths_resolve_self)"
SKILL_DIR="$(cd "$__SCRIPTS_ABS/../.." && pwd)"
ASSETS_DIR="$SKILL_DIR/assets"
TEMPLATES_DIR="$ASSETS_DIR/templates"
COMPOSER_DIR="$ASSETS_DIR/composer"
VIEWER_DIR="$ASSETS_DIR/viewer"
SCRIPTS_DIR="$ASSETS_DIR/scripts"
FUNCTIONS_DIR="$ASSETS_DIR/functions"
STATE_FILE="$VIEWER_DIR/state.json"

export SKILL_DIR ASSETS_DIR TEMPLATES_DIR COMPOSER_DIR VIEWER_DIR \
       SCRIPTS_DIR FUNCTIONS_DIR STATE_FILE

# Allow direct invocation for inspection / dumping
if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  case "${1:-}" in
    --print-json)
      cat <<JSON
{
  "skill_dir":     "$SKILL_DIR",
  "assets_dir":    "$ASSETS_DIR",
  "templates_dir": "$TEMPLATES_DIR",
  "composer_dir":  "$COMPOSER_DIR",
  "viewer_dir":    "$VIEWER_DIR",
  "scripts_dir":   "$SCRIPTS_DIR",
  "functions_dir": "$FUNCTIONS_DIR",
  "state_file":    "$STATE_FILE"
}
JSON
      ;;
    *)
      echo "SKILL_DIR=$SKILL_DIR"
      echo "ASSETS_DIR=$ASSETS_DIR"
      echo "TEMPLATES_DIR=$TEMPLATES_DIR"
      echo "COMPOSER_DIR=$COMPOSER_DIR"
      echo "VIEWER_DIR=$VIEWER_DIR"
      echo "SCRIPTS_DIR=$SCRIPTS_DIR"
      echo "FUNCTIONS_DIR=$FUNCTIONS_DIR"
      echo "STATE_FILE=$STATE_FILE"
      ;;
  esac
fi
