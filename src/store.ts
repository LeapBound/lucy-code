import { mkdir, readdir, readFile, rename, unlink, writeFile } from "node:fs/promises"
import { join } from "node:path"

import { TaskNotFoundError } from "./errors.js"
import { logWarn } from "./logger.js"
import { parseTask, serializeTask, type Task } from "./models.js"

export class TaskStore {
  private readonly writeChains = new Map<string, Promise<void>>()
  private static readonly ACTIVE_STATES = new Set([
    "NEW",
    "CLARIFYING",
    "WAIT_APPROVAL",
    "RUNNING",
    "TESTING",
    "AUTO_FIXING",
  ])

  constructor(private readonly rootDir: string) {}

  private taskPath(taskId: string): string {
    return join(this.rootDir, `${taskId}.json`)
  }

  async save(task: Task): Promise<void> {
    await this.withTaskWriteLock(task.taskId, async () => {
      await mkdir(this.rootDir, { recursive: true })
      const payload = serializeTask(task)
      const targetPath = this.taskPath(task.taskId)
      const tempPath = `${targetPath}.tmp-${process.pid}-${Date.now()}`
      await writeFile(tempPath, `${JSON.stringify(payload, null, 2)}\n`, "utf-8")
      await rename(tempPath, targetPath)
    })
  }

  async get(taskId: string): Promise<Task> {
    try {
      const content = await readFile(this.taskPath(taskId), "utf-8")
      return parseTask(JSON.parse(content))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        throw new TaskNotFoundError(`Task not found: ${taskId}`)
      }
      throw error
    }
  }

  async list(): Promise<Task[]> {
    await mkdir(this.rootDir, { recursive: true })
    const names = await readdir(this.rootDir)
    const tasks: Task[] = []

    for (const fileName of names) {
      if (!fileName.endsWith(".json")) {
        continue
      }
      const path = join(this.rootDir, fileName)
      try {
        const content = await readFile(path, "utf-8")
        tasks.push(parseTask(JSON.parse(content)))
      } catch (error) {
        logWarn("Skipping unreadable task file while listing tasks", {
          phase: "task-store.list",
          filePath: path,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }

    return tasks.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }

  async prune(input: {
    olderThanHours: number
    states?: string[]
    dryRun?: boolean
    limit?: number
    batchSize?: number
    allowActiveStates?: boolean
    previewCount?: number
  }): Promise<{
    scanned: number
    matched: number
    deleted: number
    skippedActiveState: number
    taskIds: string[]
    preview: Array<{ taskId: string; state: string; title: string; updatedAt: string }>
  }> {
    await mkdir(this.rootDir, { recursive: true })
    const names = await readdir(this.rootDir)
    const cutoffMs = Date.now() - Math.max(0, input.olderThanHours) * 60 * 60 * 1000
    const stateSet = input.states && input.states.length > 0 ? new Set(input.states) : null
    const limit = input.limit && input.limit > 0 ? Math.trunc(input.limit) : undefined
    const batchSize = input.batchSize && input.batchSize > 0 ? Math.trunc(input.batchSize) : 100
    const allowActiveStates = Boolean(input.allowActiveStates)
    const previewCount = input.previewCount && input.previewCount > 0 ? Math.trunc(input.previewCount) : 5

    let scanned = 0
    let skippedActiveState = 0
    const matchedEntries: Array<{ task: Task; path: string }> = []

    for (const fileName of names) {
      if (!fileName.endsWith(".json")) {
        continue
      }
      const path = join(this.rootDir, fileName)
      scanned += 1
      try {
        const content = await readFile(path, "utf-8")
        const task = parseTask(JSON.parse(content))
        const updatedAtMs = Date.parse(task.updatedAt)
        const isOldEnough = Number.isFinite(updatedAtMs) && updatedAtMs <= cutoffMs
        const stateMatched = !stateSet || stateSet.has(task.state)
        const isActiveState = TaskStore.ACTIVE_STATES.has(task.state)
        if (isActiveState && !allowActiveStates) {
          skippedActiveState += 1
          continue
        }
        if (isOldEnough && stateMatched) {
          matchedEntries.push({ task, path })
        }
      } catch (error) {
        logWarn("Skipping unreadable task file while pruning tasks", {
          phase: "task-store.prune",
          filePath: path,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }

    matchedEntries.sort((a, b) => a.task.updatedAt.localeCompare(b.task.updatedAt))
    const selected = limit ? matchedEntries.slice(0, limit) : matchedEntries

    if (!input.dryRun) {
      for (let index = 0; index < selected.length; index += batchSize) {
        const batch = selected.slice(index, index + batchSize)
        await Promise.all(batch.map((entry) => unlink(entry.path)))
      }
    }

    return {
      scanned,
      matched: selected.length,
      deleted: input.dryRun ? 0 : selected.length,
      skippedActiveState,
      taskIds: selected.map((entry) => entry.task.taskId),
      preview: selected.slice(0, previewCount).map((entry) => ({
        taskId: entry.task.taskId,
        state: entry.task.state,
        title: entry.task.title,
        updatedAt: entry.task.updatedAt,
      })),
    }
  }

  private async withTaskWriteLock<T>(taskId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.writeChains.get(taskId) ?? Promise.resolve()
    const run = previous.then(operation, operation)
    const chain = run.then(() => undefined, () => undefined)
    this.writeChains.set(taskId, chain)
    try {
      return await run
    } finally {
      if (this.writeChains.get(taskId) === chain) {
        this.writeChains.delete(taskId)
      }
    }
  }
}
