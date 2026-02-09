import { writeFile } from "node:fs/promises"
import { readFile } from "node:fs/promises"
import { basename, dirname, join, resolve } from "node:path"
import { mkdirSync } from "node:fs"

import type { OpenCodeClient } from "./adapters/opencode.js"
import { errorCodeOf, OrchestratorError } from "./errors.js"
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
  type PlanStep,
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
import { ContainerWebSocketServer } from "./container-ws.js"
import type { TaskEvent } from "./container-ws.js"
import type { FeishuRequirement } from "./channels/feishu.js"
import { FeishuConversationStore } from "./channels/feishu-conversation.js"
import { logError } from "./logger.js"

export interface OrchestratorOptions {
  reportDir?: string
  intentClassifier?: IntentClassifier
  conversationStore?: FeishuConversationStore
  enableContainerSdk?: boolean
  wsServerPort?: number
  feishuMessenger?: { sendText(chatId: string, text: string): Promise<void> }
}

export class Orchestrator {
  private readonly reportDir: string
  private readonly intentClassifier: IntentClassifier
  private readonly conversationStore: FeishuConversationStore
  private readonly wsServer?: ContainerWebSocketServer

  constructor(
    private readonly store: TaskStore,
    private readonly opencodeClient: OpenCodeClient,
    private readonly options: OrchestratorOptions = {},
  ) {
    this.reportDir = resolve(options.reportDir ?? ".orchestrator/reports")
    mkdirSync(this.reportDir, { recursive: true })
    this.intentClassifier = options.intentClassifier ?? new HybridIntentClassifier()
    this.conversationStore = options.conversationStore ?? new FeishuConversationStore()

    if (options.enableContainerSdk) {
      this.wsServer = new ContainerWebSocketServer(options.wsServerPort ?? 18791)
      this.wsServer.on("task-status", (event) => {
        void this.handleContainerEvent(event)
      })
    }
  }

  private async handleContainerEvent(event: TaskEvent): Promise<void> {
    try {
      const task = await this.store.get(event.taskId)
      recordTaskEvent(task, event.type, typeof event.payload.message === "string" ? event.payload.message : "Container event received", event.payload)
      await this.store.save(task)
      
      // Forward real-time status to Feishu if configured
      if (this.options.feishuMessenger) {
        const message = this.formatRealtimeStatus(event)
        await this.options.feishuMessenger.sendText(task.source.chatId, message)
      }
    } catch (error) {
      logError("Failed to handle container event", error, { taskId: event.taskId, phase: "container.event" })
    }
  }

