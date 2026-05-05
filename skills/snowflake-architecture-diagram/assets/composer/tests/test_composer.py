"""
Golden test runner: assert composer.py output matches deployed UDF byte-for-byte.

Run: python3 -m unittest skills.snowflake_architecture_diagram.assets.composer.tests.test_composer
or:  cd assets/composer/tests && python3 test_composer.py
"""

from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path

# Allow running as a script
TESTS_DIR = Path(__file__).resolve().parent
COMPOSER_DIR = TESTS_DIR.parent
sys.path.insert(0, str(COMPOSER_DIR))

from composer import compose, load_blocks  # noqa: E402

GOLDEN_DIR = TESTS_DIR / "golden"


class GoldenTest(unittest.TestCase):
    """Each captured golden fixture must round-trip byte-for-byte."""

    @classmethod
    def setUpClass(cls) -> None:
        cls.blocks = load_blocks()

    def _run_case(self, fixture_path: Path) -> None:
        fixture = json.loads(fixture_path.read_text(encoding="utf-8"))
        block_ids = fixture["input"]["block_ids"]
        connections = fixture["input"]["connections"]
        expected = fixture["expected_output"]

        if expected is None:
            self.skipTest(f"Fixture {fixture_path.name} has no captured expected output")

        actual = compose(block_ids, connections, blocks=self.blocks)
        self.assertEqual(
            actual,
            expected,
            f"\n--- expected ---\n{expected}\n--- actual ---\n{actual}\n",
        )

    def test_all_fixtures(self) -> None:
        fixtures = sorted(GOLDEN_DIR.glob("*.json"))
        self.assertGreater(len(fixtures), 0, "No golden fixtures found — run generate_golden.py first")
        for fp in fixtures:
            with self.subTest(case=fp.stem):
                self._run_case(fp)


if __name__ == "__main__":
    unittest.main(verbosity=2)
