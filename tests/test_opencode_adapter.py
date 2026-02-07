from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from lucy_orchestrator.adapters.opencode import OpenCodeCLIClient
from lucy_orchestrator.models import RepoContext, Task, TaskSource, StepType


def _make_task(workspace: Path) -> Task:
    return Task(
        task_id="task_1",
        title="Task",
        description="Implement something",
        source=TaskSource(type="feishu", user_id="u1", chat_id="c1", message_id="m1"),
        repo=RepoContext(name="repo", base_branch="main", worktree_path=str(workspace)),
    )


class TestOpenCodeAdapter(unittest.TestCase):
    def test_parse_events_extract_text_and_usage(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            client = OpenCodeCLIClient(artifact_root=tmp_dir, workspace=tmp_dir)
            raw = "\n".join(
                [
                    '{"type":"text","part":{"text":"hello "}}',
                    '{"type":"text","part":{"text":"world"}}',
                    '{"type":"step_finish","part":{"tokens":{"input_tokens":2,"output_tokens":3}}}',
                ]
            )

            events = client._parse_jsonl_events(raw)
            self.assertEqual(client._extract_text_from_events(events), "hello world")

            usage = client._extract_usage(events)
            self.assertEqual(usage.get("prompt_tokens"), 2)
            self.assertEqual(usage.get("completion_tokens"), 3)
            self.assertEqual(usage.get("total_tokens"), 5)

    def test_extract_error_prefers_event_then_stderr(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            client = OpenCodeCLIClient(artifact_root=tmp_dir, workspace=tmp_dir)
            events = [{"type": "step_error", "error": {"message": "boom"}}]
            self.assertEqual(client._extract_error_text(events, ""), "boom")
            self.assertEqual(client._extract_error_text([], "line1\nline2"), "line2")

    def test_plan_normalization_adds_test_step(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            workspace = Path(tmp_dir)
            client = OpenCodeCLIClient(artifact_root=tmp_dir, workspace=workspace)
            task = _make_task(workspace)

            payload = {
                "goal": "Implement feature",
                "constraints": {"allowed_paths": ["src/**"], "max_files_changed": 10},
                "steps": [
                    {
                        "id": "s1",
                        "type": "code",
                        "title": "Implement",
                        "status": "pending",
                    }
                ],
            }

            plan = client._plan_from_payload(payload, task)
            self.assertTrue(any(step.step_type == StepType.CODE for step in plan.steps))
            self.assertTrue(any(step.step_type == StepType.TEST for step in plan.steps))

    def test_run_test_writes_structured_log(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            workspace = Path(tmp_dir)
            artifact_root = workspace / "artifacts"
            client = OpenCodeCLIClient(artifact_root=artifact_root, workspace=workspace)
            task = _make_task(workspace)

            command = f'"{sys.executable}" -c "print(\'ok\')"'
            result = client.run_test(task, command)

            self.assertEqual(result.exit_code, 0)
            log_path = Path(result.log_path)
            self.assertTrue(log_path.exists())
            payload = json.loads(log_path.read_text(encoding="utf-8"))
            self.assertIn("ok", payload.get("stdout", ""))

    def test_collect_changed_files_and_diff_artifact(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            workspace = Path(tmp_dir)
            subprocess.run(
                ["git", "init"], cwd=workspace, check=True, capture_output=True
            )
            (workspace / "new_file.py").write_text("print('hello')\n", encoding="utf-8")

            client = OpenCodeCLIClient(
                artifact_root=workspace / "artifacts", workspace=workspace
            )
            files = client._collect_changed_files(str(workspace))
            self.assertIn("new_file.py", files)

            diff_path = client._write_diff_artifact("task_1", str(workspace))
            self.assertTrue(diff_path.exists())
            diff_text = diff_path.read_text(encoding="utf-8")
            self.assertIn("new_file.py", diff_text)

    @patch("lucy_orchestrator.adapters.opencode.subprocess.run")
    def test_run_test_uses_docker_when_enabled(self, mock_run) -> None:
        mock_run.return_value = SimpleNamespace(returncode=0, stdout="ok\n", stderr="")

        with tempfile.TemporaryDirectory() as tmp_dir:
            workspace = Path(tmp_dir)
            client = OpenCodeCLIClient(
                artifact_root=workspace / "artifacts",
                workspace=workspace,
                use_docker=True,
                docker_image="nanobot-opencode",
            )
            task = _make_task(workspace)
            result = client.run_test(task, "pytest -q")

            self.assertEqual(result.exit_code, 0)
            args, kwargs = mock_run.call_args
            self.assertEqual(args[0][:4], ["docker", "run", "--rm", "-v"])
            self.assertIn("nanobot-opencode", args[0])
            self.assertFalse(kwargs["shell"])


if __name__ == "__main__":
    unittest.main()
