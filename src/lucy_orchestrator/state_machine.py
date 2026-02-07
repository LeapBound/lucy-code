from __future__ import annotations

from .exceptions import InvalidTransitionError
from .models import Task, TaskState


_ALLOWED_TRANSITIONS: dict[TaskState, set[TaskState]] = {
    TaskState.NEW: {TaskState.CLARIFYING, TaskState.FAILED, TaskState.CANCELLED},
    TaskState.CLARIFYING: {
        TaskState.WAIT_APPROVAL,
        TaskState.FAILED,
        TaskState.CANCELLED,
    },
    TaskState.WAIT_APPROVAL: {TaskState.RUNNING, TaskState.FAILED, TaskState.CANCELLED},
    TaskState.RUNNING: {TaskState.TESTING, TaskState.FAILED, TaskState.CANCELLED},
    TaskState.TESTING: {TaskState.DONE, TaskState.FAILED, TaskState.CANCELLED},
    TaskState.FAILED: {TaskState.RUNNING, TaskState.CANCELLED},
    TaskState.DONE: set(),
    TaskState.CANCELLED: set(),
}


def assert_transition(task: Task, target: TaskState) -> None:
    allowed = _ALLOWED_TRANSITIONS.get(task.state, set())
    if target not in allowed:
        raise InvalidTransitionError(
            f"Invalid transition: {task.state.value} -> {target.value}"
        )

    if target == TaskState.RUNNING:
        if task.approval.required and not task.approval.is_approved():
            raise InvalidTransitionError("Task approval is required before RUNNING")
        if task.plan is None:
            raise InvalidTransitionError("Task plan is required before RUNNING")
        open_questions = task.plan.open_required_questions()
        if open_questions:
            ids = ", ".join(item.id for item in open_questions)
            raise InvalidTransitionError(f"Open required questions remain: {ids}")

    if target == TaskState.TESTING and not task.artifacts.diff_path:
        raise InvalidTransitionError("Diff artifact is required before TESTING")

    if target == TaskState.DONE and not task.artifacts.test_report_path:
        raise InvalidTransitionError("Test report is required before DONE")


def transition(
    task: Task,
    target: TaskState,
    event_type: str,
    message: str,
    payload: dict[str, object] | None = None,
) -> None:
    assert_transition(task, target)
    previous = task.state
    task.state = target
    event_payload = {"from": previous.value, "to": target.value}
    if payload:
        event_payload.update(payload)
    task.record_event(event_type=event_type, message=message, payload=event_payload)
