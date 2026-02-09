import * as Lark from "@larksuiteoapi/node-sdk"

import { Orchestrator } from "../orchestrator.js"
import { logError, logWarn } from "../logger.js"
import type { FeishuRequirement } from "./feishu.js"
import { FeishuMessenger, planFeishuReply } from "./feishu.js"
import { extractTextMessageContent, normalizeNonTextMessage, readObject } from "./feishu-core.js"
import { ProcessedMessageStore } from "./feishu-webhook.js"

export interface FeishuLongConnSettings {
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
}

export interface FeishuLongConnStartOptions {
  appId: string
  appSecret: string
  encryptKey?: string
  verificationToken?: string
  processor: FeishuLongConnProcessor
  loggerLevel?: number
}

export class FeishuLongConnProcessor {
  constructor(
    private readonly orchestrator: Orchestrator,
    private readonly settings: FeishuLongConnSettings,
    private readonly messenger?: FeishuMessenger,
    private readonly processedStore = new ProcessedMessageStore(),
  ) {}

  async handleMessageEvent(data: Record<string, unknown>): Promise<Record<string, unknown>> {
    const sender = readObject(data.sender)
    const message = readObject(data.message)

    const senderType = String(sender.sender_type ?? "")
    if (senderType === "bot") {
      return { status: "ignored", reason: "bot_sender" }
    }

    const senderId = String(readObject(sender.sender_id).open_id ?? "").trim()
    const chatId = String(message.chat_id ?? "").trim()
    const messageId = String(message.message_id ?? "").trim()
    const messageType = String(message.message_type ?? "").trim()

    if (!senderId || !chatId || !messageId) {
      return { status: "ignored", reason: "missing_identifiers" }
    }

    if (this.settings.allowFrom && this.settings.allowFrom.length > 0) {
      if (!this.settings.allowFrom.includes(senderId)) {
        return { status: "ignored", reason: "sender_not_allowed", userId: senderId }
      }
    }

    if (await this.processedStore.has(messageId)) {
      return { status: "duplicate", messageId }
    }

    const text = this.extractMessageText(messageType, message.content)
    if (!text) {
      return { status: "ignored", reason: "empty_message" }
    }

    const requirement: FeishuRequirement = {
      userId: senderId,
      chatId,
      messageId,
      text,
    }

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
    const replyPlan = planFeishuReply(replyText)
    if (this.settings.sendReply !== false && this.messenger) {
      await this.messenger.sendText(chatId, replyText)
      replySent = true
    }

    await this.processedStore.add(messageId)
    if (!task) {
      return {
        status: "draft",
        replySent,
        replyParts: replyPlan.parts.length,
        replyTruncated: replyPlan.truncated,
      }
    }
    return {
      status: "ok",
      taskId: task.taskId,
      taskState: task.state,
      replySent,
      replyParts: replyPlan.parts.length,
      replyTruncated: replyPlan.truncated,
    }
  }

  private extractMessageText(messageType: string, content: unknown): string {
    if (messageType === "text") {
      try {
        return extractTextMessageContent(content, { fallbackToRawOnInvalidJson: true })
      } catch (error) {
        logWarn("Failed to parse long-connection text content as JSON, fallback to raw text", {
          phase: "longconn.parse",
          error: error instanceof Error ? error.message : String(error),
        })
        return typeof content === "string" ? content.trim() : ""
      }
    }

    return normalizeNonTextMessage(messageType)
  }
}

export async function serveFeishuLongConnection(options: FeishuLongConnStartOptions): Promise<void> {
  const eventDispatcher = new Lark.EventDispatcher({
    encryptKey: options.encryptKey,
    verificationToken: options.verificationToken,
  }).register({
    "im.message.receive_v1": (data: Record<string, unknown>) => {
      void options.processor.handleMessageEvent(data).catch((error) => {
        logError("Feishu long-connection event processing failed", error, { phase: "longconn.event" })
      })
    },
  })

  const wsClient = new Lark.WSClient({
    appId: options.appId,
    appSecret: options.appSecret,
    loggerLevel: options.loggerLevel ?? Lark.LoggerLevel.info,
    autoReconnect: true,
  })

  await wsClient.start({ eventDispatcher })

  await new Promise<void>((resolvePromise) => {
    const shutdown = () => {
      wsClient.close()
      resolvePromise()
    }
    process.once("SIGINT", shutdown)
    process.once("SIGTERM", shutdown)
  })
}
