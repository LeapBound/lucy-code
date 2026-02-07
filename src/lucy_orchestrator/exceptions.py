class OrchestratorError(Exception):
    pass


class InvalidTransitionError(OrchestratorError):
    pass


class PlanValidationError(OrchestratorError):
    pass


class PolicyViolationError(OrchestratorError):
    pass


class TaskNotFoundError(OrchestratorError):
    pass


class WorktreeError(OrchestratorError):
    pass


class OpenCodeInvocationError(OrchestratorError):
    pass
