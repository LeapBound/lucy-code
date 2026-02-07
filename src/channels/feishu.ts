import { readFile } from "node:fs/promises"
import { resolve } from "node:path"

import { OrchestratorError } from "../errors.js"

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

export async function loadFeishuCredentialsFromNanobot(
  configPath = "~/.nanobot/config.json",
): Promise<FeishuAppCredentials> {
  const absolutePath = resolve(configPath.replace(/^~(?=\/)/, process.env.HOME ?? "~"))
  let raw = ""
  try {
    raw = await readFile(absolutePath, "utf-8")
  } catch (error) {
    throw new OrchestratorError(`Nanobot config file not found: ${absolutePath}`)
  }

  let payload: unknown
  try {
    payload = JSON.parse(raw)
  } catch (error) {
    throw new OrchestratorError(`Invalid Nanobot config JSON: ${String(error)}`)
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

  const contentRaw = message.content
  let content: Record<string, unknown> = {}
  if (typeof contentRaw === "string") {
    try {
      content = JSON.parse(contentRaw) as Record<string, unknown>
    } catch {
      content = {}
    }
  } else if (contentRaw && typeof contentRaw === "object") {
    content = contentRaw as Record<string, unknown>
  }

  const text = String(content.text ?? "").trim()
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

  async sendText(chatId: string, text: string): Promise<void> {
    const token = await this.tenantAccessToken()
    const response = await this.request("POST", "/im/v1/messages?receive_id_type=chat_id", {
      receive_id: chatId,
      msg_type: "text",
      content: JSON.stringify({ text }),
    }, token)

    if (response.code !== 0) {
      throw new OrchestratorError(`Failed to send Feishu message: ${JSON.stringify(response)}`)
    }
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

    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: payload ? JSON.stringify(payload) : undefined,
    })

    const raw = await response.text()
    try {
      const data = JSON.parse(raw)
      return (data && typeof data === "object" ? data : {}) as Record<string, unknown>
    } catch {
      throw new OrchestratorError(`Invalid Feishu response payload: ${raw}`)
    }
  }
}

function readObject(input: unknown, key?: string): Record<string, unknown> {
  const value = key ? (input && typeof input === "object" ? (input as Record<string, unknown>)[key] : undefined) : input
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {}
}
