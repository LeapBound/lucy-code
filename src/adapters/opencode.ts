import { exec as execCallback, spawnSync } from "node:child_process"
import { mkdirSync } from "node:fs"
import { writeFile } from "node:fs/promises"
import { resolve } from "node:path"
import { promisify } from "node:util"

import { OpenCodeInvocationError } from "../errors.js"
import {
  defaultPlanConstraints,
  QuestionStatus,
  StepStatus,
  StepType,
  type Plan,
  type PlanQuestion,
  type PlanStep,
  type Task,
  utcNowIso,
} from "../models.js"

const exec = promisify(execCallback)

export interface ClarifyResult {
  summary: string
  plan: Plan
  usage: Record<string, number>
  rawText: string
}

export interface BuildExecutionResult {
  changedFiles: string[]
  diffPath: string
  outputText: string
  usage: Record<string, number>
}

export interface TestExecutionResult {
  command: string
  exitCode: number
  logPath: string
  durationMs: number
}

export interface OpenCodeRunResult {
  agent: string
  returnCode: number
  events: Array<Record<string, unknown>>
  text: string
  usage: Record<string, number>
  stderr: string
  error?: string
}

export interface OpenCodeClient {
  clarify(task: Task): Promise<ClarifyResult>
  build(task: Task): Promise<BuildExecutionResult>
  runTest(task: Task, command: string): Promise<TestExecutionResult>
}

export interface OpenCodeRuntimeOptions {
  artifactRoot?: string
  driver?: "sdk" | "cli"
  command?: string
  useDocker?: boolean
  dockerImage?: string
  workspace?: string
  timeoutSec?: number
  planAgent?: string
  buildAgent?: string
  sdkBaseUrl?: string
  sdkHostname?: string
  sdkPort?: number
  sdkTimeoutMs?: number
  nodeCommand?: string
  sdkScript?: string
}

export class OpenCodeRuntimeClient implements OpenCodeClient {
  private readonly artifactRoot: string
  private readonly driver: "sdk" | "cli"
  private readonly command: string
  private readonly useDocker: boolean
  private readonly dockerImage: string
  private readonly workspace?: string
  private readonly timeoutSec: number
  private readonly planAgent: string
  private readonly buildAgent: string
  private readonly sdkBaseUrl?: string
  private readonly sdkHostname: string
  private readonly sdkPort: number
  private readonly sdkTimeoutMs: number
  private readonly nodeCommand: string
  private readonly sdkScript: string

  constructor(options: OpenCodeRuntimeOptions = {}) {
    this.artifactRoot = resolve(options.artifactRoot ?? ".orchestrator/artifacts")
    mkdirSync(this.artifactRoot, { recursive: true })
    this.driver = options.driver ?? "sdk"
    this.command = options.command ?? "opencode"
    this.useDocker = options.useDocker ?? false
    this.dockerImage = options.dockerImage ?? "nanobot-opencode"
    this.workspace = options.workspace ? resolve(options.workspace) : undefined
    this.timeoutSec = options.timeoutSec ?? 900
    this.planAgent = options.planAgent ?? "plan"
    this.buildAgent = options.buildAgent ?? "build"
    this.sdkBaseUrl = options.sdkBaseUrl
    this.sdkHostname = options.sdkHostname ?? "127.0.0.1"
    this.sdkPort = options.sdkPort ?? 0
    this.sdkTimeoutMs = options.sdkTimeoutMs ?? 5000
    this.nodeCommand = options.nodeCommand ?? "node"
    this.sdkScript = resolve(options.sdkScript ?? "scripts/opencode_sdk_bridge.mjs")
  }

