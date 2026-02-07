import { describe, expect, test } from "vitest"

import { validatePlan } from "../src/plan.js"
import { StepStatus, StepType, type Plan } from "../src/models.js"

function validPlan(): Plan {
  return {
    planId: "plan_1",
    taskId: "task_1",
    version: 1,
    goal: "Implement feature",
    assumptions: [],
    constraints: {
      allowedPaths: ["src/**", "test/**"],
      forbiddenPaths: ["secrets/**"],
      maxFilesChanged: 10,
    },
    questions: [],
    steps: [
      { id: "s1", type: StepType.CODE, title: "Write code", status: StepStatus.PENDING, command: null },
      { id: "s2", type: StepType.TEST, title: "Run tests", status: StepStatus.PENDING, command: "npm test" },
    ],
    approvalGateBeforeRun: true,
    approvalGateBeforeCommit: true,
    createdAt: new Date().toISOString(),
    createdBy: "test",
  }
}

describe("validatePlan", () => {
  test("accepts valid plan", () => {
    expect(validatePlan(validPlan())).toEqual([])
  })

  test("requires test step command", () => {
    const plan = validPlan()
    plan.steps[1] = { ...plan.steps[1], command: "" }
    expect(validatePlan(plan)).toContain("test step 's2' requires command")
  })
})
