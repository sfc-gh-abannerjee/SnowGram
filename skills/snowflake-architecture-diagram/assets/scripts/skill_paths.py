"""
Canonical path resolver for the snowflake-architecture-diagram skill (Python).

Import this module from any Python helper that needs absolute paths to
skill assets — never compute paths via __file__.parent chains in random
scripts. This single source of truth handles symlinked installs.

Usage:
    from skill_paths import (
        SKILL_DIR, ASSETS_DIR, TEMPLATES_DIR, COMPOSER_DIR,
        VIEWER_DIR, SCRIPTS_DIR, FUNCTIONS_DIR, STATE_FILE,
    )

CLI:
    python3 skill_paths.py            # prints all paths
    python3 skill_paths.py --json     # JSON dump for programmatic use
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

# Resolve through symlinks (install.sh creates one in ~/.snowflake/cortex/skills/)
_SCRIPTS_ABS: Path = Path(__file__).resolve().parent

SKILL_DIR: Path = _SCRIPTS_ABS.parent.parent
ASSETS_DIR: Path = SKILL_DIR / "assets"
TEMPLATES_DIR: Path = ASSETS_DIR / "templates"
COMPOSER_DIR: Path = ASSETS_DIR / "composer"
VIEWER_DIR: Path = ASSETS_DIR / "viewer"
SCRIPTS_DIR: Path = ASSETS_DIR / "scripts"
FUNCTIONS_DIR: Path = ASSETS_DIR / "functions"
STATE_FILE: Path = VIEWER_DIR / "state.json"

# Snapshot files
COMPONENT_BLOCKS_JSON: Path = ASSETS_DIR / "component_blocks.json"
COMPONENT_SYNONYMS_JSON: Path = ASSETS_DIR / "component_synonyms.json"
SNAPSHOT_META_JSON: Path = ASSETS_DIR / "_snapshot_meta.json"


def as_dict() -> dict[str, str]:
    """Return all paths as a plain dict of strings."""
    return {
        "skill_dir":              str(SKILL_DIR),
        "assets_dir":             str(ASSETS_DIR),
        "templates_dir":          str(TEMPLATES_DIR),
        "composer_dir":           str(COMPOSER_DIR),
        "viewer_dir":             str(VIEWER_DIR),
        "scripts_dir":            str(SCRIPTS_DIR),
        "functions_dir":          str(FUNCTIONS_DIR),
        "state_file":             str(STATE_FILE),
        "component_blocks_json":  str(COMPONENT_BLOCKS_JSON),
        "component_synonyms_json": str(COMPONENT_SYNONYMS_JSON),
        "snapshot_meta_json":     str(SNAPSHOT_META_JSON),
    }


def _main() -> int:
    if "--json" in sys.argv:
        print(json.dumps(as_dict(), indent=2))
    else:
        for k, v in as_dict().items():
            print(f"{k} = {v}")
    return 0


if __name__ == "__main__":
    sys.exit(_main())