  async clarify(task: Task): Promise<ClarifyResult> {
    const result = await this.runAgent({
      agent: this.planAgent,
      prompt: this.buildPlanPrompt(task),
      taskId: task.taskId,
      workspace: this.resolveWorkspace(task),
    })
    if (result.error) {
      throw new OpenCodeInvocationError(result.error)
    }

    const payload = this.extractJsonObject(result.text) ?? this.extractJsonFromEvents(result.events)
    if (!payload) {
      return {
        summary: result.text || "Clarification completed",
        plan: this.planFromPayload({}, task),
        usage: result.usage,
        rawText: result.text,
      }
    }

    const { summary, planPayload } = this.extractSummaryAndPlan(payload)
    const plan = this.planFromPayload(planPayload, task)
    return {
      summary,
      plan,
      usage: result.usage,
      rawText: result.text,
    }
  }

  async build(task: Task): Promise<BuildExecutionResult> {
    const workspace = this.resolveWorkspace(task)
    const result = await this.runAgent({
      agent: this.buildAgent,
      prompt: this.buildBuildPrompt(task),
      taskId: task.taskId,
      workspace,
    })
    if (result.error) {
      throw new OpenCodeInvocationError(result.error)
    }

    const changedFiles = await this.collectChangedFiles(workspace)
    const diffPath = await this.writeDiffArtifact(task.taskId, workspace)
    return {
      changedFiles,
      diffPath,
      outputText: result.text,
      usage: result.usage,
    }
  }

  async runTest(task: Task, command: string): Promise<TestExecutionResult> {
    const workspace = this.resolveWorkspace(task)
    const startedAt = Date.now()

    let finalCommand = command
    if (this.useDocker) {
      finalCommand = [
        "docker",
        "run",
        "--rm",
        "-v",
        `${workspace}:/workspace`,
        "-w",
        "/workspace",
        this.dockerImage,
        "/bin/sh",
        "-lc",
        command,
      ].join(" ")
    }

    let exitCode = 1
    let stdout = ""
    let stderr = ""

    try {
      const output = await exec(finalCommand, {
        cwd: workspace,
        timeout: this.timeoutSec * 1000,
        maxBuffer: 10 * 1024 * 1024,
      })
      exitCode = 0
      stdout = output.stdout
      stderr = output.stderr
    } catch (error) {
      const details = error as { code?: number; stdout?: string; stderr?: string; message?: string; killed?: boolean }
      exitCode = typeof details.code === "number" ? details.code : details.killed ? 124 : 1
      stdout = details.stdout ?? ""
      stderr = details.stderr ?? details.message ?? ""
    }

    const durationMs = Date.now() - startedAt
    const logPath = resolve(this.artifactRoot, `${task.taskId}_test.log`)
    await this.writeJson(logPath, {
      taskId: task.taskId,
      workspace,
      command,
      exitCode,
      durationMs,
      stdout,
      stderr,
    })

    return {
      command,
      exitCode,
      logPath,
      durationMs,
    }
  }

  private async runAgent(params: {
    agent: string
    prompt: string
    taskId: string
    workspace: string
  }): Promise<OpenCodeRunResult> {
    if (this.driver === "sdk" && !this.useDocker) {
      return this.runAgentWithSdk(params)
    }
    return this.runAgentWithCli(params)
  }

