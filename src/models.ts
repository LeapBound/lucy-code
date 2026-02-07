import { randomUUID } from "node:crypto"

export const enum TaskState {
  NEW = "NEW",
  CLARIFYING = "CLARIFYING",
  WAIT_APPROVAL = "WAIT_APPROVAL",
  RUNNING = "RUNNING",
  TESTING = "TESTING",
  DONE = "DONE",
  FAILED = "FAILED",
  CANCELLED = "CANCELLED",
}

export const enum QuestionStatus {
  OPEN = "open",
  ANSWERED = "answered",
}

export const enum StepType {
  CODE = "code",
  TEST = "test",
}

export const enum StepStatus {
  PENDING = "pending",
  RUNNING = "running",
  COMPLETED = "completed",
  FAILED = "failed",
}

export interface PlanQuestion {
  id: string
  question: string
  required: boolean
  status: QuestionStatus
  answer?: string | null
}

export interface PlanStep {
  id: string
  type: StepType
  title: string
  command?: string | null
  status: StepStatus
}

export interface PlanConstraints {
  allowedPaths: string[]
  forbiddenPaths: string[]
  maxFilesChanged: number
}

export interface Plan {
  planId: string
  taskId: string
  version: number
  goal: string
  assumptions: string[]
  constraints: PlanConstraints
  questions: PlanQuestion[]
  steps: PlanStep[]
  approvalGateBeforeRun: boolean
  approvalGateBeforeCommit: boolean
  createdAt: string
  createdBy: string
}

export interface Approval {
  required: boolean
  approvedBy?: string | null
  approvedAt?: string | null
}

export interface ExecutionInfo {
  attempt: number
  maxAttempts: number
  lastError?: string | null
}

export interface TaskArtifacts {
  clarifySummary?: string | null
  diffPath?: string | null
  testReportPath?: string | null
  prUrl?: string | null
  changedFiles: string[]
  testResults: Array<Record<string, unknown>>
}

export interface TaskSource {
  type: string
  userId: string
  chatId: string
  messageId: string
}

export interface RepoContext {
  name: string
  baseBranch: string
  worktreePath?: string | null
  branch?: string | null
}

export interface TaskEvent {
  timestamp: string
  eventType: string
  message: string
  payload: Record<string, unknown>
}

export interface Task {
  taskId: string
  title: string
  description: string
  source: TaskSource
  repo: RepoContext
  state: TaskState
  approval: Approval
  plan?: Plan | null
  execution: ExecutionInfo
  artifacts: TaskArtifacts
  eventLog: TaskEvent[]
  createdAt: string
  updatedAt: string
}

export function utcNowIso(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z")
}

export function createTaskId(): string {
  const stamp = new Date().toISOString().replace(/[-:T.Z]/g, "").slice(0, 14)
  return `task_${stamp}_${randomUUID().slice(0, 6)}`
}

export function defaultPlanConstraints(): PlanConstraints {
  return {
    allowedPaths: ["src/**", "test/**", "README.md"],
    forbiddenPaths: [".git/**", "secrets/**"],
    maxFilesChanged: 20,
  }
}

export function newTask(input: {
  taskId?: string
  title: string
  description: string
  source: TaskSource
  repo: RepoContext
}): Task {
  const now = utcNowIso()
  return {
    taskId: input.taskId ?? createTaskId(),
    title: input.title,
    description: input.description,
    source: input.source,
    repo: input.repo,
    state: TaskState.NEW,
    approval: { required: true, approvedBy: null, approvedAt: null },
    plan: null,
    execution: { attempt: 0, maxAttempts: 3, lastError: null },
    artifacts: {
      clarifySummary: null,
      diffPath: null,
      testReportPath: null,
      prUrl: null,
      changedFiles: [],
      testResults: [],
    },
    eventLog: [],
    createdAt: now,
    updatedAt: now,
  }
}

export function recordTaskEvent(
  task: Task,
  eventType: string,
  message: string,
  payload: Record<string, unknown> = {},
): void {
  task.eventLog.push({
    timestamp: utcNowIso(),
    eventType,
    message,
    payload,
  })
  task.updatedAt = utcNowIso()
}

export function isApproved(task: Task): boolean {
  if (!task.approval.required) {
    return true
  }
  return Boolean(task.approval.approvedBy && task.approval.approvedAt)
}

export function openRequiredQuestions(task: Task): PlanQuestion[] {
  if (!task.plan) {
    return []
  }
  return task.plan.questions.filter(
    (question) => question.required && question.status === QuestionStatus.OPEN,
  )
}

