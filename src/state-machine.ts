import { InvalidTransitionError } from "./errors.js"
import { isApproved, openRequiredQuestions, recordTaskEvent, TaskState, type Task } from "./models.js"

const ALLOWED_TRANSITIONS: Record<TaskState, Set<TaskState>> = {
  [TaskState.NEW]: new Set([TaskState.CLARIFYING, TaskState.FAILED, TaskState.CANCELLED]),
  [TaskState.CLARIFYING]: new Set([TaskState.WAIT_APPROVAL, TaskState.FAILED, TaskState.CANCELLED]),
  [TaskState.WAIT_APPROVAL]: new Set([TaskState.RUNNING, TaskState.FAILED, TaskState.CANCELLED]),
  [TaskState.RUNNING]: new Set([TaskState.TESTING, TaskState.FAILED, TaskState.CANCELLED]),
  [TaskState.TESTING]: new Set([TaskState.DONE, TaskState.FAILED, TaskState.AUTO_FIXING, TaskState.CANCELLED]),
  [TaskState.AUTO_FIXING]: new Set([TaskState.TESTING, TaskState.DONE, TaskState.FAILED, TaskState.CANCELLED]),
  [TaskState.DONE]: new Set(),
  [TaskState.FAILED]: new Set([TaskState.RUNNING, TaskState.AUTO_FIXING, TaskState.CANCELLED]),
  [TaskState.CANCELLED]: new Set(),
}

export function assertTransition(task: Task, target: TaskState): void {
  const allowed = ALLOWED_TRANSITIONS[task.state]
  if (!allowed?.has(target)) {
    throw new InvalidTransitionError(`Invalid transition: ${task.state} -> ${target}`)
  }

  if (target === TaskState.RUNNING) {
    if (!isApproved(task)) {
      throw new InvalidTransitionError("Task approval is required before RUNNING")
    }
    if (!task.plan) {
      throw new InvalidTransitionError("Task plan is required before RUNNING")
    }
    const openQuestions = openRequiredQuestions(task)
    if (openQuestions.length > 0) {
      throw new InvalidTransitionError(
        `Open required questions remain: ${openQuestions.map((item) => item.id).join(", ")}`,
      )
    }
  }

  if (target === TaskState.TESTING && !task.artifacts.diffPath) {
    throw new InvalidTransitionError("Diff artifact is required before TESTING")
  }

  if (target === TaskState.DONE && !task.artifacts.testReportPath) {
    throw new InvalidTransitionError("Test report is required before DONE")
  }
}

export function transition(
  task: Task,
  target: TaskState,
  eventType: string,
  message: string,
  payload: Record<string, unknown> = {},
): void {
  assertTransition(task, target)
  const previous = task.state
  task.state = target

  recordTaskEvent(task, eventType, message, {
    from: previous,
    to: target,
    ...payload,
  })
}
