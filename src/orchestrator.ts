import { writeFile } from "node:fs/promises"
import { resolve } from "node:path"
import { mkdirSync } from "node:fs"

import type { OpenCodeClient } from "./adapters/opencode.js"
import { OrchestratorError } from "./errors.js"
import {
  ApprovalIntent,
  HybridIntentClassifier,
  type IntentClassifier,
} from "./intent.js"
import {
  newTask,
  openRequiredQuestions,
  QuestionStatus,
  recordTaskEvent,
  StepType,
  TaskState,
  type RepoContext,
  type Task,
  type TaskSource,
  utcNowIso,
} from "./models.js"
import { assertPlanValid } from "./plan.js"
import { enforceFilePolicy } from "./policy.js"
import { assertTransition, transition } from "./state-machine.js"
import { TaskStore } from "./store.js"
import { WorktreeManager } from "./worktree.js"
import type { FeishuRequirement } from "./channels/feishu.js"

export interface OrchestratorOptions {
  reportDir?: string
  intentClassifier?: IntentClassifier
}

export class Orchestrator {
  private readonly reportDir: string
  private readonly intentClassifier: IntentClassifier

  constructor(
    private readonly store: TaskStore,
    private readonly opencodeClient: OpenCodeClient,
    options: OrchestratorOptions = {},
  ) {
    this.reportDir = resolve(options.reportDir ?? ".orchestrator/reports")
    mkdirSync(this.reportDir, { recursive: true })
    this.intentClassifier = options.intentClassifier ?? new HybridIntentClassifier()
  }

  async createTask(input: {
    title: string
    description: string
    source: TaskSource
    repo: RepoContext
  }): Promise<Task> {
    const task = newTask(input)
    recordTaskEvent(task, "task.created", "Task created")
    await this.store.save(task)
    return task
  }

  async createTaskFromRequirement(input: {
    requirement: FeishuRequirement
    repoName: string
    baseBranch?: string
    worktreePath?: string | null
  }): Promise<Task> {
    const description = input.requirement.text.trim()
    const title = description.split(/\r?\n/)[0]?.slice(0, 80) || "Feishu requirement"
    return this.createTask({
      title,
      description,
      source: {
        type: "feishu",
        userId: input.requirement.userId,
        chatId: input.requirement.chatId,
        messageId: input.requirement.messageId,
      },
      repo: {
        name: input.repoName,
        baseBranch: input.baseBranch ?? "main",
        worktreePath: input.worktreePath ?? null,
        branch: null,
      },
    })
  }

  async clarifyTask(taskId: string): Promise<Task> {
    const task = await this.store.get(taskId)
    transition(task, TaskState.CLARIFYING, "state.change", "Entering CLARIFYING")

    const clarifyResult = await this.opencodeClient.clarify(task)
    task.plan = clarifyResult.plan
    task.artifacts.clarifySummary = clarifyResult.summary
    recordTaskEvent(task, "clarify.completed", "Clarification completed", {
      questions: task.plan.questions.length,
      steps: task.plan.steps.length,
    })

    transition(task, TaskState.WAIT_APPROVAL, "state.change", "Waiting for approval")
    await this.store.save(task)
    return task
  }

  async approveTask(taskId: string, approvedBy: string): Promise<Task> {
    const task = await this.store.get(taskId)
    task.approval.approvedBy = approvedBy
    task.approval.approvedAt = utcNowIso()
    recordTaskEvent(task, "approval.granted", "Task approved", { approvedBy })
    await this.store.save(task)
    return task
  }

  async handleApprovalMessage(taskId: string, userId: string, text: string): Promise<Task> {
    const task = await this.store.get(taskId)
    const intentResult = await this.intentClassifier.classify(text, task)
    recordTaskEvent(task, "approval.intent.detected", "Approval intent classified", {
      intent: intentResult.intent,
      confidence: intentResult.confidence,
      reason: intentResult.reason,
    })

    if (task.state !== TaskState.WAIT_APPROVAL) {
      recordTaskEvent(task, "approval.intent.ignored", "Task is not waiting for approval", {
        state: task.state,
      })
      await this.store.save(task)
      return task
    }

    if (intentResult.intent === ApprovalIntent.APPROVE) {
      task.approval.approvedBy = userId
      task.approval.approvedAt = utcNowIso()
      recordTaskEvent(task, "approval.granted", "Task approved from natural language intent", {
        approvedBy: userId,
      })
    } else if (intentResult.intent === ApprovalIntent.REJECT) {
      transition(task, TaskState.CANCELLED, "state.change", "Task rejected by user", {
        rejectedBy: userId,
      })
    } else {
      recordTaskEvent(task, "approval.pending", "Approval intent unclear", {
        message: text.trim(),
      })
    }

    await this.store.save(task)
    return task
  }

