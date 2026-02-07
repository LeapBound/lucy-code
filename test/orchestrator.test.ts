import { mkdtemp, readFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { afterEach, describe, expect, test } from "vitest"

import { Orchestrator } from "../src/orchestrator.js"
import { TaskStore } from "../src/store.js"
import { StepStatus, StepType, TaskState, type Task } from "../src/models.js"
import type { BuildExecutionResult, ClarifyResult, OpenCodeClient, TestExecutionResult } from "../src/adapters/opencode.js"
import { FeishuConversationStore } from "../src/channels/feishu-conversation.js"

class FakeOpenCodeClient implements OpenCodeClient {
  constructor(private readonly testExitCode = 0) {}

  async clarify(task: Task): Promise<ClarifyResult> {
    return {
      summary: "ok",
      usage: {},
      rawText: "",
      plan: {
        planId: `plan_${task.taskId}`,
        taskId: task.taskId,
        version: 1,
        goal: task.description,
        assumptions: [],
        constraints: { allowedPaths: ["src/**"], forbiddenPaths: ["secrets/**"], maxFilesChanged: 10 },
        questions: [],
        steps: [
          { id: "s1", type: StepType.CODE, title: "code", status: StepStatus.PENDING, command: null },
          { id: "s2", type: StepType.TEST, title: "test", status: StepStatus.PENDING, command: "npm test" },
        ],
        approvalGateBeforeRun: true,
        approvalGateBeforeCommit: true,
        createdAt: new Date().toISOString(),
        createdBy: "fake",
      },
    }
  }

  async build(): Promise<BuildExecutionResult> {
    return {
      changedFiles: ["src/new.ts"],
      diffPath: "/tmp/diff.patch",
      outputText: "done",
      usage: {},
    }
  }

  async runTest(_task: Task, command: string): Promise<TestExecutionResult> {
    return {
      command,
      exitCode: this.testExitCode,
      logPath: "/tmp/test.log",
      durationMs: 1,
    }
  }
}

const createdDirs: string[] = []

afterEach(async () => {
  const fs = await import("node:fs/promises")
  while (createdDirs.length > 0) {
    const dir = createdDirs.pop()
    if (!dir) continue
    await fs.rm(dir, { recursive: true, force: true })
  }
})

async function newHarness(testExitCode = 0) {
  const root = await mkdtemp(join(tmpdir(), "lucy-orchestrator-test-"))
  createdDirs.push(root)
  const store = new TaskStore(join(root, "tasks"))
  const orchestrator = new Orchestrator(store, new FakeOpenCodeClient(testExitCode), {
    reportDir: join(root, "reports"),
    conversationStore: new FeishuConversationStore(join(root, "conversations.json")),
  })
  return { orchestrator, store }
}

describe("orchestrator", () => {
  test("runs happy path", async () => {
    const { orchestrator } = await newHarness(0)
    let task = await orchestrator.createTask({
      title: "Task",
      description: "Implement",
      source: { type: "feishu", userId: "u", chatId: "c", messageId: "m" },
      repo: { name: "repo", baseBranch: "main", worktreePath: ".", branch: null },
    })

    task = await orchestrator.clarifyTask(task.taskId)
    task = await orchestrator.approveTask(task.taskId, "u")
    task = await orchestrator.runTask(task.taskId)

    expect(task.state).toBe(TaskState.DONE)
    expect(task.artifacts.testReportPath).toBeTruthy()
  })

  test("marks task failed when tests fail", async () => {
    const { orchestrator } = await newHarness(1)
    let task = await orchestrator.createTask({
      title: "Task",
      description: "Implement",
      source: { type: "feishu", userId: "u", chatId: "c", messageId: "m" },
      repo: { name: "repo", baseBranch: "main", worktreePath: ".", branch: null },
    })

    task = await orchestrator.clarifyTask(task.taskId)
    await orchestrator.approveTask(task.taskId, "u")
    task = await orchestrator.runTask(task.taskId)
    expect(task.state).toBe(TaskState.FAILED)
  })

  test("does not create task immediately for ambiguous message", async () => {
    const { orchestrator, store } = await newHarness(0)
    const result = await orchestrator.processFeishuMessage({
      requirement: {
        userId: "ou_1",
        chatId: "oc_1",
        messageId: "om_1",
        text: "这个要怎么做？",
      },
      repoName: "repo",
      autoClarify: true,
    })

    expect(result.task).toBeNull()
    expect(result.replyText).toMatch(/不急着创建任务/)

    const list = await store.list()
    expect(list.length).toBe(0)
  })

  test("creates task when user confirms draft", async () => {
    const { orchestrator, store } = await newHarness(0)
    await orchestrator.processFeishuMessage({
      requirement: {
        userId: "ou_1",
        chatId: "oc_1",
        messageId: "om_1",
        text: "我想加一个新的命令",
      },
      repoName: "repo",
      autoClarify: false,
    })

    const confirmed = await orchestrator.processFeishuMessage({
      requirement: {
        userId: "ou_1",
        chatId: "oc_1",
        messageId: "om_2",
        text: "好，帮我做",
      },
      repoName: "repo",
      autoClarify: false,
    })

    expect(confirmed.task).not.toBeNull()
    expect(confirmed.task?.state).toBe(TaskState.NEW)

    const list = await store.list()
    expect(list.length).toBe(1)
  })
})
