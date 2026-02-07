export class OrchestratorError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "OrchestratorError"
  }
}

export class InvalidTransitionError extends OrchestratorError {
  constructor(message: string) {
    super(message)
    this.name = "InvalidTransitionError"
  }
}

export class PlanValidationError extends OrchestratorError {
  constructor(message: string) {
    super(message)
    this.name = "PlanValidationError"
  }
}

export class PolicyViolationError extends OrchestratorError {
  constructor(message: string) {
    super(message)
    this.name = "PolicyViolationError"
  }
}

export class TaskNotFoundError extends OrchestratorError {
  constructor(message: string) {
    super(message)
    this.name = "TaskNotFoundError"
  }
}

export class WorktreeError extends OrchestratorError {
  constructor(message: string) {
    super(message)
    this.name = "WorktreeError"
  }
}

export class OpenCodeInvocationError extends OrchestratorError {
  constructor(message: string) {
    super(message)
    this.name = "OpenCodeInvocationError"
  }
}
