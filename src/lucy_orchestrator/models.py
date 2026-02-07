from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
from typing import Any


def utc_now_iso() -> str:
    now = datetime.now(timezone.utc).replace(microsecond=0)
    return now.isoformat().replace("+00:00", "Z")


class TaskState(str, Enum):
    NEW = "NEW"
    CLARIFYING = "CLARIFYING"
    WAIT_APPROVAL = "WAIT_APPROVAL"
    RUNNING = "RUNNING"
    TESTING = "TESTING"
    DONE = "DONE"
    FAILED = "FAILED"
    CANCELLED = "CANCELLED"


class QuestionStatus(str, Enum):
    OPEN = "open"
    ANSWERED = "answered"


class StepType(str, Enum):
    CODE = "code"
    TEST = "test"


class StepStatus(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"


@dataclass
class PlanQuestion:
    id: str
    question: str
    required: bool = True
    status: QuestionStatus = QuestionStatus.OPEN
    answer: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "question": self.question,
            "required": self.required,
            "status": self.status.value,
            "answer": self.answer,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "PlanQuestion":
        return cls(
            id=data["id"],
            question=data["question"],
            required=bool(data.get("required", True)),
            status=QuestionStatus(data.get("status", QuestionStatus.OPEN.value)),
            answer=data.get("answer"),
        )


@dataclass
class PlanStep:
    id: str
    step_type: StepType
    title: str
    command: str | None = None
    status: StepStatus = StepStatus.PENDING

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "type": self.step_type.value,
            "title": self.title,
            "command": self.command,
            "status": self.status.value,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "PlanStep":
        return cls(
            id=data["id"],
            step_type=StepType(data["type"]),
            title=data["title"],
            command=data.get("command"),
            status=StepStatus(data.get("status", StepStatus.PENDING.value)),
        )


@dataclass
class PlanConstraints:
    allowed_paths: list[str] = field(default_factory=list)
    forbidden_paths: list[str] = field(default_factory=list)
    max_files_changed: int = 20

    def to_dict(self) -> dict[str, Any]:
        return {
            "allowed_paths": list(self.allowed_paths),
            "forbidden_paths": list(self.forbidden_paths),
            "max_files_changed": self.max_files_changed,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "PlanConstraints":
        return cls(
            allowed_paths=list(data.get("allowed_paths", [])),
            forbidden_paths=list(data.get("forbidden_paths", [])),
            max_files_changed=int(data.get("max_files_changed", 20)),
        )


@dataclass
class Plan:
    plan_id: str
    task_id: str
    version: int
    goal: str
    assumptions: list[str] = field(default_factory=list)
    constraints: PlanConstraints = field(default_factory=PlanConstraints)
    questions: list[PlanQuestion] = field(default_factory=list)
    steps: list[PlanStep] = field(default_factory=list)
    approval_gate_before_run: bool = True
    approval_gate_before_commit: bool = True
    created_at: str = field(default_factory=utc_now_iso)
    created_by: str = "orchestrator"

    def open_required_questions(self) -> list[PlanQuestion]:
        return [
            q for q in self.questions if q.required and q.status == QuestionStatus.OPEN
        ]

    def to_dict(self) -> dict[str, Any]:
        return {
            "plan_id": self.plan_id,
            "task_id": self.task_id,
            "version": self.version,
            "goal": self.goal,
            "assumptions": list(self.assumptions),
            "constraints": self.constraints.to_dict(),
            "questions": [q.to_dict() for q in self.questions],
            "steps": [s.to_dict() for s in self.steps],
            "approval_gate": {
                "required_before_run": self.approval_gate_before_run,
                "required_before_commit": self.approval_gate_before_commit,
            },
            "metadata": {
                "created_at": self.created_at,
                "created_by": self.created_by,
            },
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "Plan":
        approval_gate = data.get("approval_gate", {})
        metadata = data.get("metadata", {})
        return cls(
            plan_id=data["plan_id"],
            task_id=data["task_id"],
            version=int(data.get("version", 1)),
            goal=data.get("goal", ""),
            assumptions=list(data.get("assumptions", [])),
            constraints=PlanConstraints.from_dict(data.get("constraints", {})),
            questions=[
                PlanQuestion.from_dict(item) for item in data.get("questions", [])
            ],
            steps=[PlanStep.from_dict(item) for item in data.get("steps", [])],
            approval_gate_before_run=bool(
                approval_gate.get("required_before_run", True)
            ),
            approval_gate_before_commit=bool(
                approval_gate.get("required_before_commit", True)
            ),
            created_at=metadata.get("created_at", utc_now_iso()),
            created_by=metadata.get("created_by", "orchestrator"),
        )


@dataclass
class Approval:
    required: bool = True
    approved_by: str | None = None
    approved_at: str | None = None

    def is_approved(self) -> bool:
        if not self.required:
            return True
        return bool(self.approved_by and self.approved_at)

    def to_dict(self) -> dict[str, Any]:
        return {
            "required": self.required,
            "approved_by": self.approved_by,
            "approved_at": self.approved_at,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "Approval":
        return cls(
            required=bool(data.get("required", True)),
            approved_by=data.get("approved_by"),
            approved_at=data.get("approved_at"),
        )


@dataclass
class ExecutionInfo:
    attempt: int = 0
    max_attempts: int = 3
    last_error: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "attempt": self.attempt,
            "max_attempts": self.max_attempts,
            "last_error": self.last_error,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "ExecutionInfo":
        return cls(
            attempt=int(data.get("attempt", 0)),
            max_attempts=int(data.get("max_attempts", 3)),
            last_error=data.get("last_error"),
        )


@dataclass
class TaskArtifacts:
    clarify_summary: str | None = None
    diff_path: str | None = None
    test_report_path: str | None = None
    pr_url: str | None = None
    changed_files: list[str] = field(default_factory=list)
    test_results: list[dict[str, Any]] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "clarify_summary": self.clarify_summary,
            "diff_path": self.diff_path,
            "test_report_path": self.test_report_path,
            "pr_url": self.pr_url,
            "changed_files": list(self.changed_files),
            "test_results": list(self.test_results),
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "TaskArtifacts":
        return cls(
            clarify_summary=data.get("clarify_summary"),
            diff_path=data.get("diff_path"),
            test_report_path=data.get("test_report_path"),
            pr_url=data.get("pr_url"),
            changed_files=list(data.get("changed_files", [])),
            test_results=list(data.get("test_results", [])),
        )


@dataclass
class TaskSource:
    type: str
    user_id: str
    chat_id: str
    message_id: str

    def to_dict(self) -> dict[str, str]:
        return {
            "type": self.type,
            "user_id": self.user_id,
            "chat_id": self.chat_id,
            "message_id": self.message_id,
        }

    @classmethod
    def from_dict(cls, data: dict[str, str]) -> "TaskSource":
        return cls(
            type=data.get("type", "unknown"),
            user_id=data.get("user_id", ""),
            chat_id=data.get("chat_id", ""),
            message_id=data.get("message_id", ""),
        )


@dataclass
class RepoContext:
    name: str
    base_branch: str = "main"
    worktree_path: str | None = None
    branch: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "base_branch": self.base_branch,
            "worktree_path": self.worktree_path,
            "branch": self.branch,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "RepoContext":
        return cls(
            name=data.get("name", ""),
            base_branch=data.get("base_branch", "main"),
            worktree_path=data.get("worktree_path"),
            branch=data.get("branch"),
        )


@dataclass
class TaskEvent:
    timestamp: str
    event_type: str
    message: str
    payload: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "timestamp": self.timestamp,
            "event_type": self.event_type,
            "message": self.message,
            "payload": dict(self.payload),
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "TaskEvent":
        return cls(
            timestamp=data["timestamp"],
            event_type=data["event_type"],
            message=data.get("message", ""),
            payload=dict(data.get("payload", {})),
        )


@dataclass
class Task:
    task_id: str
    title: str
    description: str
    source: TaskSource
    repo: RepoContext
    state: TaskState = TaskState.NEW
    approval: Approval = field(default_factory=Approval)
    plan: Plan | None = None
    execution: ExecutionInfo = field(default_factory=ExecutionInfo)
    artifacts: TaskArtifacts = field(default_factory=TaskArtifacts)
    event_log: list[TaskEvent] = field(default_factory=list)
    created_at: str = field(default_factory=utc_now_iso)
    updated_at: str = field(default_factory=utc_now_iso)

    def record_event(
        self, event_type: str, message: str, payload: dict[str, Any] | None = None
    ) -> None:
        self.event_log.append(
            TaskEvent(
                timestamp=utc_now_iso(),
                event_type=event_type,
                message=message,
                payload=payload or {},
            )
        )
        self.updated_at = utc_now_iso()

    def to_dict(self) -> dict[str, Any]:
        return {
            "task_id": self.task_id,
            "title": self.title,
            "description": self.description,
            "source": self.source.to_dict(),
            "repo": self.repo.to_dict(),
            "state": self.state.value,
            "approval": self.approval.to_dict(),
            "plan": self.plan.to_dict() if self.plan else None,
            "execution": self.execution.to_dict(),
            "artifacts": self.artifacts.to_dict(),
            "event_log": [event.to_dict() for event in self.event_log],
            "timestamps": {
                "created_at": self.created_at,
                "updated_at": self.updated_at,
            },
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "Task":
        timestamps = data.get("timestamps", {})
        return cls(
            task_id=data["task_id"],
            title=data.get("title", ""),
            description=data.get("description", ""),
            source=TaskSource.from_dict(data.get("source", {})),
            repo=RepoContext.from_dict(data.get("repo", {})),
            state=TaskState(data.get("state", TaskState.NEW.value)),
            approval=Approval.from_dict(data.get("approval", {})),
            plan=Plan.from_dict(data["plan"]) if data.get("plan") else None,
            execution=ExecutionInfo.from_dict(data.get("execution", {})),
            artifacts=TaskArtifacts.from_dict(data.get("artifacts", {})),
            event_log=[TaskEvent.from_dict(item) for item in data.get("event_log", [])],
            created_at=timestamps.get("created_at", utc_now_iso()),
            updated_at=timestamps.get("updated_at", utc_now_iso()),
        )
