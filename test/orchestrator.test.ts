import { mkdtemp } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { afterEach, describe, expect, test } from "vitest"

import { Orchestrator } from "../src/orchestrator.js"
import { TaskStore } from "../src/store.js"
import { QuestionStatus, StepStatus, StepType, TaskState, type Task } from "../src/models.js"
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

class BuildErrorOpenCodeClient extends FakeOpenCodeClient {
  async build(): Promise<BuildExecutionResult> {
    throw new Error("build exploded")
  }
}

class TimeoutBuildErrorOpenCodeClient extends FakeOpenCodeClient {
  async build(): Promise<BuildExecutionResult> {
    throw new Error("OpenCode execution timed out after 900s")
  }
}

class SignalBuildErrorOpenCodeClient extends FakeOpenCodeClient {
  async build(): Promise<BuildExecutionResult> {
    throw new Error("OpenCode execution terminated by signal SIGTERM")
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

async function newHarnessWithClient(client: OpenCodeClient) {
  const root = await mkdtemp(join(tmpdir(), "lucy-orchestrator-test-"))
  createdDirs.push(root)
  const store = new TaskStore(join(root, "tasks"))
  const orchestrator = new Orchestrator(store, client, {
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

  test("rejects run when max attempts already reached", async () => {
    const { orchestrator, store } = await newHarness(0)
    const task = await orchestrator.createTask({
      title: "Task",
      description: "Implement",
      source: { type: "feishu", userId: "u", chatId: "c", messageId: "m" },
      repo: { name: "repo", baseBranch: "main", worktreePath: ".", branch: null },
    })

    task.state = TaskState.FAILED
    task.execution.attempt = task.execution.maxAttempts
    await store.save(task)

    await expect(orchestrator.runTask(task.taskId)).rejects.toThrow(/exceeded max attempts/i)
  })

  test("records run.failed event with error payload when build throws", async () => {
    const { orchestrator, store } = await newHarnessWithClient(new BuildErrorOpenCodeClient(0))
    let task = await orchestrator.createTask({
      title: "Task",
      description: "Implement",
      source: { type: "feishu", userId: "u", chatId: "c", messageId: "m" },
      repo: { name: "repo", baseBranch: "main", worktreePath: ".", branch: null },
    })

    task = await orchestrator.clarifyTask(task.taskId)
    await orchestrator.approveTask(task.taskId, "u")

    await expect(orchestrator.runTask(task.taskId)).rejects.toThrow(/build exploded/)

    const stored = await store.get(task.taskId)
    const failedEvent = [...stored.eventLog].reverse().find((event) => event.eventType === "run.failed")

    expect(stored.state).toBe(TaskState.FAILED)
    expect(failedEvent).toBeTruthy()
    expect(failedEvent?.payload).toMatchObject({ error: "build exploded", errorCode: "UNKNOWN_ERROR" })
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

  test("creates task when user sends explicit start phrase", async () => {
    const { orchestrator, store } = await newHarness(0)
    await orchestrator.processFeishuMessage({
      requirement: {
        userId: "ou_1",
        chatId: "oc_1",
        messageId: "om_1",
        text: "我要优化一下重试逻辑",
      },
      repoName: "repo",
      autoClarify: false,
    })

    const confirmed = await orchestrator.processFeishuMessage({
      requirement: {
        userId: "ou_1",
        chatId: "oc_1",
        messageId: "om_2",
        text: "就按这个做",
      },
      repoName: "repo",
      autoClarify: false,
    })

    expect(confirmed.task).not.toBeNull()
    expect(confirmed.task?.state).toBe(TaskState.NEW)

    const list = await store.list()
    expect(list.length).toBe(1)
  })

  test("returns latest task status when user asks for status", async () => {
    const { orchestrator } = await newHarness(0)
    const task = await orchestrator.createTask({
      title: "Task",
      description: "Implement",
      source: { type: "feishu", userId: "ou_1", chatId: "oc_1", messageId: "m1" },
      repo: { name: "repo", baseBranch: "main", worktreePath: ".", branch: null },
    })

    const result = await orchestrator.processFeishuMessage({
      requirement: {
        userId: "ou_1",
        chatId: "oc_1",
        messageId: "m2",
        text: "状态",
      },
      repoName: "repo",
    })

    expect(result.task?.taskId).toBe(task.taskId)
    expect(result.replyText).toContain(`任务 ${task.taskId} 当前状态：`)
    expect(result.replyText).toContain("最近事件：")
    expect(result.replyText).toContain("下一步建议：")
  })

  test("includes pending question preview in WAIT_APPROVAL status", async () => {
    const { orchestrator, store } = await newHarness(0)
    let task = await orchestrator.createTask({
      title: "Task",
      description: "Implement",
      source: { type: "feishu", userId: "ou_1", chatId: "oc_1", messageId: "m1" },
      repo: { name: "repo", baseBranch: "main", worktreePath: ".", branch: null },
    })
    task = await orchestrator.clarifyTask(task.taskId)

    task.plan = {
      ...(task.plan as NonNullable<typeof task.plan>),
      questions: [
        {
          id: "q_scope",
          question: "需要支持旧版 API 吗？",
          required: true,
          status: QuestionStatus.OPEN,
          answer: null,
        },
      ],
    }
    await store.save(task)

    const result = await orchestrator.processFeishuMessage({
      requirement: {
        userId: "ou_1",
        chatId: "oc_1",
        messageId: "m2",
        text: "状态",
      },
      repoName: "repo",
    })

    expect(result.replyText).toContain("待确认问题（q_scope）")
    expect(result.replyText).toContain("问题进度：")
    expect(result.replyText).toContain("直接回复上面这个问题的答案")
    expect(result.replyText).toContain("计划进度：")
    expect(result.replyText).toContain("当前步骤：")
  })

  test("returns draft guidance when no task but draft exists and user asks status", async () => {
    const { orchestrator } = await newHarness(0)
    await orchestrator.processFeishuMessage({
      requirement: {
        userId: "ou_1",
        chatId: "oc_1",
        messageId: "m1",
        text: "我想改一下接口重试策略",
      },
      repoName: "repo",
      autoClarify: false,
    })

    const result = await orchestrator.processFeishuMessage({
      requirement: {
        userId: "ou_1",
        chatId: "oc_1",
        messageId: "m2",
        text: "进度",
      },
      repoName: "repo",
      autoClarify: false,
    })

    expect(result.task).toBeNull()
    expect(result.replyText).toContain("未创建的草稿需求")
  })

  test("returns actionable failure text when approval provisioning fails", async () => {
    const { orchestrator, store } = await newHarness(0)
    const task = await orchestrator.createTask({
      title: "Task",
      description: "Implement",
      source: { type: "feishu", userId: "ou_1", chatId: "oc_1", messageId: "m1" },
      repo: { name: "repo", baseBranch: "main", worktreePath: ".", branch: null },
    })
    task.state = TaskState.WAIT_APPROVAL
    await store.save(task)

    const result = await orchestrator.processFeishuMessage({
      requirement: {
        userId: "ou_1",
        chatId: "oc_1",
        messageId: "m2",
        text: "开始",
      },
      repoName: "repo",
      repoPath: "/definitely/not/a/repo",
      autoRunOnApprove: false,
    })

    expect(result.replyText).toContain("错误：")
    expect(result.replyText).toContain("回复“继续”")
  })

  test("returns timeout-specific action hint when approval auto-run times out", async () => {
    const { orchestrator, store } = await newHarnessWithClient(new TimeoutBuildErrorOpenCodeClient(0))
    let task = await orchestrator.createTask({
      title: "Task",
      description: "Implement",
      source: { type: "feishu", userId: "ou_1", chatId: "oc_1", messageId: "m1" },
      repo: { name: "repo", baseBranch: "main", worktreePath: ".", branch: "agent/test" },
    })
    task = await orchestrator.clarifyTask(task.taskId)
    task.repo = { ...task.repo, worktreePath: ".", branch: "agent/test" }
    await store.save(task)

    const result = await orchestrator.processFeishuMessage({
      requirement: {
        userId: "ou_1",
        chatId: "oc_1",
        messageId: "m2",
        text: "开始",
      },
      repoName: "repo",
      autoRunOnApprove: true,
    })

    expect(result.replyText).toContain("超时")
    expect(result.replyText).toContain("拆分步骤")
  })

  test("returns signal-specific action hint when approval auto-run is interrupted", async () => {
    const { orchestrator, store } = await newHarnessWithClient(new SignalBuildErrorOpenCodeClient(0))
    let task = await orchestrator.createTask({
      title: "Task",
      description: "Implement",
      source: { type: "feishu", userId: "ou_1", chatId: "oc_1", messageId: "m1" },
      repo: { name: "repo", baseBranch: "main", worktreePath: ".", branch: "agent/test" },
    })
    task = await orchestrator.clarifyTask(task.taskId)
    task.repo = { ...task.repo, worktreePath: ".", branch: "agent/test" }
    await store.save(task)

    const result = await orchestrator.processFeishuMessage({
      requirement: {
        userId: "ou_1",
        chatId: "oc_1",
        messageId: "m2",
        text: "开始",
      },
      repoName: "repo",
      autoRunOnApprove: true,
    })

    expect(result.replyText).toContain("中断")
    expect(result.replyText).toContain("回复“状态”")
  })
})
