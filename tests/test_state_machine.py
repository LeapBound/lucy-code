import unittest

from lucy_orchestrator.exceptions import InvalidTransitionError
from lucy_orchestrator.models import (
    Approval,
    Plan,
    PlanConstraints,
    PlanQuestion,
    PlanStep,
    QuestionStatus,
    RepoContext,
    StepType,
    Task,
    TaskSource,
    TaskState,
)
from lucy_orchestrator.state_machine import transition


def _task(*, approved: bool, has_open_question: bool) -> Task:
    question_status = (
        QuestionStatus.OPEN if has_open_question else QuestionStatus.ANSWERED
    )
    task = Task(
        task_id="task_1",
        title="Test",
        description="Test flow",
        source=TaskSource(type="feishu", user_id="u1", chat_id="c1", message_id="m1"),
        repo=RepoContext(name="repo"),
        approval=Approval(required=True),
    )
    task.plan = Plan(
        plan_id="plan_1",
        task_id=task.task_id,
        version=1,
        goal="goal",
        constraints=PlanConstraints(
            allowed_paths=["src/**"], forbidden_paths=[], max_files_changed=10
        ),
        questions=[
            PlanQuestion(
                id="q1", question="question", required=True, status=question_status
            ),
        ],
        steps=[
            PlanStep(id="s1", step_type=StepType.CODE, title="code"),
            PlanStep(
                id="s2", step_type=StepType.TEST, title="test", command="pytest -q"
            ),
        ],
    )
    if approved:
        task.approval.approved_by = "u1"
        task.approval.approved_at = "2026-02-07T10:00:00Z"
    return task


class TestStateMachine(unittest.TestCase):
    def test_running_requires_approval(self) -> None:
        task = _task(approved=False, has_open_question=False)
        task.state = TaskState.WAIT_APPROVAL

        with self.assertRaises(InvalidTransitionError):
            transition(task, TaskState.RUNNING, "state.change", "to running")

    def test_running_requires_questions_closed(self) -> None:
        task = _task(approved=True, has_open_question=True)
        task.state = TaskState.WAIT_APPROVAL

        with self.assertRaises(InvalidTransitionError):
            transition(task, TaskState.RUNNING, "state.change", "to running")

    def test_testing_requires_diff_path(self) -> None:
        task = _task(approved=True, has_open_question=False)
        task.state = TaskState.RUNNING
        task.artifacts.diff_path = None

        with self.assertRaises(InvalidTransitionError):
            transition(task, TaskState.TESTING, "state.change", "to testing")

    def test_happy_path_transitions(self) -> None:
        task = _task(approved=True, has_open_question=False)

        transition(task, TaskState.CLARIFYING, "state.change", "to clarifying")
        transition(task, TaskState.WAIT_APPROVAL, "state.change", "to wait approval")
        transition(task, TaskState.RUNNING, "state.change", "to running")
        task.artifacts.diff_path = "/tmp/task.diff"
        transition(task, TaskState.TESTING, "state.change", "to testing")
        task.artifacts.test_report_path = "/tmp/task_report.json"
        transition(task, TaskState.DONE, "state.change", "to done")

        self.assertEqual(task.state, TaskState.DONE)


if __name__ == "__main__":
    unittest.main()
