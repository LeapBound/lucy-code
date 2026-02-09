import { mkdir, readdir, readFile, rename, unlink, writeFile } from "node:fs/promises"
import { join } from "node:path"

import { TaskNotFoundError } from "./errors.js"
import { logWarn } from "./logger.js"
import { parseTask, serializeTask, type Task } from "./models.js"

export class TaskStore {
  private readonly writeChains = new Map<string, Promise<void>>()

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
  }): Promise<{ scanned: number; matched: number; deleted: number; taskIds: string[] }> {
    await mkdir(this.rootDir, { recursive: true })
    const names = await readdir(this.rootDir)
    const cutoffMs = Date.now() - Math.max(0, input.olderThanHours) * 60 * 60 * 1000
    const stateSet = input.states && input.states.length > 0 ? new Set(input.states) : null

    let scanned = 0
    const matchedTasks: Task[] = []

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
        if (isOldEnough && stateMatched) {
          matchedTasks.push(task)
          if (!input.dryRun) {
            await unlink(path)
          }
        }
      } catch (error) {
        logWarn("Skipping unreadable task file while pruning tasks", {
          phase: "task-store.prune",
          filePath: path,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }

    return {
      scanned,
      matched: matchedTasks.length,
      deleted: input.dryRun ? 0 : matchedTasks.length,
      taskIds: matchedTasks.map((task) => task.taskId),
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
