import unittest

from lucy_orchestrator.models import Plan, PlanConstraints, PlanStep, StepType
from lucy_orchestrator.plan import validate_plan


def _valid_plan() -> Plan:
    return Plan(
        plan_id="plan_1",
        task_id="task_1",
        version=1,
        goal="Implement feature",
        constraints=PlanConstraints(
            allowed_paths=["src/**", "tests/**"],
            forbidden_paths=["secrets/**"],
            max_files_changed=10,
        ),
        steps=[
            PlanStep(id="s1", step_type=StepType.CODE, title="Write code"),
            PlanStep(
                id="s2", step_type=StepType.TEST, title="Run tests", command="pytest -q"
            ),
        ],
    )


class TestPlanValidator(unittest.TestCase):
    def test_validate_plan_success(self) -> None:
        self.assertEqual(validate_plan(_valid_plan()), [])

    def test_validate_plan_missing_test_step(self) -> None:
        plan = _valid_plan()
        plan.steps = [PlanStep(id="s1", step_type=StepType.CODE, title="Write code")]

        errors = validate_plan(plan)
        self.assertIn("plan requires at least one test step", errors)

    def test_validate_plan_missing_test_command(self) -> None:
        plan = _valid_plan()
        plan.steps[1].command = ""

        errors = validate_plan(plan)
        self.assertIn("test step 's2' requires command", errors)


if __name__ == "__main__":
    unittest.main()