  async provisionWorktree(input: {
    taskId: string
    repoPath: string
    worktreesRoot?: string
    branchPrefix?: string
  }): Promise<Task> {
    const task = await this.store.get(input.taskId)
    const manager = new WorktreeManager(input.repoPath, input.worktreesRoot)
    const handle = await manager.create(
      task.taskId,
      task.repo.baseBranch,
      input.branchPrefix ?? "agent",
    )
    task.repo.worktreePath = handle.path
    task.repo.branch = handle.branch
    recordTaskEvent(task, "worktree.created", "Task worktree provisioned", {
      branch: handle.branch,
      path: handle.path,
    })
    await this.store.save(task)
    return task
  }

  async cleanupWorktree(input: {
    taskId: string
    repoPath: string
    worktreesRoot?: string
    force?: boolean
  }): Promise<Task> {
    const task = await this.store.get(input.taskId)
    const manager = new WorktreeManager(input.repoPath, input.worktreesRoot)
    await manager.remove(task.taskId, input.force ?? false)
    recordTaskEvent(task, "worktree.removed", "Task worktree removed")
    await this.store.save(task)
    return task
  }

  async runTask(taskId: string): Promise<Task> {
    const task = await this.store.get(taskId)
    if (task.state === TaskState.FAILED && task.execution.attempt >= task.execution.maxAttempts) {
      throw new OrchestratorError(
        `Task exceeded max attempts: ${task.execution.attempt}/${task.execution.maxAttempts}`,
      )
    }

    task.execution.attempt += 1
    recordTaskEvent(task, "run.started", "Task run started", { attempt: task.execution.attempt })

    try {
      transition(task, TaskState.RUNNING, "state.change", "Entering RUNNING")

      if (!task.plan) {
        throw new OrchestratorError("Task plan is missing")
      }
      assertPlanValid(task.plan)

      const buildResult = await this.opencodeClient.build(task)
      task.artifacts.diffPath = buildResult.diffPath
      task.artifacts.changedFiles = buildResult.changedFiles
      enforceFilePolicy(task.artifacts.changedFiles, task.plan.constraints)
      recordTaskEvent(task, "build.completed", "Build step completed", {
        diffPath: task.artifacts.diffPath,
        changedFiles: task.artifacts.changedFiles.length,
      })

      transition(task, TaskState.TESTING, "state.change", "Entering TESTING")

      const testSteps = task.plan.steps.filter((step) => step.type === StepType.TEST)
      const testResults: Array<Record<string, unknown>> = []
      let allPassed = true

      for (const step of testSteps) {
        const command = step.command ?? ""
        const result = await this.opencodeClient.runTest(task, command)
        testResults.push({
          command: result.command,
          exitCode: result.exitCode,
          logPath: result.logPath,
          durationMs: result.durationMs,
        })
        if (result.exitCode !== 0) {
          allPassed = false
          break
        }
      }

      const reportPath = await this.writeTestReport(task.taskId, testResults)
      task.artifacts.testResults = testResults
      task.artifacts.testReportPath = reportPath

      if (allPassed) {
        task.execution.lastError = null
        transition(task, TaskState.DONE, "state.change", "Task completed")
      } else {
        task.execution.lastError = "One or more tests failed"
        transition(task, TaskState.FAILED, "state.change", "Task failed in tests")
      }
    } catch (error) {
      task.execution.lastError = error instanceof Error ? error.message : String(error)
      if (![TaskState.FAILED, TaskState.DONE, TaskState.CANCELLED].includes(task.state)) {
        try {
          transition(task, TaskState.FAILED, "state.change", "Task failed")
        } catch {
          task.state = TaskState.FAILED
          task.updatedAt = utcNowIso()
        }
      }

      recordTaskEvent(task, "run.failed", "Task run failed", {
        error: task.execution.lastError,
      })
      await this.store.save(task)
      throw error
    }

    await this.store.save(task)
    return task
  }

