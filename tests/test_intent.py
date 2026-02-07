from __future__ import annotations

import unittest

from lucy_orchestrator.intent import (
    ApprovalIntent,
    HybridIntentClassifier,
    IntentResult,
    RuleBasedIntentClassifier,
)


class _FakeClassifier:
    def __init__(self, result: IntentResult) -> None:
        self.result = result

    def classify(self, text, task=None):
        return self.result


class TestIntentClassifier(unittest.TestCase):
    def test_rule_based_approve(self) -> None:
        classifier = RuleBasedIntentClassifier()
        result = classifier.classify("同意，开始吧")
        self.assertEqual(result.intent, ApprovalIntent.APPROVE)

    def test_rule_based_reject(self) -> None:
        classifier = RuleBasedIntentClassifier()
        result = classifier.classify("先别做，取消")
        self.assertEqual(result.intent, ApprovalIntent.REJECT)

    def test_rule_based_clarify(self) -> None:
        classifier = RuleBasedIntentClassifier()
        result = classifier.classify("为什么要改这个？")
        self.assertEqual(result.intent, ApprovalIntent.CLARIFY)

    def test_hybrid_uses_llm_when_rule_unknown(self) -> None:
        llm = _FakeClassifier(
            IntentResult(intent=ApprovalIntent.APPROVE, confidence=0.91, reason="llm")
        )
        classifier = HybridIntentClassifier(
            rule_classifier=RuleBasedIntentClassifier(),
            llm_classifier=llm,
            llm_threshold=0.8,
        )

        result = classifier.classify("这版看起来可以合并")
        self.assertEqual(result.intent, ApprovalIntent.APPROVE)

    def test_hybrid_blocks_low_confidence_llm(self) -> None:
        llm = _FakeClassifier(
            IntentResult(intent=ApprovalIntent.APPROVE, confidence=0.55, reason="llm")
        )
        classifier = HybridIntentClassifier(
            rule_classifier=RuleBasedIntentClassifier(),
            llm_classifier=llm,
            llm_threshold=0.8,
        )

        result = classifier.classify("这版看起来可以合并")
        self.assertEqual(result.intent, ApprovalIntent.UNKNOWN)


if __name__ == "__main__":
    unittest.main()