  private async runAgentWithSdk(params: {
    agent: string
    prompt: string
    taskId: string
    workspace: string
  }): Promise<OpenCodeRunResult> {
    const command = [this.nodeCommand, this.sdkScript]
    const payload = {
      agent: params.agent,
      prompt: params.prompt,
      workspace: params.workspace,
      sessionTitle: `lucy-${params.taskId}-${params.agent}`,
      baseUrl: this.sdkBaseUrl,
      hostname: this.sdkHostname,
      port: this.sdkPort,
      timeoutMs: this.sdkTimeoutMs,
    }

    try {
      const result = spawnSync(command[0], command.slice(1), {
        cwd: params.workspace,
        input: JSON.stringify(payload),
        encoding: "utf-8",
        timeout: this.timeoutSec * 1000,
      })

      if (result.error) {
        return {
          agent: params.agent,
          returnCode: result.status ?? 1,
          events: [],
          text: "",
          usage: {},
          stderr: result.error.message,
          error: `OpenCode SDK bridge failed: ${result.error.message}`,
        }
      }

      const stdout = result.stdout ?? ""
      const stderr = result.stderr ?? ""
      const parsed = this.extractJsonObject(stdout)
      if (!parsed || parsed.ok !== true) {
        const message =
          (parsed && typeof parsed.error === "string" ? parsed.error : "OpenCode SDK bridge returned failure") +
          (parsed && typeof parsed.details === "string" ? `: ${parsed.details}` : "")
        return {
          agent: params.agent,
          returnCode: result.status ?? 1,
          events: [],
          text: "",
          usage: {},
          stderr,
          error: message,
        }
      }

      const parts = Array.isArray(parsed.parts)
        ? parsed.parts.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
        : []
      const events = parts.map((part) => ({ type: part.type, part }))
      const usage = readObject(parsed, "usage")

      const runResult: OpenCodeRunResult = {
        agent: params.agent,
        returnCode: 0,
        events,
        text: typeof parsed.text === "string" ? parsed.text : this.extractTextFromEvents(events),
        usage: {
          prompt_tokens: toInt(usage.prompt_tokens),
          completion_tokens: toInt(usage.completion_tokens),
          total_tokens: toInt(usage.total_tokens),
        },
        stderr,
      }
      await this.writeAgentLog(params.taskId, command, params.workspace, runResult, stdout)
      return runResult
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return {
        agent: params.agent,
        returnCode: 1,
        events: [],
        text: "",
        usage: {},
        stderr: message,
        error: `OpenCode SDK execution failed: ${message}`,
      }
    }
  }

  private async runAgentWithCli(params: {
    agent: string
    prompt: string
    taskId: string
    workspace: string
  }): Promise<OpenCodeRunResult> {
    const opencodeCommand = [
      this.command,
      "run",
      "--agent",
      params.agent,
      "--format",
      "json",
      params.prompt,
    ]
    const command = this.useDocker
      ? [
          "docker",
          "run",
          "--rm",
          "-v",
          `${params.workspace}:/workspace`,
          "-w",
          "/workspace",
          this.dockerImage,
          ...opencodeCommand,
        ]
      : opencodeCommand

    const result = spawnSync(command[0], command.slice(1), {
      cwd: this.useDocker ? undefined : params.workspace,
      encoding: "utf-8",
      timeout: this.timeoutSec * 1000,
    })

    const stdout = result.stdout ?? ""
    const stderr = result.stderr ?? ""
    const events = this.parseJsonlEvents(stdout)
    const text = this.extractTextFromEvents(events)
    const usage = this.extractUsageFromCliEvents(events)
    const error = result.status === 0 ? undefined : this.extractErrorText(events, stderr)

    const runResult: OpenCodeRunResult = {
      agent: params.agent,
      returnCode: result.status ?? 1,
      events,
      text,
      usage,
      stderr,
      error,
    }
    await this.writeAgentLog(params.taskId, command, params.workspace, runResult, stdout)
    return runResult
  }

  private parseJsonlEvents(rawStdout: string): Array<Record<string, unknown>> {
    const events: Array<Record<string, unknown>> = []
    for (const line of rawStdout.split(/\r?\n/)) {
      const value = line.trim()
      if (!value) {
        continue
      }
      try {
        const parsed = JSON.parse(value)
        if (parsed && typeof parsed === "object") {
          events.push(parsed as Record<string, unknown>)
        }
      } catch {
        continue
      }
    }
    return events
  }

  private extractTextFromEvents(events: Array<Record<string, unknown>>): string {
    const chunks: string[] = []
    for (const event of events) {
      if (event.type !== "text") {
        continue
      }
      const part = readObject(event, "part")
      if (typeof part.text === "string") {
        chunks.push(part.text)
      }
    }
    if (chunks.length > 0) {
      return chunks.join("").trim()
    }

    const keys = ["final_output", "output", "content", "text", "message"]
    for (const event of [...events].reverse()) {
      for (const key of keys) {
        const value = event[key]
        if (typeof value === "string" && value.trim()) {
          return value.trim()
        }
      }
    }
    return ""
  }