  private formatRealtimeStatus(event: TaskEvent): string {
    switch (event.type) {
      case "step-start":
        return `任务 ${event.taskId}: 开始执行步骤 "${event.payload.stepTitle}"...`
      case "step-complete":
        return `任务 ${event.taskId}: 步骤 "${event.payload.stepTitle}" 完成。`
      case "build-progress":
        return `任务 ${event.taskId}: 构建进度 ${(event.payload.progressPercent ?? 0)}%`
      case "test-failed":
        return `任务 ${event.taskId}: 测试失败，正在尝试自动修复...`
      case "task-completed":
        return `任务 ${event.taskId}: 全部完成！`
      default:
        return `任务 ${event.taskId}: ${event.payload.message ?? "未知事件"}`
    }
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
    const repoPath = resolve(input.repoPath)
    const worktreesRoot = input.worktreesRoot ?? defaultWorktreesRoot(repoPath, task.repo.name)
    const manager = new WorktreeManager(repoPath, worktreesRoot)
    const handle = await manager.create(
      task.taskId,
      task.title,
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
    const repoPath = resolve(input.repoPath)
    const worktreesRoot = input.worktreesRoot ?? defaultWorktreesRoot(repoPath, task.repo.name)
    const manager = new WorktreeManager(repoPath, worktreesRoot)
    const legacyPath = join(repoPath, "worktrees", task.taskId)
    const targetPath = task.repo.worktreePath ?? legacyPath
    await manager.remove(targetPath, input.force ?? false)
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
        
        // Enter auto-fix loop if attempts remaining and not exceeding max
        if (task.execution.attempt < task.execution.maxAttempts) {
          transition(task, TaskState.AUTO_FIXING, "state.change", "Entering auto-fix loop")
          
          // Attempt auto-fix
          try {
            const fixResult = await this.attemptAutoFix(task, testResults)
            if (fixResult.success) {
              // Re-run tests after fix
              const retestResults = await this.executeTestSteps(task, testSteps)
              const allRetestPassed = retestResults.every((result) => result.exitCode === 0)
              
              if (allRetestPassed) {
                task.execution.lastError = null
                transition(task, TaskState.DONE, "state.change", "Task completed after auto-fix")
              } else {
                // Fix didn't solve issue, set to failed but allow retry
                task.execution.lastError = "Auto-fix did not resolve test failures"
                task.artifacts.testResults = retestResults
                await this.writeTestReport(task.taskId, retestResults)
                transition(task, TaskState.FAILED, "state.change", "Auto-fix failed, tests still failing")
              }
            } else {
              // Auto-fix failed completely
              task.execution.lastError = `Auto-fix failed: ${fixResult.error}`
              transition(task, TaskState.FAILED, "state.change", "Auto-fix execution failed")
            }
          } catch (fixError) {
            // Catch-all if auto-fix throws
            task.execution.lastError = `Auto-fix threw exception: ${String(fixError instanceof Error ? fixError.message : fixError)}`
            transition(task, TaskState.FAILED, "state.change", "Auto-fix execution threw error")
          }
        } else {
          // No more attempts left
          transition(task, TaskState.FAILED, "state.change", "Task failed in tests after max attempts")
        }
      }
    } catch (error) {
      task.execution.lastError = error instanceof Error ? error.message : String(error)
      if (![TaskState.FAILED, TaskState.DONE, TaskState.CANCELLED].includes(task.state)) {
        try {
          transition(task, TaskState.FAILED, "state.change", "Task failed")
        } catch (transitionError) {
          logError("Failed to transition task to FAILED, applying fallback state mutation", transitionError, {
            taskId: task.taskId,
            phase: "run.transition",
          })
          task.state = TaskState.FAILED
          task.updatedAt = utcNowIso()
        }
      }

      recordTaskEvent(task, "run.failed", "Task run failed", {
        error: task.execution.lastError,
        errorCode: errorCodeOf(error),
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
  }): Promise<{ task: Task | null; replyText: string }> {
    const normalizedText = input.requirement.text.trim()

    // 1. Handle existing pending task (clarification/approval intent)
    const pendingTask = await this.findLatestWaitingApprovalTask(
      input.requirement.chatId,
      input.requirement.userId,
    )

    if (this.isStatusQuery(normalizedText)) {
      if (pendingTask) {
        const current = await this.store.get(pendingTask.taskId)
        return { task: current, replyText: this.buildTaskStatusReply(current) }
      }

      const latest = await this.findLatestTaskForChatUser(input.requirement.chatId, input.requirement.userId)
      if (latest) {
        const current = await this.store.get(latest.taskId)
        return { task: current, replyText: this.buildTaskStatusReply(current) }
      }

      const draft = await this.conversationStore.getDraft(input.requirement.chatId, input.requirement.userId)
      if (draft) {
        return {
          task: null,
          replyText:
            "你当前还有一条未创建的草稿需求。\n" +
            "回复“开始/继续/就按这个做”我会立即建任务并进入澄清；\n" +
            "回复“取消/算了”会清掉草稿。",
        }
      }

      return {
        task: null,
        replyText: "目前没有进行中的任务。你可以直接发 `需求: ...`，或先描述需求让我帮你整理草稿。",
      }
    }

    if (pendingTask) {
      const openQuestions = openRequiredQuestions(pendingTask)
      if (openQuestions.length > 0) {
        if (this.isDraftCancel(normalizedText)) {
          const task = await this.store.get(pendingTask.taskId)
          try {
            transition(task, TaskState.CANCELLED, "state.change", "Task cancelled by user")
          } catch (transitionError) {
            logError("Failed to transition task to CANCELLED during clarification, applying fallback", transitionError, {
              taskId: task.taskId,
              phase: "clarify.transition",
            })
            task.state = TaskState.CANCELLED
          }
          recordTaskEvent(task, "task.cancelled", "Task cancelled during clarification")
          await this.store.save(task)
          return {
            task,
            replyText: `好的，我先把任务 ${task.taskId} 停掉了。如果要继续再告诉我。`,
          }
        }

        const updated = await this.answerNextQuestion(
          pendingTask.taskId,
          normalizedText,
        )
        return { task: updated, replyText: this.buildNextInteractionPrompt(updated) }
      }

      let task = await this.handleApprovalMessage(
        pendingTask.taskId,
        input.requirement.userId,
        input.requirement.text,
      )

      if (task.state === TaskState.CANCELLED) {
        return { task, replyText: `任务 ${task.taskId} 已取消。` }
      }

      if (task.approval.approvedBy && task.approval.approvedAt) {
        if (!task.repo.branch || !task.repo.worktreePath) {
          if (!input.repoPath) {
            return {
              task,
              replyText:
                `任务 ${task.taskId} 已批准，但缺少 repoPath，无法创建 worktree。\n` +
                "请在启动服务/命令时指定 --repo-path，并确保该路径是一个 git 仓库。",
            }
          }
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
              replyText: this.buildActionableFailureReply(
                task.taskId,
                "创建 worktree 失败",
                error,
                "你可以先检查 repoPath 是否是可读写的 git 仓库，然后回复“继续”。",
              ),
            }
          }
        }

        if (input.autoRunOnApprove) {
          try {
            task = await this.runTask(task.taskId)
          } catch (error) {
            return {
              task,
              replyText: this.buildActionableFailureReply(
                task.taskId,
                "执行失败",
                error,
                "你可以先回复“状态”查看最近错误，再回复“继续”重试。",
              ),
            }
          }
        }

        return {
          task,
          replyText: this.buildTaskStatusReply(task),
        }
      }

      return {
        task,
        replyText:
          `我还不太确定你是想让我继续执行任务 ${task.taskId}，还是先暂停。\n` +
          "你可以直接说：\n" +
          "- 继续做（或：开始/同意/按这个来）\n" +
          "- 先别做（或：取消/暂停）",
      }
    }

