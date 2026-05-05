"""
Intent router tests.

Verifies the multi-source detection logic that fixes Sarah's gap and
preserves single-template routing for unambiguous prompts.
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

TESTS_DIR = Path(__file__).resolve().parent
COMPOSER_DIR = TESTS_DIR.parent
sys.path.insert(0, str(COMPOSER_DIR))

from intent_router import route  # noqa: E402


class IntentRouterTest(unittest.TestCase):
    """Routing decisions on synthetic prompts."""

    # ----- Multi-source prompts → compose mode -----

    def test_sarah_acme_kafka_and_s3(self) -> None:
        """The exact gap surfaced in the persona test should now route to compose."""
        prompt = (
            "I need a medallion lakehouse architecture. We have point-of-sale "
            "data flowing in from 500 stores into S3, plus inventory updates "
            "from our ERP via Kafka. Run CDC into Silver, produce Gold tables."
        )
        decision = route(prompt)
        self.assertEqual(decision["type"], "compose",
                         f"Expected compose, got {decision}")
        self.assertIn("S3_BUCKET_BLOCK", decision["block_ids"])
        self.assertIn("KAFKA_CONNECTOR_BLOCK", decision["block_ids"])
        self.assertGreater(decision["confidence"], 0.4)

    def test_three_sources_compose(self) -> None:
        prompt = "Pipeline ingesting from S3, Kafka, and Kinesis into Snowflake"
        decision = route(prompt)
        self.assertEqual(decision["type"], "compose")
        self.assertGreaterEqual(
            sum(1 for b in decision["block_ids"]
                if b in {"S3_BUCKET_BLOCK", "KAFKA_CONNECTOR_BLOCK", "KINESIS_BLOCK"}),
            2,
        )

    # ----- Single-source prompts → template mode -----

    def test_simple_medallion_template(self) -> None:
        prompt = "Create a medallion lakehouse architecture"
        decision = route(prompt)
        self.assertEqual(decision["type"], "template")
        self.assertEqual(decision["template_id"], "MEDALLION_LAKEHOUSE")

    def test_iot_template(self) -> None:
        decision = route("IoT pipeline for sensor telemetry over MQTT")
        self.assertEqual(decision["type"], "template")
        self.assertEqual(decision["template_id"], "REALTIME_IOT_PIPELINE")

    def test_fraud_template(self) -> None:
        decision = route(
            "Real-time fraud detection for card transactions with row level security"
        )
        # "card transactions" + "fraud detection" -> REALTIME_FINANCIAL_TRANSACTIONS
        # "row level security" alone doesn't add a second SOURCE class, so this
        # stays in template mode.
        self.assertEqual(decision["type"], "template")
        self.assertEqual(decision["template_id"], "REALTIME_FINANCIAL_TRANSACTIONS")

    def test_governance_template(self) -> None:
        decision = route("Data governance with masking and RLS for PII")
        self.assertEqual(decision["type"], "template")
        self.assertEqual(decision["template_id"], "DATA_GOVERNANCE_COMPLIANCE")

    # ----- Edge cases -----

    def test_no_keyword_fallback(self) -> None:
        decision = route("Hello, how are you?")
        self.assertEqual(decision["type"], "template")
        self.assertLess(decision["confidence"], 0.2)

    def test_kafka_only_is_not_multi_source(self) -> None:
        """A single source mentioned should NOT trigger compose mode."""
        decision = route("Streaming pipeline with Kafka into Snowflake")
        # Kafka alone is one source -> falls back to single-template selection
        self.assertEqual(decision["type"], "template")


if __name__ == "__main__":
    unittest.main(verbosity=2)
