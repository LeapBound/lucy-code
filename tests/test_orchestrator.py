from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from lucy_orchestrator.adapters.feishu import FeishuRequirement
from lucy_orchestrator.adapters.opencode import (
    BuildExecutionResult,
    ClarifyResult,
    TestExecutionResult,
)
from lucy_orchestrator.exceptions import InvalidTransitionError
from lucy_orchestrator.models import (
    Plan,
    PlanConstraints,
    PlanStep,
    RepoContext,
    StepType,
    TaskSource,
    TaskState,
)
from lucy_orchestrator.orchestrator import Orchestrator
from lucy_orchestrator.store import TaskStore
from lucy_orchestrator.worktree import WorktreeHandle


class FakeOpenCodeClient:
    def __init__(self, test_exit_code: int = 0) -> None:
        self.test_exit_code = test_exit_code

    def clarify(self, task):
        plan = Plan(
            plan_id=f"plan_{task.task_id}_1",
            task_id=task.task_id,
            version=1,
            goal=task.description,
            constraints=PlanConstraints(
                allowed_paths=["src/**", "tests/**"],
                forbidden_paths=["secrets/**"],
                max_files_changed=10,
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
        return BuildExecutionResult(
            changed_files=["src/new_module.py"], diff_path="/tmp/diff.patch"
        )

    def run_test(self, task, command):
        return TestExecutionResult(
            command=command,
            exit_code=self.test_exit_code,
            log_path="/tmp/test.log",
            duration_ms=10,
        )


def _create_task(orchestrator: Orchestrator):
    return orchestrator.create_task(
        title="Task",
        description="Implement task",
        source=TaskSource(
            type="feishu", user_id="ou_xxx", chat_id="oc_xxx", message_id="om_xxx"
        ),
        repo=RepoContext(name="repo", base_branch="main", worktree_path="/workspace"),
    )


class TestOrchestrator(unittest.TestCase):
    def test_orchestrator_happy_path(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            tmp_path = Path(tmp_dir)
            store = TaskStore(tmp_path / "tasks")
            orchestrator = Orchestrator(
                store=store,
                opencode_client=FakeOpenCodeClient(test_exit_code=0),
                report_dir=tmp_path / "reports",
            )

            task = _create_task(orchestrator)
            task = orchestrator.clarify_task(task.task_id)
            self.assertEqual(task.state, TaskState.WAIT_APPROVAL)

            task = orchestrator.approve_task(task.task_id, approved_by="ou_xxx")
            self.assertTrue(task.approval.is_approved())

            task = orchestrator.run_task(task.task_id)
            self.assertEqual(task.state, TaskState.DONE)
            self.assertTrue(Path(task.artifacts.test_report_path or "").exists())

    def test_orchestrator_marks_failed_when_tests_fail(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            tmp_path = Path(tmp_dir)
            store = TaskStore(tmp_path / "tasks")
            orchestrator = Orchestrator(
                store=store,
                opencode_client=FakeOpenCodeClient(test_exit_code=1),
                report_dir=tmp_path / "reports",
            )

            task = _create_task(orchestrator)
            task = orchestrator.clarify_task(task.task_id)
            orchestrator.approve_task(task.task_id, approved_by="ou_xxx")
            task = orchestrator.run_task(task.task_id)

            self.assertEqual(task.state, TaskState.FAILED)
            self.assertIn("tests failed", task.execution.last_error or "")

    def test_orchestrator_requires_approval(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            tmp_path = Path(tmp_dir)
            store = TaskStore(tmp_path / "tasks")
            orchestrator = Orchestrator(
                store=store,
                opencode_client=FakeOpenCodeClient(test_exit_code=0),
                report_dir=tmp_path / "reports",
            )

            task = _create_task(orchestrator)
            orchestrator.clarify_task(task.task_id)

            with self.assertRaises(InvalidTransitionError):
                orchestrator.run_task(task.task_id)

            failed_task = store.get(task.task_id)
            self.assertEqual(failed_task.state, TaskState.FAILED)

    def test_orchestrator_approves_from_natural_language(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            tmp_path = Path(tmp_dir)
            store = TaskStore(tmp_path / "tasks")
            orchestrator = Orchestrator(
                store=store,
                opencode_client=FakeOpenCodeClient(test_exit_code=0),
                report_dir=tmp_path / "reports",
            )

            task = _create_task(orchestrator)
            task = orchestrator.clarify_task(task.task_id)
            self.assertEqual(task.state, TaskState.WAIT_APPROVAL)

            task = orchestrator.handle_approval_message(
                task_id=task.task_id,
                user_id="ou_xxx",
                text="可以，开始吧",
            )
            self.assertTrue(task.approval.is_approved())

    def test_orchestrator_rejects_from_natural_language(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            tmp_path = Path(tmp_dir)
            store = TaskStore(tmp_path / "tasks")
            orchestrator = Orchestrator(
                store=store,
                opencode_client=FakeOpenCodeClient(test_exit_code=0),
                report_dir=tmp_path / "reports",
            )

            task = _create_task(orchestrator)
            task = orchestrator.clarify_task(task.task_id)
            self.assertEqual(task.state, TaskState.WAIT_APPROVAL)

            task = orchestrator.handle_approval_message(
                task_id=task.task_id,
                user_id="ou_xxx",
                text="先别做，取消这个任务",
            )
            self.assertEqual(task.state, TaskState.CANCELLED)

    def test_process_feishu_message_creates_and_clarifies_task(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            tmp_path = Path(tmp_dir)
            store = TaskStore(tmp_path / "tasks")
            orchestrator = Orchestrator(
                store=store,
                opencode_client=FakeOpenCodeClient(test_exit_code=0),
                report_dir=tmp_path / "reports",
            )

            requirement = FeishuRequirement(
                user_id="ou_xxx",
                chat_id="oc_xxx",
                message_id="om_001",
                text="请新增重试策略",
            )
            task, reply = orchestrator.process_feishu_message(
                requirement=requirement,
                repo_name="repo",
                auto_clarify=True,
            )
            self.assertEqual(task.state, TaskState.WAIT_APPROVAL)
            self.assertIn("完成澄清", reply)

    def test_process_feishu_message_uses_pending_task_for_approval(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            tmp_path = Path(tmp_dir)
            store = TaskStore(tmp_path / "tasks")
            orchestrator = Orchestrator(
                store=store,
                opencode_client=FakeOpenCodeClient(test_exit_code=0),
                report_dir=tmp_path / "reports",
            )

            initial_requirement = FeishuRequirement(
                user_id="ou_xxx",
                chat_id="oc_xxx",
                message_id="om_001",
                text="请新增重试策略",
            )
            task, _ = orchestrator.process_feishu_message(
                requirement=initial_requirement,
                repo_name="repo",
                auto_clarify=True,
            )

            approval_requirement = FeishuRequirement(
                user_id="ou_xxx",
                chat_id="oc_xxx",
                message_id="om_002",
                text="同意，开始吧",
            )
            updated, reply = orchestrator.process_feishu_message(
                requirement=approval_requirement,
                repo_name="repo",
                auto_clarify=True,
            )
            self.assertEqual(updated.task_id, task.task_id)
            self.assertTrue(updated.approval.is_approved())
            self.assertIn("已批准", reply)

    @patch("lucy_orchestrator.orchestrator.WorktreeManager.create")
    def test_process_feishu_message_auto_provisions_worktree(self, mock_create) -> None:
        mock_create.return_value = WorktreeHandle(
            branch="agent/task_1",
            path="/tmp/worktrees/task_1",
        )

        with tempfile.TemporaryDirectory() as tmp_dir:
            tmp_path = Path(tmp_dir)
            store = TaskStore(tmp_path / "tasks")
            orchestrator = Orchestrator(
                store=store,
                opencode_client=FakeOpenCodeClient(test_exit_code=0),
                report_dir=tmp_path / "reports",
            )

            requirement = FeishuRequirement(
                user_id="ou_xxx",
                chat_id="oc_xxx",
                message_id="om_003",
                text="请新增重试策略",
            )

            task, _ = orchestrator.process_feishu_message(
                requirement=requirement,
                repo_name="repo",
                auto_clarify=False,
                worktree_path="/workspace/default",
                auto_provision_worktree=True,
                repo_path=str(tmp_path),
            )

            self.assertEqual(task.repo.worktree_path, "/tmp/worktrees/task_1")
            self.assertEqual(task.repo.branch, "agent/task_1")


if __name__ == "__main__":
    unittest.main()