    // 2. Handle explicit task creation intent (e.g. "需求: ...", "/task ...")
    const explicitText = this.extractExplicitTaskText(input.requirement.text)
    if (explicitText) {
      const task = await this.createTaskFromRequirement({
        requirement: { ...input.requirement, text: explicitText },
        repoName: input.repoName,
        baseBranch: input.baseBranch,
        worktreePath: input.worktreePath,
      })
      return await this.afterTaskCreated(task, input)
    }

    // 3. Handle implicit conversation (draft storage + intent confirmation)
    const draft = await this.conversationStore.getDraft(
      input.requirement.chatId,
      input.requirement.userId,
    )

    if (!draft) {
      await this.conversationStore.setDraft({
        chatId: input.requirement.chatId,
        userId: input.requirement.userId,
        messageId: input.requirement.messageId,
        text: input.requirement.text,
      })

      return {
        task: null,
        replyText:
          "我先不急着创建任务。\n\n" +
          "你想让我把它当作开发任务推进吗？\n\n" +
          `当前内容：\n${this.buildDraftPreview(input.requirement.text)}\n\n` +
          "如果是：直接回复“好，做吧 / 继续 / 开始”，我就会创建任务并进入澄清。\n" +
          "如果不是：回复“算了/不用/取消”就行，我不会创建任务。\n\n" +
          "提示：你也可以用 `需求: ...` 直接明确这是任务。",
      }
    }

    // 4. Process draft continuation/approval intent
      const explicitDecision = this.parseExplicitDraftDecision(normalizedText)
      const decision = explicitDecision ?? (await this.intentClassifier.classify(normalizedText))