  private extractUsageFromCliEvents(events: Array<Record<string, unknown>>): Record<string, number> {
    let promptTokens = 0
    let completionTokens = 0
    let totalTokens = 0
    let found = false

    for (const event of events) {
      const part = readObject(event, "part")
      const tokens = readObject(part, "tokens")
      if (Object.keys(tokens).length === 0) {
        continue
      }
      found = true
      const prompt = toInt(tokens.input_tokens ?? tokens.prompt_tokens ?? tokens.input)
      const completion = toInt(tokens.output_tokens ?? tokens.completion_tokens ?? tokens.output)
      const total = toInt(tokens.total_tokens ?? tokens.total)

      promptTokens += prompt
      completionTokens += completion
      totalTokens += total || prompt + completion
    }

    if (!found) {
      return {}
    }

    return {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: totalTokens,
    }
  }

  private extractErrorText(events: Array<Record<string, unknown>>, stderr: string): string {
    for (const event of [...events].reverse()) {
      const eventType = String(event.type ?? "")
      if (["error", "fatal", "step_error"].includes(eventType)) {
        const message = this.extractErrorMessage(event)
        if (message) {
          return message
        }
      }

      if (event.is_error === true) {
        const message = this.extractErrorMessage(event)
        if (message) {
          return message
        }
      }
    }

    const lines = stderr
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
    return lines.at(-1) ?? "OpenCode execution failed"
  }

  private extractErrorMessage(event: Record<string, unknown>): string {
    if (typeof event.error === "string") {
      return event.error
    }
    const error = readObject(event, "error")
    if (typeof error.message === "string") {
      return error.message
    }

    const part = readObject(event, "part")
    if (typeof part.error === "string") {
      return part.error
    }
    if (typeof part.message === "string") {
      return part.message
    }
    return ""
  }

  private buildPlanPrompt(task: Task): string {
    const request = task.description.trim() || task.title.trim()
    return [
      "You are the plan agent for a coding orchestrator.",
      "Return STRICT JSON only, no markdown.",
      "Top-level: {\"summary\":\"...\",\"plan\":{...}}",
      "Plan must include constraints.allowed_paths, questions, and steps with code+test.",
      `task_id=${task.taskId}`,
      `base_branch=${task.repo.baseBranch}`,
      `request=${request}`,
    ].join("\n")
  }

  private buildBuildPrompt(task: Task): string {
    return [
      "Execute implementation according to approved plan.",
      "Return concise execution notes as plain text.",
      `task_id=${task.taskId}`,
      `request=${task.description || task.title}`,
      `plan=${JSON.stringify(task.plan ?? {})}`,
    ].join("\n")
  }

  private resolveWorkspace(task: Task): string {
    const workspace = task.repo.worktreePath ?? this.workspace
    if (!workspace) {
      throw new OpenCodeInvocationError("Workspace is required")
    }
    return resolve(workspace)
  }

  private extractSummaryAndPlan(payload: Record<string, unknown>): {
    summary: string
    planPayload: Record<string, unknown>
  } {
    const summary = typeof payload.summary === "string" ? payload.summary : "Plan generated by OpenCode"
    const planPayload = payload.plan && typeof payload.plan === "object" ? (payload.plan as Record<string, unknown>) : payload
    return { summary, planPayload }
  }

