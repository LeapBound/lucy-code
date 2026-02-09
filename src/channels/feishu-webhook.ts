import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"

import { errorCodeOf, OrchestratorError } from "../errors.js"
import { logError, logWarn } from "../logger.js"
import { Orchestrator } from "../orchestrator.js"
import { readObject } from "./feishu-core.js"
import { FeishuMessenger, parseRequirementEvent } from "./feishu.js"

export interface FeishuWebhookSettings {
  repoName: string
  baseBranch?: string
  worktreePath?: string
  autoClarify?: boolean
  autoRunOnApprove?: boolean
  autoProvisionWorktree?: boolean
  repoPath?: string
  worktreesRoot?: string
  branchPrefix?: string
  sendReply?: boolean
  allowFrom?: string[]
  verificationToken?: string
}

export class ProcessedMessageStore {
  private readonly filePath: string
  private seen = new Set<string>()
  private loaded = false
  private writeChain: Promise<void> = Promise.resolve()

  constructor(filePath = ".orchestrator/feishu_seen_messages.json") {
    this.filePath = resolve(filePath)
  }

  async has(messageId: string): Promise<boolean> {
    await this.load()
    return this.seen.has(messageId)
  }

  async add(messageId: string): Promise<void> {
    await this.withWriteLock(async () => {
      await this.load()
      if (this.seen.has(messageId)) {
        return
      }
      this.seen.add(messageId)
      await this.persist()
    })
  }