    if (decision.intent === ApprovalIntent.APPROVE) {
      await this.conversationStore.clearDraft(draft.chatId, draft.userId)
      const task = await this.createTaskFromRequirement({
        requirement: {
          ...input.requirement,
          messageId: draft.messageId,
          text: draft.text,
        },
        repoName: input.repoName,
        baseBranch: input.baseBranch,
        worktreePath: input.worktreePath,
      })
      return await this.afterTaskCreated(task, input)
    }

    if (decision.intent === ApprovalIntent.REJECT || this.isDraftCancel(normalizedText)) {
      await this.conversationStore.clearDraft(draft.chatId, draft.userId)
      return { task: null, replyText: "好的，我不创建任务。" }
    }

    await this.conversationStore.appendToDraft(
      draft.chatId,
      draft.userId,
      input.requirement.messageId,
      input.requirement.text,
    )
    return {
      task: null,
      replyText:
        "收到，我把这条也记到草稿里了（仍未创建任务）。\n\n" +
        "如果你希望我开始做：直接回“开始/继续/就按这个做”就行。\n" +
        "如果你想先看当前状态：回“状态/进度”。\n" +
        "如果你只是想问问：回“算了/不用/取消”就行。",
    }
  }

  private async afterTaskCreated(
    task: Task,
    input: {
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
    },
  ): Promise<{ task: Task; replyText: string }> {
    if (!task.repo.branch || !task.repo.worktreePath) {
      if (!input.repoPath) {
        return {
          task,
          replyText:
            `任务 ${task.taskId} 已创建，但缺少 repoPath，无法创建 worktree。\n` +
            "请在启动服务/命令时指定 --repo-path，并确保该路径是一个 git 仓库。",
        }
      }
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
          replyText: this.buildActionableFailureReply(
            task.taskId,
            "worktree 创建失败",
            error,
            "建议先确认仓库路径和分支权限，然后回复“继续”重试。",
          ),
        }
      }
    }

    if (input.autoClarify !== false) {
      task = await this.clarifyTask(task.taskId)
      return { task, replyText: this.buildNextInteractionPrompt(task) }
    }

    return {
      task,
      replyText: `任务 ${task.taskId} 已创建。下一步请运行 clarify。你也可以随时回复“状态/进度”查看当前状态。`,
    }
  }

  private buildNextInteractionPrompt(task: Task): string {
    const summary = task.artifacts.clarifySummary ?? "已完成需求澄清。"
    const openQuestions = openRequiredQuestions(task)
    if (openQuestions.length > 0) {
      const question = openQuestions[0]
      return (
        `好的，任务 ${task.taskId} 已创建并完成澄清。\n` +
        `摘要：${summary}\n\n` +
        `有个细节我想跟你确认一下（${question.id}）：${question.question}\n` +
        "你直接回复你的想法/选择就行。也可以回复“状态”查看任务进展。"
      )
    }

    return (
      `好的，任务 ${task.taskId} 已创建并完成澄清。\n` +
      `摘要：${summary}\n\n` +
      "接下来我是打算开始写代码跑测试，不过如果你想先暂停也可以。\n" +
      "你直接告诉我“继续做/开始”或“先别做/暂停”就行。你也可以随时回复“状态/进度”。"
    )
  }

  private async answerNextQuestion(taskId: string, answer: string): Promise<Task> {
    const task = await this.store.get(taskId)
    if (!task.plan) {
      return task
    }

    const open = openRequiredQuestions(task)
    if (open.length === 0) {
      return task
    }

    const questionId = open[0].id
    const updatedQuestions = task.plan.questions.map((question) => {
      if (question.id !== questionId) {
        return question
      }
      return {
        ...question,
        status: QuestionStatus.ANSWERED,
        answer: answer.trim(),
      }
    })
    task.plan = { ...task.plan, questions: updatedQuestions }
    recordTaskEvent(task, "plan.question.answered", "Plan question answered", {
      id: questionId,
    })
    await this.store.save(task)
    return task
  }

  private extractExplicitTaskText(text: string): string | null {
    const trimmed = text.trim()
    const patterns = [/^需求\s*[:：]\s*/i, /^任务\s*[:：]\s*/i, /^\/task\s+/i, /^\/new\s+/i]
    for (const pattern of patterns) {
      if (pattern.test(trimmed)) {
        return trimmed.replace(pattern, "").trim()
      }
    }
    return null
  }

  private buildDraftPreview(text: string): string {
    const trimmed = text.trim()
    if (trimmed.length <= 280) {
      return trimmed
    }
    return `${trimmed.slice(0, 260)}...`
  }

  private isDraftCancel(text: string): boolean {
    const normalized = text.trim().toLowerCase()
    if (!normalized) {
      return false
    }
    const exact = new Set(["取消", "/cancel", "算了", "不用", "不是", "no", "n", "先别", "暂停"])
    if (exact.has(normalized)) {
      return true
    }
    const patterns = [/先别做/i, /不要做/i, /停一下/i, /先暂停/i]
    return patterns.some((pattern) => pattern.test(normalized))
  }

  private parseExplicitDraftDecision(text: string): { intent: ApprovalIntent } | null {
    const normalized = text.trim().toLowerCase()
    if (!normalized) {
      return null
    }

    const approve = [/^开始$/, /^继续$/, /^好(的)?，?做吧$/, /^就按这个做$/, /^可以开始了?$/, /^go$/]
    if (approve.some((pattern) => pattern.test(normalized))) {
      return { intent: ApprovalIntent.APPROVE }
    }

    const reject = [/^取消$/, /^算了$/, /^不用了?$/, /^先别做$/, /^暂停$/]
    if (reject.some((pattern) => pattern.test(normalized))) {
      return { intent: ApprovalIntent.REJECT }
    }

    return null
  }

  private buildActionableFailureReply(taskId: string, title: string, error: unknown, action: string): string {
    const message = error instanceof Error ? error.message : String(error)
    return `任务 ${taskId} ${title}。\n错误：${message}\n${action}`
  }

  private isStatusQuery(text: string): boolean {
    const normalized = text.trim().toLowerCase()
    if (!normalized) {
      return false
    }
    const exact = new Set(["状态", "进度", "status", "/status", "当前状态", "任务状态"])
    if (exact.has(normalized)) {
      return true
    }
    return /(看|查).*(状态|进度)|status/i.test(normalized)
  }

  private buildTaskStatusReply(task: Task): string {
    const lines = [
      `任务 ${task.taskId} 当前状态：${task.state}`,
      `已尝试次数：${task.execution.attempt}/${task.execution.maxAttempts}`,
    ]

    if (task.state === TaskState.WAIT_APPROVAL) {
      const openQuestions = openRequiredQuestions(task)
      if (openQuestions.length > 0) {
        const nextQuestion = openQuestions[0]
        lines.push(
          `待确认问题（${nextQuestion.id}）：${nextQuestion.question}`,
        )
      }
    }

    if (task.execution.lastError) {
      lines.push(`最近错误：${task.execution.lastError}`)
    }
    lines.push(`下一步建议：${this.nextActionHint(task)}`)
    return lines.join("\n")
  }

  private nextActionHint(task: Task): string {
    if (task.state === TaskState.WAIT_APPROVAL) {
      const openQuestions = openRequiredQuestions(task)
      if (openQuestions.length > 0) {
        return "直接回复上面这个问题的答案；如果不再继续可回复“取消/暂停”。"
      }
      return "回复“开始/继续”批准执行，或回复“取消/暂停”。"
    }
    if (task.state === TaskState.FAILED) {
      return "回复“继续”可触发下一次尝试（若未到最大次数）。"
    }
    if (task.state === TaskState.NEW || task.state === TaskState.CLARIFYING) {
      return "继续澄清需求，确认后进入执行。"
    }
    if (task.state === TaskState.RUNNING || task.state === TaskState.TESTING || task.state === TaskState.AUTO_FIXING) {
      return "任务正在处理中，稍后可再次回复“状态/进度”查看。"
    }
    return "当前无需操作。"
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

  private async findLatestTaskForChatUser(chatId: string, userId: string): Promise<Task | null> {
    const tasks = await this.store.list()
    const candidates = tasks.filter(
      (task) => task.source.chatId === chatId && task.source.userId === userId,
    )
    if (candidates.length === 0) {
      return null
    }
    return candidates.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0] ?? null
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

  private async executeTestSteps(
    task: Task,
    testSteps: PlanStep[],
  ): Promise<Array<Record<string, unknown>>> {
    const results: Array<Record<string, unknown>> = []
    let allPassed = true

    for (const step of testSteps) {
      const command = step.command ?? ""
      const result = await this.opencodeClient.runTest(task, command)
      results.push({
        command: result.command,
        exitCode: result.exitCode,
        logPath: result.logPath,
        durationMs: result.durationMs,
      })
      if (result.exitCode !== 0) {
        allPassed = false
        break // Stop on first failure like original logic
      }
    }

    return results
  }

  private async attemptAutoFix(
    task: Task,
    testResults: Array<Record<string, unknown>>,
  ): Promise<{ success: boolean; error?: string }> {
    if (!task.repo.worktreePath) {
      return { success: false, error: "Task worktree path is missing" }
    }

    // Collect failed test information
    const failedTests = testResults.filter((result) => Number(result.exitCode) !== 0)
    if (failedTests.length === 0) {
      return { success: true } // No failures to fix
    }

    // Read test logs to get detailed error information
    const logPaths = failedTests
      .map((result) => result.logPath)
      .filter((path): path is string => Boolean(path && typeof path === "string"))

    let logContent = ""
    for (const logPath of logPaths) {
      try {
        const content = await readFile(logPath, "utf-8")
        logContent += `\n--- Test Log: ${logPath} ---\n${content}\n--- End Log ---\n`
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        logContent += `\n--- Test Log Unavailable (${logPath}) ---\n${message}\n`
        logContent += `\n--- Raw Test Result ---\n${JSON.stringify(failedTests[0], null, 2)}\n`
      }
    }

    // Read current diff to include in fix prompt
    let diffContent = ""
    if (task.artifacts.diffPath) {
      try {
        diffContent = await readFile(task.artifacts.diffPath, "utf-8")
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        diffContent = `Diff unavailable: ${message}`
      }
    }

    // Build fix prompt
    const fixPrompt = `
您之前生成的计划：
${JSON.stringify(task.plan, null, 2)}

当前代码变更：
${diffContent}

测试失败日志：
${logContent}

原始任务需求：
${task.description}

请基于以上信息分析失败原因，在当前工作目录（${task.repo.worktreePath}）进行必要的代码修改。
只输出修改后的代码文件内容，不要输出其他解释。
`.trim()

    try {
      // First get OpenCode to analyze the failure
      const analysisPrompt = `
Based on the following test failures, analyze the root cause:

Failed tests: ${failedTests.map((item) => item.command).join(", ")}
Test logs: ${logContent}
Current diff: ${diffContent}

Only output the analysis in plain text, no code changes yet.
`
      const analysisResult = await this.opencodeClient.clarify({
        ...task,
        description: analysisPrompt,
      })

      // Then run build to implement fixes based on analysis
      const buildResult = await this.opencodeClient.build({
        ...task,
        description: `Auto-fix for test failures based on analysis: ${analysisResult.summary}`,
      })

      // Update diff and changed files after fix
      task.artifacts.diffPath = buildResult.diffPath
      task.artifacts.changedFiles = buildResult.changedFiles

      // Record the fix attempt
      recordTaskEvent(task, "autofix.attempted", "Auto-fix attempt completed", {
        diffPath: buildResult.diffPath,
        changedFiles: buildResult.changedFiles.length,
      })

      return { success: true }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      recordTaskEvent(task, "autofix.failed", "Auto-fix attempt failed", {
        error: errorMessage,
      })
      return { success: false, error: errorMessage }
    }
  }
}

function safeDirSegment(input: string): string {
  const trimmed = input.trim()
  if (!trimmed) {
    return "repository"
  }
  const safe = trimmed
    .replace(/[\\/]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "")
  return safe || "repository"
}

function defaultWorktreesRoot(repoPath: string, repoName: string): string {
  const normalizedName = repoName.trim() && repoName.trim() !== "repository" ? repoName.trim() : basename(repoPath)
  return join(dirname(repoPath), "agent", safeDirSegment(normalizedName))
}
