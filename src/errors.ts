export class OrchestratorError extends Error {
  readonly code: string

  constructor(message: string, code = "ORCHESTRATOR_ERROR") {
    super(message)
    this.code = code
    this.name = "OrchestratorError"
  }
}

export class InvalidTransitionError extends OrchestratorError {
  constructor(message: string) {
    super(message, "INVALID_TRANSITION")
    this.name = "InvalidTransitionError"
  }
}

export class PlanValidationError extends OrchestratorError {
  constructor(message: string) {
    super(message, "PLAN_VALIDATION")
    this.name = "PlanValidationError"
  }
}

export class PolicyViolationError extends OrchestratorError {
  constructor(message: string) {
    super(message, "POLICY_VIOLATION")
    this.name = "PolicyViolationError"
  }
}

export class TaskNotFoundError extends OrchestratorError {
  constructor(message: string) {
    super(message, "TASK_NOT_FOUND")
    this.name = "TaskNotFoundError"
  }
}

export class WorktreeError extends OrchestratorError {
  constructor(message: string) {
    super(message, "WORKTREE_ERROR")
    this.name = "WorktreeError"
  }
}

export class OpenCodeInvocationError extends OrchestratorError {
  constructor(message: string) {
    super(message, "OPENCODE_INVOCATION")
    this.name = "OpenCodeInvocationError"
  }
}

export function errorCodeOf(error: unknown): string {
  return error instanceof OrchestratorError ? error.code : "UNKNOWN_ERROR"
}
