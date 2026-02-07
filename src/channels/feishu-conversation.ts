import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"

/**
 * Represents a draft task created from Feishu conversation
 */
export interface FeishuDraft {
  chatId: string
  userId: string
  messageId: string
  text: string
  createdAt: string
  updatedAt: string
}

/**
 * Manages Feishu conversation drafts to distinguish genuine development requests from casual questions
 */
export class FeishuConversationStore {
  private readonly filePath: string
  private loaded = false
  private drafts = new Map<string, FeishuDraft>()

  constructor(filePath = ".orchestrator/feishu_conversations.json") {
    this.filePath = resolve(filePath)
  }

  /**
   * Retrieve current draft for a user in a chat
   */
  async getDraft(chatId: string, userId: string): Promise<FeishuDraft | null> {
    await this.load()
    return this.drafts.get(this.key(chatId, userId)) ?? null
  }

  /**
   * Set a new draft for the user chat
   */
  async setDraft(draft: Omit<FeishuDraft, "createdAt" | "updatedAt">): Promise<FeishuDraft> {
    await this.load()
    const now = new Date().toISOString()
    const full: FeishuDraft = {
      ...draft,
      createdAt: now,
      updatedAt: now,
    }
    this.drafts.set(this.key(draft.chatId, draft.userId), full)
    await this.persist()
    return full
  }

  /**
   * Append to an existing draft (for multi-message clarification)
   */
  async appendToDraft(chatId: string, userId: string, messageId: string, text: string): Promise<FeishuDraft | null> {
    await this.load()
    const key = this.key(chatId, userId)
    const existing = this.drafts.get(key)
    if (!existing) {
      return null
    }
    const now = new Date().toISOString()
    const updated: FeishuDraft = {
      ...existing,
      messageId,
      text: `${existing.text}\n${text}`.trim(),
      updatedAt: now,
    }
    this.drafts.set(key, updated)
    await this.persist()
    return updated
  }

  /**
   * Clear draft after user confirms intent or cancels
   */
  async clearDraft(chatId: string, userId: string): Promise<void> {
    await this.load()
    this.drafts.delete(this.key(chatId, userId))
    await this.persist()
  }

  private async load(): Promise<void> {
    if (this.loaded) {
      return
    }
    this.loaded = true

    try {
      const raw = await readFile(this.filePath, "utf-8")
      const payload = JSON.parse(raw)
      if (!payload || typeof payload !== "object") {
        return
      }
      for (const [key, value] of Object.entries(payload as Record<string, unknown>)) {
        if (!value || typeof value !== "object") {
          continue
        }
        const item = value as Record<string, unknown>
        if (
          typeof item.chatId === "string" &&
          typeof item.userId === "string" &&
          typeof item.messageId === "string" &&
          typeof item.text === "string"
        ) {
          this.drafts.set(key, {
            chatId: item.chatId,
            userId: item.userId,
            messageId: item.messageId,
            text: item.text,
            createdAt: typeof item.createdAt === "string" ? item.createdAt : new Date().toISOString(),
            updatedAt: typeof item.updatedAt === "string" ? item.updatedAt : new Date().toISOString(),
          })
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error
      }
    }
  }

  private async persist(): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true })
    const payload: Record<string, FeishuDraft> = {}
    for (const [key, draft] of this.drafts.entries()) {
      payload[key] = draft
    }
    await writeFile(this.filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf-8")
  }

  private key(chatId: string, userId: string): string {
    return `${chatId}::${userId}`
  }
}