export function parseTask(payload: unknown): Task {
  if (!payload || typeof payload !== "object") {
    throw new Error("Invalid task payload")
  }
  const value = payload as Record<string, unknown>

  const timestamps = (value.timestamps as Record<string, unknown> | undefined) ?? {}
  const createdAt = typeof timestamps.created_at === "string" ? timestamps.created_at : utcNowIso()
  const updatedAt = typeof timestamps.updated_at === "string" ? timestamps.updated_at : utcNowIso()

  const state = typeof value.state === "string" ? (value.state as TaskState) : TaskState.NEW
  const sourceRaw = (value.source as Record<string, unknown> | undefined) ?? {}
  const repoRaw = (value.repo as Record<string, unknown> | undefined) ?? {}
  const approvalRaw = (value.approval as Record<string, unknown> | undefined) ?? {}
  const executionRaw = (value.execution as Record<string, unknown> | undefined) ?? {}
  const artifactsRaw = (value.artifacts as Record<string, unknown> | undefined) ?? {}
  const planRaw = value.plan

  const plan = parsePlan(planRaw)

  const eventLog = Array.isArray(value.event_log)
    ? value.event_log
        .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
        .map((item) => ({
          timestamp: typeof item.timestamp === "string" ? item.timestamp : utcNowIso(),
          eventType: typeof item.event_type === "string" ? item.event_type : "unknown",
          message: typeof item.message === "string" ? item.message : "",
          payload: typeof item.payload === "object" && item.payload ? (item.payload as Record<string, unknown>) : {},
        }))
    : []

  return {
    taskId: String(value.task_id ?? value.taskId ?? createTaskId()),
    title: String(value.title ?? ""),
    description: String(value.description ?? ""),
    source: {
      type: String(sourceRaw.type ?? "unknown"),
      userId: String(sourceRaw.user_id ?? sourceRaw.userId ?? ""),
      chatId: String(sourceRaw.chat_id ?? sourceRaw.chatId ?? ""),
      messageId: String(sourceRaw.message_id ?? sourceRaw.messageId ?? ""),
    },
    repo: {
      name: String(repoRaw.name ?? ""),
      baseBranch: String(repoRaw.base_branch ?? repoRaw.baseBranch ?? "main"),
      worktreePath:
        typeof repoRaw.worktree_path === "string"
          ? repoRaw.worktree_path
          : typeof repoRaw.worktreePath === "string"
            ? repoRaw.worktreePath
            : null,
      branch: typeof repoRaw.branch === "string" ? repoRaw.branch : null,
    },
    state,
    approval: {
      required: approvalRaw.required !== false,
      approvedBy:
        typeof approvalRaw.approved_by === "string"
          ? approvalRaw.approved_by
          : typeof approvalRaw.approvedBy === "string"
            ? approvalRaw.approvedBy
            : null,
      approvedAt:
        typeof approvalRaw.approved_at === "string"
          ? approvalRaw.approved_at
          : typeof approvalRaw.approvedAt === "string"
            ? approvalRaw.approvedAt
            : null,
    },
    plan,
    execution: {
      attempt: Number(executionRaw.attempt ?? 0),
      maxAttempts: Number(executionRaw.max_attempts ?? executionRaw.maxAttempts ?? 3),
      lastError:
        typeof executionRaw.last_error === "string"
          ? executionRaw.last_error
          : typeof executionRaw.lastError === "string"
            ? executionRaw.lastError
            : null,
    },
    artifacts: {
      clarifySummary:
        typeof artifactsRaw.clarify_summary === "string"
          ? artifactsRaw.clarify_summary
          : typeof artifactsRaw.clarifySummary === "string"
            ? artifactsRaw.clarifySummary
            : null,
      diffPath:
        typeof artifactsRaw.diff_path === "string"
          ? artifactsRaw.diff_path
          : typeof artifactsRaw.diffPath === "string"
            ? artifactsRaw.diffPath
            : null,
      testReportPath:
        typeof artifactsRaw.test_report_path === "string"
          ? artifactsRaw.test_report_path
          : typeof artifactsRaw.testReportPath === "string"
            ? artifactsRaw.testReportPath
            : null,
      prUrl:
        typeof artifactsRaw.pr_url === "string"
          ? artifactsRaw.pr_url
          : typeof artifactsRaw.prUrl === "string"
            ? artifactsRaw.prUrl
            : null,
      changedFiles: Array.isArray(artifactsRaw.changed_files)
        ? artifactsRaw.changed_files.map(String)
        : Array.isArray(artifactsRaw.changedFiles)
          ? artifactsRaw.changedFiles.map(String)
          : [],
      testResults: Array.isArray(artifactsRaw.test_results)
        ? artifactsRaw.test_results.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
        : Array.isArray(artifactsRaw.testResults)
          ? artifactsRaw.testResults.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
          : [],
    },
    eventLog,
    createdAt,
    updatedAt,
  }
}

