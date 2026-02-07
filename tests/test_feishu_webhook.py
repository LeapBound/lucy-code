from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from lucy_orchestrator.adapters.opencode import (
    BuildExecutionResult,
    ClarifyResult,
    TestExecutionResult,
)
from lucy_orchestrator.channels.feishu_webhook import (
    FeishuWebhookProcessor,
    FeishuWebhookSettings,
    ProcessedMessageStore,
)
from lucy_orchestrator.models import (
    Plan,
    PlanConstraints,
    PlanStep,
    StepType,
)
from lucy_orchestrator.orchestrator import Orchestrator
from lucy_orchestrator.store import TaskStore


class _FakeOpenCodeClient:
    def clarify(self, task):
        plan = Plan(
            plan_id=f"plan_{task.task_id}",
            task_id=task.task_id,
            version=1,
            goal=task.description,
            constraints=PlanConstraints(
                allowed_paths=["src/**"], forbidden_paths=[], max_files_changed=20
            ),
            questions=[],
            steps=[
                PlanStep(id="s1", step_type=StepType.CODE, title="code"),
                PlanStep(
                    id="s2", step_type=StepType.TEST, title="test", command="pytest -q"
                ),
            ],
        )
        return ClarifyResult(summary="ok", plan=plan)

    def build(self, task):
        return BuildExecutionResult(changed_files=["src/a.py"], diff_path="/tmp/diff")

    def run_test(self, task, command):
        return TestExecutionResult(
            command=command, exit_code=0, log_path="/tmp/test.log", duration_ms=1
        )


def _sample_message_payload(message_id: str = "om_1", text: str = "请实现重试") -> dict:
    return {
        "header": {
            "event_type": "im.message.receive_v1",
        },
        "event": {
            "sender": {"sender_id": {"open_id": "ou_1"}},
            "message": {
                "message_id": message_id,
                "chat_id": "oc_1",
                "content": '{"text":"%s"}' % text,
            },
        },
    }


class TestFeishuWebhookProcessor(unittest.TestCase):
    def test_url_verification(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            orchestrator = Orchestrator(
                store=TaskStore(Path(tmp_dir) / "tasks"),
                opencode_client=_FakeOpenCodeClient(),
                report_dir=Path(tmp_dir) / "reports",
            )
            processor = FeishuWebhookProcessor(
                orchestrator=orchestrator,
                settings=FeishuWebhookSettings(repo_name="repo"),
                processed_store=ProcessedMessageStore(Path(tmp_dir) / "seen.json"),
            )

            code, payload = processor.process_payload(
                {"type": "url_verification", "challenge": "abc"}
            )
            self.assertEqual(code, 200)
            self.assertEqual(payload.get("challenge"), "abc")

    def test_process_message_and_dedupe(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            orchestrator = Orchestrator(
                store=TaskStore(Path(tmp_dir) / "tasks"),
                opencode_client=_FakeOpenCodeClient(),
                report_dir=Path(tmp_dir) / "reports",
            )
            processor = FeishuWebhookProcessor(
                orchestrator=orchestrator,
                settings=FeishuWebhookSettings(repo_name="repo"),
                processed_store=ProcessedMessageStore(Path(tmp_dir) / "seen.json"),
            )

            code, payload = processor.process_payload(_sample_message_payload())
            self.assertEqual(code, 200)
            self.assertEqual(payload.get("status"), "ok")

            duplicate_code, duplicate_payload = processor.process_payload(
                _sample_message_payload()
            )
            self.assertEqual(duplicate_code, 200)
            self.assertEqual(duplicate_payload.get("status"), "duplicate")

    def test_validate_token(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            orchestrator = Orchestrator(
                store=TaskStore(Path(tmp_dir) / "tasks"),
                opencode_client=_FakeOpenCodeClient(),
                report_dir=Path(tmp_dir) / "reports",
            )
            processor = FeishuWebhookProcessor(
                orchestrator=orchestrator,
                settings=FeishuWebhookSettings(
                    repo_name="repo", verification_token="token123"
                ),
                processed_store=ProcessedMessageStore(Path(tmp_dir) / "seen.json"),
            )

            self.assertTrue(processor.validate_token({"token": "token123"}))
            self.assertFalse(processor.validate_token({"token": "bad"}))


if __name__ == "__main__":
    unittest.main()
