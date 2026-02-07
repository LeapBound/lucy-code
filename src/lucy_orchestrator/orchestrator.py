from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

from .channels.feishu import FeishuRequirement
from .adapters.opencode import OpenCodeClient
from .exceptions import OrchestratorError
from .intent import ApprovalIntent, HybridIntentClassifier, IntentClassifier
from .models import RepoContext, StepType, Task, TaskSource, TaskState, utc_now_iso
from .plan import assert_plan_valid
from .policy import enforce_file_policy
from .state_machine import transition
from .store import TaskStore
from .worktree import WorktreeManager


def _generate_task_id() -> str:
    now = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")
    return f"task_{now}_{uuid4().hex[:6]}"


class Orchestrator:
    def __init__(
        self,
        store: TaskStore,
        opencode_client: OpenCodeClient,
        report_dir: str | Path = ".orchestrator/reports",
        intent_classifier: IntentClassifier | None = None,
    ) -> None:
        self.store = store
        self.opencode_client = opencode_client
        self.intent_classifier = intent_classifier or HybridIntentClassifier()
        self.report_dir = Path(report_dir)
        self.report_dir.mkdir(parents=True, exist_ok=True)

    def process_feishu_message(
        self,
        *,
        requirement: FeishuRequirement,
        repo_name: str,
        base_branch: str = "main",
        worktree_path: str | None = None,
        auto_clarify: bool = True,
        auto_run_on_approve: bool = False,
        auto_provision_worktree: bool = False,
        repo_path: str | Path | None = None,
        worktrees_root: str | Path | None = None,
        branch_prefix: str = "agent",
    ) -> tuple[Task, str]:
        pending_task = self._find_latest_waiting_approval_task(
            chat_id=requirement.chat_id,
            user_id=requirement.user_id,
        )

        if pending_task is not None:
            task = self.handle_approval_message(
                task_id=pending_task.task_id,
                user_id=requirement.user_id,
                text=requirement.text,
            )

            if task.state == TaskState.CANCELLED:
                return task, f"任务 {task.task_id} 已取消。"

            if task.approval.is_approved():
                if auto_provision_worktree and not task.repo.branch and repo_path:
                    try:
                        task = self.provision_worktree(
                            task.task_id,
                            repo_path=repo_path,
                            worktrees_root=worktrees_root,
                            branch_prefix=branch_prefix,
                        )
                    except Exception as exc:
                        task = self.store.get(task.task_id)
                        task.record_event(
                            "worktree.failed",
                            "Automatic worktree provisioning failed",
                            {"error": str(exc)},
                        )
                        self.store.save(task)
                        return task, (
                            f"任务 {task.task_id} 已批准，但创建 worktree 失败：{exc}。"
                            "请先修复后再执行 run。"
                        )

                if auto_run_on_approve:
                    try:
                        task = self.run_task(task.task_id)
                    except Exception as exc:
                        task = self.store.get(task.task_id)
                        return task, (
                            f"任务 {task.task_id} 已批准，但执行失败：{exc}。"
                            "请查看任务事件日志。"
                        )

                return task, (
                    f"任务 {task.task_id} 已批准，当前状态：{task.state.value}。"
                    "我会继续执行后续流程。"
                )

            return task, (
                f"我还无法确定是否批准任务 {task.task_id}。"
                "请回复“同意/开始”或“取消/拒绝”。"
            )

        task = self.create_task_from_requirement(
            requirement=requirement,
            repo_name=repo_name,
            base_branch=base_branch,
            worktree_path=worktree_path,
        )

        if auto_provision_worktree and repo_path and not task.repo.branch:
            try:
                task = self.provision_worktree(
                    task.task_id,
                    repo_path=repo_path,
                    worktrees_root=worktrees_root,
                    branch_prefix=branch_prefix,
                )
            except Exception as exc:
                task = self.store.get(task.task_id)
                task.record_event(
                    "worktree.failed",
                    "Automatic worktree provisioning failed",
                    {"error": str(exc)},
                )
                self.store.save(task)
                return task, (
                    f"任务 {task.task_id} 已创建，但 worktree 创建失败：{exc}。"
                    "请检查 git 状态后重试。"
                )

        if auto_clarify:
            task = self.clarify_task(task.task_id)
            return task, self._build_approval_prompt(task)

        return task, f"任务 {task.task_id} 已创建。下一步请运行 clarify。"

    def _find_latest_waiting_approval_task(
        self,
        *,
        chat_id: str,
        user_id: str,
    ) -> Task | None:
        tasks = self.store.list()
        candidates = [
            task
            for task in tasks
            if task.state == TaskState.WAIT_APPROVAL
            and task.source.chat_id == chat_id
            and task.source.user_id == user_id
        ]

        if not candidates:
            return None

        return sorted(candidates, key=lambda item: item.updated_at, reverse=True)[0]

    def _build_approval_prompt(self, task: Task) -> str:
        summary = task.artifacts.clarify_summary or "已完成需求澄清。"
        lines = [
            f"任务 {task.task_id} 已创建并完成澄清。",
            f"摘要：{summary}",
        ]

        if task.plan and task.plan.questions:
            open_questions = [
                question
                for question in task.plan.questions
                if question.status.value == "open"
            ]
            if open_questions:
                lines.append("待确认问题：")
                for question in open_questions:
                    lines.append(f"- [{question.id}] {question.question}")

        lines.append("请回复“同意/开始”批准执行，或回复“取消/拒绝”。")
        return "\n".join(lines)

    def create_task(
        self,
        *,
        title: str,
        description: str,
        source: TaskSource,
        repo: RepoContext,
    ) -> Task:
        task = Task(
            task_id=_generate_task_id(),
            title=title,
            description=description,
            source=source,
            repo=repo,
        )
        task.record_event("task.created", "Task created")
        self.store.save(task)
        return task

    def create_task_from_requirement(
        self,
        requirement: FeishuRequirement,
        *,
        repo_name: str,
        base_branch: str = "main",
        worktree_path: str | None = None,
    ) -> Task:
        description = requirement.text.strip()
        title = (
            description.splitlines()[0][:80] if description else "Feishu requirement"
        )
        source = TaskSource(
            type="feishu",
            user_id=requirement.user_id,
            chat_id=requirement.chat_id,
            message_id=requirement.message_id,
        )
        repo = RepoContext(
            name=repo_name, base_branch=base_branch, worktree_path=worktree_path
        )
        return self.create_task(
            title=title, description=description, source=source, repo=repo
        )

    def clarify_task(self, task_id: str) -> Task:
        task = self.store.get(task_id)
        transition(task, TaskState.CLARIFYING, "state.change", "Entering CLARIFYING")

        clarify_result = self.opencode_client.clarify(task)
        task.plan = clarify_result.plan
        task.artifacts.clarify_summary = clarify_result.summary
        task.record_event(
            "clarify.completed",
            "Clarification completed",
            {
                "questions": len(task.plan.questions),
                "steps": len(task.plan.steps),
            },
        )

        transition(
            task, TaskState.WAIT_APPROVAL, "state.change", "Waiting for approval"
        )
        self.store.save(task)
        return task

    def approve_task(self, task_id: str, approved_by: str) -> Task:
        task = self.store.get(task_id)
        task.approval.approved_by = approved_by
        task.approval.approved_at = utc_now_iso()
        task.record_event(
            "approval.granted", "Task approved", {"approved_by": approved_by}
        )
        self.store.save(task)
        return task

    def handle_approval_message(self, task_id: str, user_id: str, text: str) -> Task:
        task = self.store.get(task_id)
        intent_result = self.intent_classifier.classify(text=text, task=task)
        task.record_event(
            "approval.intent.detected",
            "Approval intent classified",
            {
                "intent": intent_result.intent.value,
                "confidence": intent_result.confidence,
                "reason": intent_result.reason,
            },
        )

        if task.state != TaskState.WAIT_APPROVAL:
            task.record_event(
                "approval.intent.ignored",
                "Task is not waiting for approval",
                {"state": task.state.value},
            )
            self.store.save(task)
            return task

        if intent_result.intent == ApprovalIntent.APPROVE:
            task.approval.approved_by = user_id
            task.approval.approved_at = utc_now_iso()
            task.record_event(
                "approval.granted",
                "Task approved from natural language intent",
                {"approved_by": user_id, "confidence": intent_result.confidence},
            )
        elif intent_result.intent == ApprovalIntent.REJECT:
            transition(
                task,
                TaskState.CANCELLED,
                "state.change",
                "Task rejected by user",
                {
                    "rejected_by": user_id,
                    "confidence": intent_result.confidence,
                },
            )
        else:
            task.record_event(
                "approval.pending",
                "Approval intent unclear, waiting for explicit confirmation",
                {"message": text.strip()},
            )

        self.store.save(task)
        return task

    def provision_worktree(
        self,
        task_id: str,
        *,
        repo_path: str | Path,
        worktrees_root: str | Path | None = None,
        branch_prefix: str = "agent",
    ) -> Task:
        task = self.store.get(task_id)
        manager = WorktreeManager(repo_path=repo_path, worktrees_root=worktrees_root)
        handle = manager.create(
            task_id=task.task_id,
            base_branch=task.repo.base_branch,
            branch_prefix=branch_prefix,
        )
        task.repo.worktree_path = handle.path
        task.repo.branch = handle.branch
        task.record_event(
            "worktree.created",
            "Task worktree provisioned",
            {
                "branch": handle.branch,
                "path": handle.path,
            },
        )
        self.store.save(task)
        return task

    def cleanup_worktree(
        self,
        task_id: str,
        *,
        repo_path: str | Path,
        worktrees_root: str | Path | None = None,
        force: bool = False,
    ) -> Task:
        task = self.store.get(task_id)
        manager = WorktreeManager(repo_path=repo_path, worktrees_root=worktrees_root)
        manager.remove(task_id=task.task_id, force=force)
        task.record_event("worktree.removed", "Task worktree removed")
        self.store.save(task)
        return task

    def run_task(self, task_id: str) -> Task:
        task = self.store.get(task_id)

        if (
            task.state == TaskState.FAILED
            and task.execution.attempt >= task.execution.max_attempts
        ):
            raise OrchestratorError(
                f"Task exceeded max attempts: {task.execution.attempt}/{task.execution.max_attempts}"
            )

        task.execution.attempt += 1
        task.record_event(
            "run.started", "Task run started", {"attempt": task.execution.attempt}
        )

        try:
            transition(task, TaskState.RUNNING, "state.change", "Entering RUNNING")

            if task.plan is None:
                raise OrchestratorError("Task plan is missing")

            assert_plan_valid(task.plan)

            build_result = self.opencode_client.build(task)
            task.artifacts.diff_path = build_result.diff_path
            task.artifacts.changed_files = list(build_result.changed_files)
            enforce_file_policy(task.artifacts.changed_files, task.plan.constraints)
            task.record_event(
                "build.completed",
                "Build step completed",
                {
                    "diff_path": task.artifacts.diff_path,
                    "changed_files": len(task.artifacts.changed_files),
                },
            )

            transition(task, TaskState.TESTING, "state.change", "Entering TESTING")

            test_steps = [
                step for step in task.plan.steps if step.step_type == StepType.TEST
            ]
            test_results = []
            all_passed = True

            for step in test_steps:
                command = step.command or ""
                result = self.opencode_client.run_test(task, command)
                test_results.append(result.to_dict())
                if result.exit_code != 0:
                    all_passed = False
                    break

            report_path = self._write_test_report(task.task_id, test_results)
            task.artifacts.test_results = test_results
            task.artifacts.test_report_path = str(report_path)

            if all_passed:
                task.execution.last_error = None
                transition(task, TaskState.DONE, "state.change", "Task completed")
            else:
                task.execution.last_error = "One or more tests failed"
                transition(
                    task, TaskState.FAILED, "state.change", "Task failed in tests"
                )

        except Exception as exc:
            task.execution.last_error = str(exc)
            if task.state not in {
                TaskState.FAILED,
                TaskState.DONE,
                TaskState.CANCELLED,
            }:
                try:
                    transition(task, TaskState.FAILED, "state.change", "Task failed")
                except Exception:
                    task.state = TaskState.FAILED
                    task.updated_at = utc_now_iso()
            task.record_event("run.failed", "Task run failed", {"error": str(exc)})
            self.store.save(task)
            raise

        self.store.save(task)
        return task

    def _write_test_report(
        self, task_id: str, results: list[dict[str, object]]
    ) -> Path:
        self.report_dir.mkdir(parents=True, exist_ok=True)
        report_path = self.report_dir / f"{task_id}_test_report.json"
        payload = {
            "task_id": task_id,
            "generated_at": utc_now_iso(),
            "results": results,
            "passed": all(item.get("exit_code", 1) == 0 for item in results),
        }
        report_path.write_text(
            json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8"
        )
        return report_path
