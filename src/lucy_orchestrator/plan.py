from __future__ import annotations

from .exceptions import PlanValidationError
from .models import Plan, StepType


def validate_plan(plan: Plan) -> list[str]:
    errors: list[str] = []

    if not plan.plan_id:
        errors.append("plan_id is required")
    if not plan.task_id:
        errors.append("task_id is required")
    if not plan.goal.strip():
        errors.append("goal is required")

    if not plan.constraints.allowed_paths:
        errors.append("constraints.allowed_paths must not be empty")
    if plan.constraints.max_files_changed <= 0:
        errors.append("constraints.max_files_changed must be > 0")

    if not plan.steps:
        errors.append("at least one plan step is required")
        return errors

    seen_step_ids: set[str] = set()
    step_types: set[StepType] = set()

    for step in plan.steps:
        if not step.id:
            errors.append("every step must have an id")
        elif step.id in seen_step_ids:
            errors.append(f"duplicate step id: {step.id}")
        else:
            seen_step_ids.add(step.id)

        step_types.add(step.step_type)
        if step.step_type == StepType.TEST and not (
            step.command and step.command.strip()
        ):
            errors.append(f"test step '{step.id}' requires command")

    if StepType.CODE not in step_types:
        errors.append("plan requires at least one code step")
    if StepType.TEST not in step_types:
        errors.append("plan requires at least one test step")

    return errors


def assert_plan_valid(plan: Plan) -> None:
    errors = validate_plan(plan)
    if errors:
        raise PlanValidationError("; ".join(errors))
