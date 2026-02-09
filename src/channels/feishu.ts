import { readFile } from "node:fs/promises"
import { resolve } from "node:path"

import { OrchestratorError } from "../errors.js"
import { requestJsonObject } from "../http.js"
import { tryParseJsonObject } from "../json-utils.js"
import { extractTextMessageContent, readObject } from "./feishu-core.js"

export interface FeishuRequirement {
  userId: string
  chatId: string
  messageId: string
  text: string
}

export interface FeishuAppCredentials {
  appId: string
  appSecret: string
  enabled: boolean
}

export interface FeishuReplyPlan {
  parts: string[]
  truncated: boolean
}

const MAX_FEISHU_MESSAGE_CHARS = 4000
const MAX_FEISHU_MESSAGE_PARTS = 5

export async function loadFeishuCredentialsFromNanobot(
  configPath = "~/.nanobot/config.json",
): Promise<FeishuAppCredentials> {
  const absolutePath = resolve(configPath.replace(/^~(?=\/)/, process.env.HOME ?? "~"))
  let raw = ""
  try {
    raw = await readFile(absolutePath, "utf-8")
  } catch (error) {
    throw new OrchestratorError(`Nanobot config file not found: ${absolutePath}. ${String(error)}`)
  }

  let payload: unknown
  payload = tryParseJsonObject(raw)
  if (!payload) {
    throw new OrchestratorError(`Invalid Nanobot config JSON in ${absolutePath}`)
  }

  const channels = readObject(payload, "channels")
  const feishu = readObject(channels, "feishu")
  const appId = String(feishu.appId ?? feishu.app_id ?? "").trim()
  const appSecret = String(feishu.appSecret ?? feishu.app_secret ?? "").trim()
  const enabled = feishu.enabled !== false

  if (!appId || !appSecret) {
    throw new OrchestratorError("Nanobot feishu config missing appId/appSecret")
  }
  return { appId, appSecret, enabled }
}

export function parseRequirementEvent(payload: unknown): FeishuRequirement {
  const data = readObject(payload)
  const event = readObject(data, "event")
  const message = readObject(event, "message")
  const sender = readObject(event, "sender")

  const text = extractTextMessageContent(message.content, { fallbackToRawOnInvalidJson: false })
  if (!text) {
    throw new OrchestratorError("Feishu event does not contain text requirement")
  }

  const senderId =
    readObject(sender, "sender_id").open_id ?? sender.open_id ?? null
  const chatId = message.chat_id
  const messageId = message.message_id

  if (typeof senderId !== "string" || typeof chatId !== "string" || typeof messageId !== "string") {
    throw new OrchestratorError("Feishu event is missing sender/chat/message identifiers")
  }

  return {
    userId: senderId,
    chatId,
    messageId,
    text,
  }
}

export class FeishuMessenger {
  constructor(
    private readonly appId: string,
    private readonly appSecret: string,
    private readonly baseUrl = "https://open.feishu.cn/open-apis",
  ) {}

  async sendText(chatId: string, text: string): Promise<FeishuReplyPlan> {
    const token = await this.tenantAccessToken()
    const plan = planFeishuReply(text, {
      maxChars: MAX_FEISHU_MESSAGE_CHARS,
      maxParts: MAX_FEISHU_MESSAGE_PARTS,
    })

    for (const part of plan.parts) {
      const response = await this.request("POST", "/im/v1/messages?receive_id_type=chat_id", {
        receive_id: chatId,
        msg_type: "text",
        content: JSON.stringify({ text: part }),
      }, token)

      if (response.code !== 0) {
        throw new OrchestratorError(`Failed to send Feishu message: ${JSON.stringify(response)}`)
      }
    }
    return plan
  }

  private async tenantAccessToken(): Promise<string> {
    const response = await this.request("POST", "/auth/v3/tenant_access_token/internal", {
      app_id: this.appId,
      app_secret: this.appSecret,
    })

    if (response.code !== 0 || typeof response.tenant_access_token !== "string") {
      throw new OrchestratorError(`Failed to fetch tenant token: ${JSON.stringify(response)}`)
    }
    return response.tenant_access_token
  }

  private async request(
    method: "POST" | "GET",
    path: string,
    payload?: Record<string, unknown>,
    token?: string,
  ): Promise<Record<string, unknown>> {
    const headers: Record<string, string> = {
      "content-type": "application/json; charset=utf-8",
    }
    if (token) {
      headers.authorization = `Bearer ${token}`
    }

  return requestJsonObject(`${this.baseUrl}${path}`, {
      method,
      headers,
      payload,
      timeoutMs: 10_000,
    })
  }
}

export function splitMessageForFeishu(
  text: string,
  options: { maxChars?: number; maxParts?: number } = {},
): string[] {
  return planFeishuReply(text, options).parts
}

export function planFeishuReply(
  text: string,
  options: { maxChars?: number; maxParts?: number } = {},
): FeishuReplyPlan {
  const maxChars = options.maxChars ?? MAX_FEISHU_MESSAGE_CHARS
  const maxParts = options.maxParts ?? MAX_FEISHU_MESSAGE_PARTS
  const normalized = text.trim()
  if (!normalized) {
    return { parts: [""], truncated: false }
  }

  const chunks: string[] = []
  let rest = normalized
  while (rest.length > maxChars && chunks.length < maxParts - 1) {
    const boundary = findSplitBoundary(rest, maxChars)
    chunks.push(rest.slice(0, boundary).trim())
    rest = rest.slice(boundary).trimStart()
  }

  if (rest.length <= maxChars) {
    chunks.push(rest)
    return { parts: chunks, truncated: false }
  }

  const tailLimit = Math.max(0, maxChars - 1)
  chunks.push(`${rest.slice(0, tailLimit)}…`)
  return { parts: chunks, truncated: true }
}

function findSplitBoundary(text: string, maxChars: number): number {
  const candidate = text.slice(0, maxChars)
  const newlineIndex = candidate.lastIndexOf("\n")
  if (newlineIndex > Math.floor(maxChars * 0.4)) {
    return newlineIndex + 1
  }
  const spaceIndex = candidate.lastIndexOf(" ")
  if (spaceIndex > Math.floor(maxChars * 0.5)) {
    return spaceIndex + 1
  }
  return maxChars
}