  private planFromPayload(payload: Record<string, unknown>, task: Task): Plan {
    const constraints = readObject(payload, "constraints")
    const allowedPaths = Array.isArray(constraints.allowed_paths)
      ? constraints.allowed_paths.map(String)
      : defaultPlanConstraints().allowedPaths
    const forbiddenPaths = Array.isArray(constraints.forbidden_paths)
      ? constraints.forbidden_paths.map(String)
      : defaultPlanConstraints().forbiddenPaths
    const maxFilesChanged = toInt(constraints.max_files_changed) || defaultPlanConstraints().maxFilesChanged

    const normalizedSteps = this.normalizeSteps(payload.steps)
    const normalizedQuestions = this.normalizeQuestions(payload.questions)

    const approvalGate = readObject(payload, "approval_gate")
    const metadata = readObject(payload, "metadata")

    return {
      planId: String(payload.plan_id ?? `plan_${task.taskId}_v1`),
      taskId: String(payload.task_id ?? task.taskId),
      version: toInt(payload.version) || 1,
      goal: String(payload.goal ?? task.description ?? task.title),
      assumptions: Array.isArray(payload.assumptions) ? payload.assumptions.map(String) : [],
      constraints: {
        allowedPaths,
        forbiddenPaths,
        maxFilesChanged,
      },
      questions: normalizedQuestions,
      steps: normalizedSteps,
      approvalGateBeforeRun: approvalGate.required_before_run !== false,
      approvalGateBeforeCommit: approvalGate.required_before_commit !== false,
      createdAt: typeof metadata.created_at === "string" ? metadata.created_at : utcNowIso(),
      createdBy: typeof metadata.created_by === "string" ? metadata.created_by : "opencode-plan-agent",
    }
  }

  private normalizeQuestions(input: unknown): PlanQuestion[] {
    if (!Array.isArray(input)) {
      return []
    }
    return input
      .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
      .map((item, index) => ({
        id: String(item.id ?? `q${index + 1}`),
        question: String(item.question ?? ""),
        required: item.required !== false,
        status: item.status === QuestionStatus.ANSWERED ? QuestionStatus.ANSWERED : QuestionStatus.OPEN,
        answer: typeof item.answer === "string" ? item.answer : null,
      }))
  }

  private normalizeSteps(input: unknown): PlanStep[] {
    if (!Array.isArray(input)) {
      return [
        { id: "s1", type: StepType.CODE, title: "Implement changes", status: StepStatus.PENDING, command: null },
        { id: "s2", type: StepType.TEST, title: "Run tests", status: StepStatus.PENDING, command: "npm test" },
      ]
    }

    const steps: PlanStep[] = input
      .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
      .map((item, index) => {
        const type = item.type === StepType.TEST ? StepType.TEST : StepType.CODE
        const status =
          item.status === StepStatus.RUNNING
            ? StepStatus.RUNNING
            : item.status === StepStatus.COMPLETED
              ? StepStatus.COMPLETED
              : item.status === StepStatus.FAILED
                ? StepStatus.FAILED
                : StepStatus.PENDING
        const command = typeof item.command === "string" ? item.command : type === StepType.TEST ? "npm test" : null
        return {
          id: String(item.id ?? `s${index + 1}`),
          type,
          title: String(item.title ?? `Step ${index + 1}`),
          command,
          status,
        }
      })

    if (!steps.some((step) => step.type === StepType.CODE)) {
      steps.unshift({
        id: "s_code",
        type: StepType.CODE,
        title: "Implement changes",
        command: null,
        status: StepStatus.PENDING,
      })
    }
    if (!steps.some((step) => step.type === StepType.TEST)) {
      steps.push({
        id: "s_test",
        type: StepType.TEST,
        title: "Run tests",
        command: "npm test",
        status: StepStatus.PENDING,
      })
    }

    return steps
  }

  private extractJsonObject(text: string): Record<string, unknown> | null {
    const candidate = text.trim()
    if (!candidate) {
      return null
    }
    try {
      const parsed = JSON.parse(candidate)
      return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null
    } catch {
      // continue
    }

    const match = candidate.match(/\{[\s\S]*\}/)
    if (!match) {
      return null
    }
    try {
      const parsed = JSON.parse(match[0])
      return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null
    } catch {
      return null
    }
  }

