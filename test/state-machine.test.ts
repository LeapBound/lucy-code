import { describe, expect, test } from "vitest"

import { transition } from "../src/state-machine.js"
import {
  newTask,
  QuestionStatus,
  StepStatus,
  StepType,
  TaskState,
} from "../src/models.js"
import { InvalidTransitionError } from "../src/errors.js"

function buildTask() {
  const task = newTask({
    title: "Task",
    description: "desc",
    source: { type: "feishu", userId: "u", chatId: "c", messageId: "m" },
    repo: { name: "repo", baseBranch: "main", worktreePath: ".", branch: null },
  })

  task.plan = {
    planId: "plan_1",
    taskId: task.taskId,
    version: 1,
    goal: "goal",
    assumptions: [],
    constraints: { allowedPaths: ["src/**"], forbiddenPaths: [], maxFilesChanged: 10 },
    questions: [{ id: "q1", question: "ok?", required: true, status: QuestionStatus.ANSWERED }],
    steps: [
      { id: "s1", type: StepType.CODE, title: "code", status: StepStatus.PENDING, command: null },
      { id: "s2", type: StepType.TEST, title: "test", status: StepStatus.PENDING, command: "npm test" },
    ],
    approvalGateBeforeRun: true,
    approvalGateBeforeCommit: true,
    createdAt: new Date().toISOString(),
    createdBy: "test",
  }
  return task
}

describe("state-machine", () => {
  test("requires approval before running", () => {
    const task = buildTask()
    task.state = TaskState.WAIT_APPROVAL
    expect(() => transition(task, TaskState.RUNNING, "state.change", "run")).toThrow(InvalidTransitionError)
  })

  test("allows happy path", () => {
    const task = buildTask()
    transition(task, TaskState.CLARIFYING, "state.change", "clarify")
    transition(task, TaskState.WAIT_APPROVAL, "state.change", "wait")
    task.approval.approvedBy = "u"
    task.approval.approvedAt = new Date().toISOString()
    transition(task, TaskState.RUNNING, "state.change", "run")
    task.artifacts.diffPath = "/tmp/a.diff"
    transition(task, TaskState.TESTING, "state.change", "test")
    task.artifacts.testReportPath = "/tmp/report.json"
    transition(task, TaskState.DONE, "state.change", "done")

    expect(task.state).toBe(TaskState.DONE)
  })
})
