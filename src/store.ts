import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises"
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
