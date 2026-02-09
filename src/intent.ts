import { createOpencode, createOpencodeClient } from "@opencode-ai/sdk"

import { OpenCodeInvocationError } from "./errors.js"
import { extractFirstJsonObject } from "./json-utils.js"
import { logWarn } from "./logger.js"
import type { Task } from "./models.js"

export const enum ApprovalIntent {
  APPROVE = "approve",
  REJECT = "reject",
  CLARIFY = "clarify",
  UNKNOWN = "unknown",
}

export interface IntentResult {
  intent: ApprovalIntent
  confidence: number
  reason: string
  raw?: Record<string, unknown>
}

export interface IntentClassifier {
  classify(text: string, task?: Task): Promise<IntentResult>
}

export class RuleBasedIntentClassifier implements IntentClassifier {
  private readonly approvePatterns = [
    /^\/approve$/i,
    /\bapprove(d)?\b/i,
    /\bgo\s+ahead\b/i,
    /\blgtm\b/i,
    /同意/i,
    /通过/i,
    /开始吧/i,
    /可以开始/i,
    /开干/i,
    /好，帮我做/i,
    /继续做/i,
    /开始/i,
    /继续/i,
  ]

  private readonly rejectPatterns = [
    /^\/reject$/i,
    /\breject\b/i,
    /\bcancel\b/i,
    /\bdecline\b/i,
    /拒绝/i,
    /取消/i,
    /不同意/i,
    /先别/i,
    /不要/i,
    /停止/i,
  ]

  private readonly clarifyPatterns = [/\?/, /为什么/, /能不能/, /是否/, /请解释/, /再确认/]

  async classify(text: string): Promise<IntentResult> {
    const normalized = text.trim().toLowerCase()
    if (!normalized) {
      return {
        intent: ApprovalIntent.UNKNOWN,
        confidence: 0,
        reason: "empty message",
      }
    }

    if (this.rejectPatterns.some((pattern) => pattern.test(normalized))) {
      return {
        intent: ApprovalIntent.REJECT,
        confidence: 0.95,
        reason: "matched reject rule",
      }
    }

    if (this.approvePatterns.some((pattern) => pattern.test(normalized))) {
      return {
        intent: ApprovalIntent.APPROVE,
        confidence: 0.95,
        reason: "matched approve rule",
      }
    }

    if (this.clarifyPatterns.some((pattern) => pattern.test(normalized))) {
      return {
        intent: ApprovalIntent.CLARIFY,
        confidence: 0.6,
        reason: "matched clarify rule",
      }
    }

    return {
      intent: ApprovalIntent.UNKNOWN,
      confidence: 0.2,
      reason: "no rule matched",
    }
  }
}

export interface OpenCodeIntentOptions {
  agent?: string
  baseUrl?: string
  hostname?: string
  port?: number
  timeoutMs?: number
  workspace?: string
}

export class OpenCodeIntentClassifier implements IntentClassifier {
  constructor(private readonly options: OpenCodeIntentOptions = {}) {}

  async classify(text: string, task?: Task): Promise<IntentResult> {
    const workspace = task?.repo.worktreePath ?? this.options.workspace ?? process.cwd()
    const prompt = this.buildPrompt(text, task)

    let serverClose: (() => void) | undefined
    let disposeInstance: (() => Promise<void>) | undefined
    try {
      const client = this.options.baseUrl
        ? createOpencodeClient({ baseUrl: this.options.baseUrl })
        : await (async () => {
            const started = await createOpencode({
              hostname: this.options.hostname ?? "127.0.0.1",
              port: this.options.port ?? 4096,
              timeout: this.options.timeoutMs ?? 5000,
            })
            serverClose = () => {
              started.server.close()
            }
            disposeInstance = async () => {
              try {
                await started.client.instance.dispose()
              } catch (error) {
                logWarn("Failed to dispose OpenCode client while classifying intent", {
                  phase: "intent.dispose",
                  error: error instanceof Error ? error.message : String(error),
                })
              }
            }
            return started.client
          })()

      const session = await client.session.create({
        body: { title: `intent-${Date.now()}` },
        query: { directory: workspace },
      })
      if (session.error || !session.data?.id) {
        throw new OpenCodeInvocationError(`Failed to create intent session: ${JSON.stringify(session.error)}`)
      }

      const response = await client.session.prompt({
        path: { id: session.data.id },
        query: { directory: workspace },
        body: {
          agent: this.options.agent ?? "plan",
          parts: [{ type: "text", text: prompt }],
        },
      })
      if (response.error || !response.data) {
        throw new OpenCodeInvocationError(`Intent prompt failed: ${JSON.stringify(response.error)}`)
      }

      const textOutput = response.data.parts
        .filter((part) => part.type === "text")
        .map((part) => part.text)
        .join("")
        .trim()

      const parsed = extractFirstJsonObject(textOutput)
      if (!parsed) {
        throw new OpenCodeInvocationError("Intent output did not contain valid JSON")
      }

      const intentRaw = String(parsed.intent ?? "unknown").toLowerCase()
      const intent =
        intentRaw === ApprovalIntent.APPROVE ||
        intentRaw === ApprovalIntent.REJECT ||
        intentRaw === ApprovalIntent.CLARIFY
          ? (intentRaw as ApprovalIntent)
          : ApprovalIntent.UNKNOWN

      const confidence = clamp(Number(parsed.confidence ?? 0.5))
      const reason = typeof parsed.reason === "string" ? parsed.reason : "model-classified"
      return { intent, confidence, reason, raw: parsed }
    } finally {
      if (disposeInstance) {
        await disposeInstance()
      }
      if (serverClose) {
        serverClose()
      }
    }
  }

  private buildPrompt(text: string, task?: Task): string {
    const taskContext = task
      ? `task_id=${task.taskId}\ntask_state=${task.state}\ntask_title=${task.title}\n`
      : ""
    return [
      "Classify the user message intent for approval workflow.",
      "Return strict JSON only.",
      "Allowed intents: approve, reject, clarify, unknown.",
      'Output schema: {"intent":"approve|reject|clarify|unknown","confidence":0.0,"reason":"short reason"}.',
      taskContext,
      `user_message=${text}`,
    ].join("\n")
  }
}

export class HybridIntentClassifier implements IntentClassifier {
  constructor(
    private readonly ruleClassifier: IntentClassifier = new RuleBasedIntentClassifier(),
    private readonly llmClassifier: IntentClassifier | null = null,
    private readonly llmThreshold = 0.8,
  ) {}

  async classify(text: string, task?: Task): Promise<IntentResult> {
    const ruleResult = await this.ruleClassifier.classify(text, task)
    if (ruleResult.intent !== ApprovalIntent.UNKNOWN) {
      return ruleResult
    }
    if (!this.llmClassifier) {
      return ruleResult
    }

    const llmResult = await this.llmClassifier.classify(text, task)
    if (llmResult.confidence >= this.llmThreshold) {
      return llmResult
    }

    return {
      intent: ApprovalIntent.UNKNOWN,
      confidence: Math.max(ruleResult.confidence, llmResult.confidence),
      reason: "llm confidence below threshold",
      raw: llmResult.raw,
    }
  }
}

function clamp(value: number): number {
  if (!Number.isFinite(value)) {
    return 0
  }
  if (value < 0) {
    return 0
  }
  if (value > 1) {
    return 1
  }
  return value
}