  private async load(): Promise<void> {
    if (this.loaded) {
      return
    }
    this.loaded = true

    try {
      const raw = await readFile(this.filePath, "utf-8")
      try {
        const payload = JSON.parse(raw)
        if (Array.isArray(payload)) {
          this.seen = new Set(payload.map(String))
          return
        }
        logWarn("Processed message store payload is not an array, starting with empty cache", {
          phase: "webhook.processed-store.load",
          filePath: this.filePath,
        })
      } catch (error) {
        logWarn("Failed to parse processed message store JSON, starting with empty cache", {
          phase: "webhook.processed-store.parse",
          filePath: this.filePath,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return
      }
      logWarn("Failed to read processed message store, starting with empty cache", {
        phase: "webhook.processed-store.read",
        filePath: this.filePath,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  private async persist(): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true })
    const tempPath = `${this.filePath}.tmp-${process.pid}-${Date.now()}`
    await writeFile(tempPath, `${JSON.stringify([...this.seen].sort(), null, 2)}\n`, "utf-8")
    await rename(tempPath, this.filePath)
  }

  private async withWriteLock<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.writeChain.then(operation, operation)
    this.writeChain = run.then(() => undefined, () => undefined)
    return run
  }
}

export class FeishuWebhookProcessor {
  constructor(
    private readonly orchestrator: Orchestrator,
    private readonly settings: FeishuWebhookSettings,
    private readonly messenger?: FeishuMessenger,
    private readonly processedStore = new ProcessedMessageStore(),
  ) {}

  async validateToken(payload: Record<string, unknown>): Promise<boolean> {
    if (!this.settings.verificationToken) {
      return true
    }
    const token =
      typeof payload.token === "string"
        ? payload.token
        : typeof readObject(payload.header).token === "string"
          ? (readObject(payload.header).token as string)
          : ""
    return token === this.settings.verificationToken
  }

  async processPayload(payload: Record<string, unknown>): Promise<{ statusCode: number; payload: Record<string, unknown> }> {
    const type = typeof payload.type === "string" ? payload.type : ""
    if (type === "url_verification") {
      const challenge = String(payload.challenge ?? "")
      if (!challenge) {
        return { statusCode: 400, payload: { error: "missing challenge" } }
      }
      return { statusCode: 200, payload: { challenge } }
    }

    const eventType = String(readObject(payload.header).event_type ?? "")
    if (eventType && eventType !== "im.message.receive_v1") {
      return {
        statusCode: 200,
        payload: { status: "ignored", reason: `unsupported_event_type:${eventType}` },
      }
    }

    let requirement
    try {
      requirement = parseRequirementEvent(payload)
    } catch (error) {
      logWarn("Failed to parse Feishu webhook requirement payload", {
        phase: "webhook.parse-requirement",
        error: error instanceof Error ? error.message : String(error),
      })
      return {
        statusCode: 400,
        payload: { error: error instanceof Error ? error.message : String(error) },
      }
    }

    if (this.settings.allowFrom && this.settings.allowFrom.length > 0) {
      if (!this.settings.allowFrom.includes(requirement.userId)) {
        return {
          statusCode: 200,
          payload: {
            status: "ignored",
            reason: "sender_not_allowed",
            userId: requirement.userId,
          },
        }
      }
    }

    if (await this.processedStore.has(requirement.messageId)) {
      return {
        statusCode: 200,
        payload: { status: "duplicate", messageId: requirement.messageId },
      }
    }

    try {
      const { task, replyText } = await this.orchestrator.processFeishuMessage({
        requirement,
        repoName: this.settings.repoName,
        baseBranch: this.settings.baseBranch,
        worktreePath: this.settings.worktreePath,
        autoClarify: this.settings.autoClarify,
        autoRunOnApprove: this.settings.autoRunOnApprove,
        autoProvisionWorktree: this.settings.autoProvisionWorktree,
        repoPath: this.settings.repoPath,
        worktreesRoot: this.settings.worktreesRoot,
        branchPrefix: this.settings.branchPrefix,
      })

      let replySent = false
      if (this.settings.sendReply !== false && this.messenger) {
        await this.messenger.sendText(requirement.chatId, replyText)
        replySent = true
      }

      await this.processedStore.add(requirement.messageId)
      if (!task) {
        return {
          statusCode: 200,
          payload: {
            status: "draft",
            replySent,
          },
        }
      }

      return {
        statusCode: 200,
        payload: {
          status: "ok",
          taskId: task.taskId,
          taskState: task.state,
          replySent,
        },
      }
    } catch (error) {
      logError("Feishu webhook payload processing failed", error, { phase: "webhook.process-payload" })
      return {
        statusCode: 500,
        payload: {
          status: "error",
          error: error instanceof Error ? error.message : String(error),
          errorCode: errorCodeOf(error),
        },
      }
    }
  }
}

export function serveFeishuWebhook(
  processor: FeishuWebhookProcessor,
  options: {
    host?: string
    port?: number
  } = {},
): Promise<void> {
  const host = options.host ?? "0.0.0.0"
  const port = options.port ?? 18791

  const server = createServer(async (request, response) => {
    try {
      await handleRequest(processor, request, response)
    } catch (error) {
      logError("Unhandled Feishu webhook request failure", error, { phase: "webhook.serve-request" })
      json(response, 500, {
        error: error instanceof Error ? error.message : String(error),
        errorCode: errorCodeOf(error),
      })
    }
  })

  return new Promise((resolvePromise, rejectPromise) => {
    server.on("error", rejectPromise)
    server.listen(port, host, () => resolvePromise())
  })
}

async function handleRequest(
  processor: FeishuWebhookProcessor,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  if (request.method === "GET" && request.url === "/health") {
    json(response, 200, { status: "ok" })
    return
  }

  if (request.method !== "POST") {
    json(response, 404, { error: "not_found" })
    return
  }

  const body = await readBody(request)
  let payload: Record<string, unknown>
  try {
    const parsed = JSON.parse(body)
    if (!parsed || typeof parsed !== "object") {
      throw new OrchestratorError("payload must be object")
    }
    payload = parsed as Record<string, unknown>
  } catch (error) {
    logWarn("Invalid JSON in Feishu webhook request body", {
      phase: "webhook.parse-body",
      error: error instanceof Error ? error.message : String(error),
    })
    json(response, 400, { error: "invalid json" })
    return
  }

  const valid = await processor.validateToken(payload)
  if (!valid) {
    json(response, 403, { error: "invalid verification token" })
    return
  }

  const result = await processor.processPayload(payload)
  json(response, result.statusCode, result.payload)
}

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolvePromise, rejectPromise) => {
    const chunks: Buffer[] = []
    request.on("data", (chunk) => chunks.push(Buffer.from(chunk)))
    request.on("end", () => resolvePromise(Buffer.concat(chunks).toString("utf-8")))
    request.on("error", rejectPromise)
  })
}

function json(response: ServerResponse, statusCode: number, payload: Record<string, unknown>): void {
  const body = JSON.stringify(payload)
  response.statusCode = statusCode
  response.setHeader("content-type", "application/json; charset=utf-8")
  response.end(body)
}