function parsePlan(input: unknown): Plan | null {
  if (!input || typeof input !== "object") {
    return null
  }
  const value = input as Record<string, unknown>
  const constraints = (value.constraints as Record<string, unknown> | undefined) ?? {}
  const approvalGate = (value.approval_gate as Record<string, unknown> | undefined) ?? {}
  const metadata = (value.metadata as Record<string, unknown> | undefined) ?? {}

  const questions = Array.isArray(value.questions)
    ? value.questions
        .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
        .map((item, index) => ({
          id: String(item.id ?? `q${index + 1}`),
          question: String(item.question ?? ""),
          required: item.required !== false,
          status: item.status === QuestionStatus.ANSWERED ? QuestionStatus.ANSWERED : QuestionStatus.OPEN,
          answer: typeof item.answer === "string" ? item.answer : null,
        }))
    : []

  const steps = Array.isArray(value.steps)
    ? value.steps
        .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
        .map((item, index) => ({
          id: String(item.id ?? `s${index + 1}`),
          type: item.type === StepType.TEST ? StepType.TEST : StepType.CODE,
          title: String(item.title ?? `Step ${index + 1}`),
          command: typeof item.command === "string" ? item.command : null,
          status: normalizeStepStatus(item.status),
        }))
    : []

  return {
    planId: String(value.plan_id ?? value.planId ?? ""),
    taskId: String(value.task_id ?? value.taskId ?? ""),
    version: Number(value.version ?? 1),
    goal: String(value.goal ?? ""),
    assumptions: Array.isArray(value.assumptions) ? value.assumptions.map(String) : [],
    constraints: {
      allowedPaths: Array.isArray(constraints.allowed_paths)
        ? constraints.allowed_paths.map(String)
        : [],
      forbiddenPaths: Array.isArray(constraints.forbidden_paths)
        ? constraints.forbidden_paths.map(String)
        : [],
      maxFilesChanged: Number(constraints.max_files_changed ?? 20),
    },
    questions,
    steps,
    approvalGateBeforeRun: approvalGate.required_before_run !== false,
    approvalGateBeforeCommit: approvalGate.required_before_commit !== false,
    createdAt:
      typeof metadata.created_at === "string"
        ? metadata.created_at
        : utcNowIso(),
    createdBy:
      typeof metadata.created_by === "string"
        ? metadata.created_by
        : "orchestrator",
  }
}

function normalizeStepStatus(input: unknown): StepStatus {
  if (input === StepStatus.RUNNING) {
    return StepStatus.RUNNING
  }
  if (input === StepStatus.COMPLETED) {
    return StepStatus.COMPLETED
  }
  if (input === StepStatus.FAILED) {
    return StepStatus.FAILED
  }
  return StepStatus.PENDING
}

export function serializeTask(task: Task): Record<string, unknown> {
  return {
    task_id: task.taskId,
    title: task.title,
    description: task.description,
    source: {
      type: task.source.type,
      user_id: task.source.userId,
      chat_id: task.source.chatId,
      message_id: task.source.messageId,
    },
    repo: {
      name: task.repo.name,
      base_branch: task.repo.baseBranch,
      worktree_path: task.repo.worktreePath ?? null,
      branch: task.repo.branch ?? null,
    },
    state: task.state,
    approval: {
      required: task.approval.required,
      approved_by: task.approval.approvedBy ?? null,
      approved_at: task.approval.approvedAt ?? null,
    },
    plan: task.plan
      ? {
          plan_id: task.plan.planId,
          task_id: task.plan.taskId,
          version: task.plan.version,
          goal: task.plan.goal,
          assumptions: task.plan.assumptions,
          constraints: {
            allowed_paths: task.plan.constraints.allowedPaths,
            forbidden_paths: task.plan.constraints.forbiddenPaths,
            max_files_changed: task.plan.constraints.maxFilesChanged,
          },
          questions: task.plan.questions.map((question) => ({
            id: question.id,
            question: question.question,
            required: question.required,
            status: question.status,
            answer: question.answer ?? null,
          })),
          steps: task.plan.steps.map((step) => ({
            id: step.id,
            type: step.type,
            title: step.title,
            command: step.command ?? null,
            status: step.status,
          })),
          approval_gate: {
            required_before_run: task.plan.approvalGateBeforeRun,
            required_before_commit: task.plan.approvalGateBeforeCommit,
          },
          metadata: {
            created_at: task.plan.createdAt,
            created_by: task.plan.createdBy,
          },
        }
      : null,
    execution: {
      attempt: task.execution.attempt,
      max_attempts: task.execution.maxAttempts,
      last_error: task.execution.lastError ?? null,
    },
    artifacts: {
      clarify_summary: task.artifacts.clarifySummary ?? null,
      diff_path: task.artifacts.diffPath ?? null,
      test_report_path: task.artifacts.testReportPath ?? null,
      pr_url: task.artifacts.prUrl ?? null,
      changed_files: task.artifacts.changedFiles,
      test_results: task.artifacts.testResults,
    },
    event_log: task.eventLog.map((event) => ({
      timestamp: event.timestamp,
      event_type: event.eventType,
      message: event.message,
      payload: event.payload,
    })),
    timestamps: {
      created_at: task.createdAt,
      updated_at: task.updatedAt,
    },
  }
}
