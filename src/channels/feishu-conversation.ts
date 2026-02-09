import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"

import { logWarn } from "../logger.js"

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
  private readonly maxEntries: number
  private readonly maxAgeMs: number
  private loaded = false
  private drafts = new Map<string, FeishuDraft>()
  private writeChain: Promise<void> = Promise.resolve()

  constructor(filePath = ".orchestrator/feishu_conversations.json", maxEntries = 2_000, maxAgeHours = 24 * 7) {
    this.filePath = resolve(filePath)
    this.maxEntries = maxEntries > 0 ? Math.trunc(maxEntries) : 2_000
    this.maxAgeMs = maxAgeHours > 0 ? Math.trunc(maxAgeHours * 60 * 60 * 1000) : 24 * 7 * 60 * 60 * 1000
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
    return this.withWriteLock(async () => {
      await this.load()
      const now = new Date().toISOString()
      const full: FeishuDraft = {
        ...draft,
        createdAt: now,
        updatedAt: now,
      }
      this.drafts.set(this.key(draft.chatId, draft.userId), full)
      this.enforceRetention(now)
      await this.persist()
      return full
    })
  }

  /**
   * Append to an existing draft (for multi-message clarification)
   */
  async appendToDraft(chatId: string, userId: string, messageId: string, text: string): Promise<FeishuDraft | null> {
    return this.withWriteLock(async () => {
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
      this.enforceRetention(now)
      await this.persist()
      return updated
    })
  }

  /**
   * Clear draft after user confirms intent or cancels
   */
  async clearDraft(chatId: string, userId: string): Promise<void> {
    await this.withWriteLock(async () => {
      await this.load()
      this.drafts.delete(this.key(chatId, userId))
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
        if (!payload || typeof payload !== "object") {
          logWarn("Feishu conversation draft store payload is invalid, starting with empty cache", {
            phase: "feishu-conversation.load.invalid-payload",
            filePath: this.filePath,
          })
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
        this.enforceRetention()
      } catch (error) {
        logWarn("Failed to parse Feishu conversation draft store JSON, starting with empty cache", {
          phase: "feishu-conversation.load.parse",
          filePath: this.filePath,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return
      }
      logWarn("Failed to read Feishu conversation draft store, starting with empty cache", {
        phase: "feishu-conversation.load.read",
        filePath: this.filePath,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  private async persist(): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true })
    const payload: Record<string, FeishuDraft> = {}
    for (const [key, draft] of this.drafts.entries()) {
      payload[key] = draft
    }
    const tempPath = `${this.filePath}.tmp-${process.pid}-${Date.now()}`
    await writeFile(tempPath, `${JSON.stringify(payload, null, 2)}\n`, "utf-8")
    await rename(tempPath, this.filePath)
  }

  private async withWriteLock<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.writeChain.then(operation, operation)
    this.writeChain = run.then(() => undefined, () => undefined)
    return run
  }

  private key(chatId: string, userId: string): string {
    return `${chatId}::${userId}`
  }

  private enforceRetention(nowIso = new Date().toISOString()): void {
    const now = Date.parse(nowIso)
    if (Number.isFinite(now)) {
      for (const [key, draft] of this.drafts.entries()) {
        const updatedAt = Date.parse(draft.updatedAt)
        if (!Number.isFinite(updatedAt) || now - updatedAt > this.maxAgeMs) {
          this.drafts.delete(key)
        }
      }
    }

    if (this.drafts.size <= this.maxEntries) {
      return
    }

    const entries = [...this.drafts.entries()]
    entries.sort((a, b) => Date.parse(a[1].updatedAt) - Date.parse(b[1].updatedAt))
    const removeCount = this.drafts.size - this.maxEntries
    for (let index = 0; index < removeCount; index += 1) {
      this.drafts.delete(entries[index][0])
    }
  }
}