  private extractJsonFromEvents(events: Array<Record<string, unknown>>): Record<string, unknown> | null {
    for (const event of [...events].reverse()) {
      for (const key of ["output", "text", "message", "content"]) {
        const value = event[key]
        if (typeof value !== "string") {
          continue
        }
        const parsed = this.extractJsonObject(value)
        if (parsed) {
          return parsed
        }
      }
      const part = readObject(event, "part")
      for (const key of ["text", "content", "message"]) {
        const value = part[key]
        if (typeof value !== "string") {
          continue
        }
        const parsed = this.extractJsonObject(value)
        if (parsed) {
          return parsed
        }
      }
    }
    return null
  }

  private async collectChangedFiles(workspace: string): Promise<string[]> {
    const output = await this.runGit(["git", "status", "--porcelain"], workspace, "Failed to read git status")
    const changedFiles = new Set<string>()
    for (const line of output.split(/\r?\n/)) {
      if (line.length < 4) {
        continue
      }
      let entry = line.slice(3).trim()
      if (entry.includes(" -> ")) {
        entry = entry.split(" -> ")[1] ?? entry
      }
      if (entry) {
        changedFiles.add(entry)
      }
    }
    return [...changedFiles].sort()
  }

  private async writeDiffArtifact(taskId: string, workspace: string): Promise<string> {
    const [unstaged, staged, status] = await Promise.all([
      this.runGit(["git", "diff"], workspace, "Failed to collect unstaged diff"),
      this.runGit(["git", "diff", "--cached"], workspace, "Failed to collect staged diff"),
      this.runGit(["git", "status", "--short"], workspace, "Failed to collect status summary"),
    ])

    const parts: string[] = []
    if (unstaged) {
      parts.push("# Unstaged Diff\n")
      parts.push(unstaged)
    }
    if (staged) {
      parts.push("# Staged Diff\n")
      parts.push(staged)
    }
    if (status) {
      parts.push("# Working Tree Status\n")
      parts.push(status)
    }
    if (parts.length === 0) {
      parts.push("# No git diff/status output produced")
    }

    const filePath = resolve(this.artifactRoot, `${taskId}.diff`)
    await writeFile(filePath, `${parts.join("\n\n")}\n`, "utf-8")
    return filePath
  }

  private async runGit(command: string[], workspace: string, failureMessage: string): Promise<string> {
    const [executable, ...args] = command
    const result = spawnSync(executable, args, {
      cwd: workspace,
      encoding: "utf-8",
      timeout: this.timeoutSec * 1000,
    })
    if (result.status !== 0) {
      const detail = result.stderr?.trim() || result.stdout?.trim() || "unknown error"
      throw new OpenCodeInvocationError(`${failureMessage}: ${detail}`)
    }
    return (result.stdout ?? "").trim()
  }

  private async writeAgentLog(
    taskId: string,
    command: string[],
    workspace: string,
    runResult: OpenCodeRunResult,
    stdout: string,
  ): Promise<void> {
    const logPath = resolve(this.artifactRoot, `${taskId}_${runResult.agent}.json`)
    await this.writeJson(logPath, {
      taskId,
      agent: runResult.agent,
      timestamp: utcNowIso(),
      workspace,
      command,
      returnCode: runResult.returnCode,
      usage: runResult.usage,
      error: runResult.error ?? null,
      text: runResult.text,
      events: runResult.events,
      stdout,
      stderr: runResult.stderr,
    })
  }

  private async writeJson(filePath: string, payload: Record<string, unknown>): Promise<void> {
    await writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf-8")
  }
}

function readObject(input: unknown, key: string): Record<string, unknown> {
  if (!input || typeof input !== "object") {
    return {}
  }
  const value = (input as Record<string, unknown>)[key]
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {}
}

function toInt(value: unknown): number {
  const converted = Number(value)
  return Number.isFinite(converted) ? Math.trunc(converted) : 0
}
