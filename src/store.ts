import { mkdir, readdir, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"

import { TaskNotFoundError } from "./errors.js"
import { parseTask, serializeTask, type Task } from "./models.js"

export class TaskStore {
  constructor(private readonly rootDir: string) {}

  private taskPath(taskId: string): string {
    return join(this.rootDir, `${taskId}.json`)
  }

  async save(task: Task): Promise<void> {
    await mkdir(this.rootDir, { recursive: true })
    const payload = serializeTask(task)
    await writeFile(this.taskPath(task.taskId), `${JSON.stringify(payload, null, 2)}\n`, "utf-8")
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
      const content = await readFile(join(this.rootDir, fileName), "utf-8")
      tasks.push(parseTask(JSON.parse(content)))
    }

    return tasks.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }
}