  async processFeishuMessage(input: {
    requirement: FeishuRequirement
    repoName: string
    baseBranch?: string
    worktreePath?: string
    autoClarify?: boolean
    autoRunOnApprove?: boolean
    autoProvisionWorktree?: boolean
    repoPath?: string
    worktreesRoot?: string
    branchPrefix?: string
  }): Promise<{ task: Task; replyText: string }> {
    const pendingTask = await this.findLatestWaitingApprovalTask(
      input.requirement.chatId,
      input.requirement.userId,
    )

    if (pendingTask) {
      let task = await this.handleApprovalMessage(
        pendingTask.taskId,
        input.requirement.userId,
        input.requirement.text,
      )

      if (task.state === TaskState.CANCELLED) {
        return { task, replyText: `任务 ${task.taskId} 已取消。` }
      }

      if (task.approval.approvedBy && task.approval.approvedAt) {
        if (input.autoProvisionWorktree && input.repoPath && !task.repo.branch) {
          try {
            task = await this.provisionWorktree({
              taskId: task.taskId,
              repoPath: input.repoPath,
              worktreesRoot: input.worktreesRoot,
              branchPrefix: input.branchPrefix ?? "agent",
            })
          } catch (error) {
            return {
              task,
              replyText: `任务 ${task.taskId} 已批准，但创建 worktree 失败：${String(error)}。`,
            }
          }
        }

        if (input.autoRunOnApprove) {
          try {
            task = await this.runTask(task.taskId)
          } catch (error) {
            return {
              task,
              replyText: `任务 ${task.taskId} 已批准，但执行失败：${String(error)}。`,
            }
          }
        }

        return {
          task,
          replyText: `任务 ${task.taskId} 已批准，当前状态：${task.state}。`,
        }
      }

      return {
        task,
        replyText: `我还无法确定是否批准任务 ${task.taskId}。请回复“同意/开始”或“取消/拒绝”。`,
      }
    }

    let task = await this.createTaskFromRequirement({
      requirement: input.requirement,
      repoName: input.repoName,
      baseBranch: input.baseBranch,
      worktreePath: input.worktreePath,
    })

    if (input.autoProvisionWorktree && input.repoPath && !task.repo.branch) {
      try {
        task = await this.provisionWorktree({
          taskId: task.taskId,
          repoPath: input.repoPath,
          worktreesRoot: input.worktreesRoot,
          branchPrefix: input.branchPrefix ?? "agent",
        })
      } catch (error) {
        return {
          task,
          replyText: `任务 ${task.taskId} 已创建，但 worktree 创建失败：${String(error)}。`,
        }
      }
    }

    if (input.autoClarify !== false) {
      task = await this.clarifyTask(task.taskId)
      return { task, replyText: this.buildApprovalPrompt(task) }
    }

    return {
      task,
      replyText: `任务 ${task.taskId} 已创建。下一步请运行 clarify。`,
    }
  }

  private async findLatestWaitingApprovalTask(chatId: string, userId: string): Promise<Task | null> {
    const tasks = await this.store.list()
    const candidates = tasks.filter(
      (task) =>
        task.state === TaskState.WAIT_APPROVAL &&
        task.source.chatId === chatId &&
        task.source.userId === userId,
    )
    if (candidates.length === 0) {
      return null
    }
    return candidates.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0] ?? null
  }

  private buildApprovalPrompt(task: Task): string {
    const lines: string[] = [
      `任务 ${task.taskId} 已创建并完成澄清。`,
      `摘要：${task.artifacts.clarifySummary ?? "已完成需求澄清。"}`,
    ]

    const openQuestions = openRequiredQuestions(task)
    if (openQuestions.length > 0) {
      lines.push("待确认问题：")
      for (const question of openQuestions) {
        lines.push(`- [${question.id}] ${question.question}`)
      }
    }

    lines.push("请回复“同意/开始”批准执行，或回复“取消/拒绝”。")
    return lines.join("\n")
  }

  private async writeTestReport(
    taskId: string,
    results: Array<Record<string, unknown>>,
  ): Promise<string> {
    const reportPath = resolve(this.reportDir, `${taskId}_test_report.json`)
    await writeFile(
      reportPath,
      `${JSON.stringify(
        {
          taskId,
          generatedAt: utcNowIso(),
          results,
          passed: results.every((item) => Number(item.exitCode) === 0),
        },
        null,
        2,
      )}\n`,
      "utf-8",
    )
    return reportPath
  }
}
