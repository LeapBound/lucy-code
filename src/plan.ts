import { PlanValidationError } from "./errors.js"
import { StepType, type Plan } from "./models.js"

export function validatePlan(plan: Plan): string[] {
  const errors: string[] = []

  if (!plan.planId) {
    errors.push("planId is required")
  }
  if (!plan.taskId) {
    errors.push("taskId is required")
  }
  if (!plan.goal.trim()) {
    errors.push("goal is required")
  }

  if (plan.constraints.allowedPaths.length === 0) {
    errors.push("constraints.allowedPaths must not be empty")
  }
  if (plan.constraints.maxFilesChanged <= 0) {
    errors.push("constraints.maxFilesChanged must be > 0")
  }

  if (plan.steps.length === 0) {
    errors.push("at least one plan step is required")
    return errors
  }

  const seenStepIds = new Set<string>()
  let hasCode = false
  let hasTest = false

  for (const step of plan.steps) {
    if (!step.id) {
      errors.push("every step must have an id")
    } else if (seenStepIds.has(step.id)) {
      errors.push(`duplicate step id: ${step.id}`)
    } else {
      seenStepIds.add(step.id)
    }

    if (step.type === StepType.CODE) {
      hasCode = true
    }
    if (step.type === StepType.TEST) {
      hasTest = true
      if (!step.command || !step.command.trim()) {
        errors.push(`test step '${step.id}' requires command`)
      }
    }
  }

  if (!hasCode) {
    errors.push("plan requires at least one code step")
  }
  if (!hasTest) {
    errors.push("plan requires at least one test step")
  }

  return errors
}

export function assertPlanValid(plan: Plan): void {
  const errors = validatePlan(plan)
  if (errors.length > 0) {
    throw new PlanValidationError(errors.join("; "))
  }
}
