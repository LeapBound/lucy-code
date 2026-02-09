import { mkdtemp, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"

import { describe, expect, test } from "vitest"

import { newTask } from "../src/models.js"
import { TaskStore } from "../src/store.js"

describe("TaskStore", () => {
  test("uses atomic writes under concurrent saves", async () => {
    const root = await mkdtemp(join(tmpdir(), "lucy-task-store-"))
    const store = new TaskStore(root)
    const task = newTask({
      title: "Task",
      description: "desc",
      source: { type: "feishu", userId: "u", chatId: "c", messageId: "m" },
      repo: { name: "repo", baseBranch: "main", worktreePath: ".", branch: "agent/t" },
    })

    await Promise.all(
      Array.from({ length: 20 }, (_, index) => {
        const copy = {
          ...task,
          updatedAt: new Date(Date.now() + index * 10).toISOString(),
          execution: { ...task.execution, attempt: index },
        }
        return store.save(copy)
      }),
    )

    const raw = await readFile(join(root, `${task.taskId}.json`), "utf-8")
    const parsed = JSON.parse(raw) as Record<string, unknown>
    expect(typeof parsed.task_id).toBe("string")
    expect(typeof parsed.execution).toBe("object")
  })

  test("skips corrupted task files when listing", async () => {
    const root = await mkdtemp(join(tmpdir(), "lucy-task-store-"))
    const store = new TaskStore(root)
    const task = newTask({
      title: "Task",
      description: "desc",
      source: { type: "feishu", userId: "u", chatId: "c", messageId: "m" },
      repo: { name: "repo", baseBranch: "main", worktreePath: ".", branch: "agent/t" },
    })

    await store.save(task)
    await writeFile(join(root, "broken.json"), "{broken", "utf-8")

    const tasks = await store.list()
    expect(tasks.length).toBe(1)
    expect(tasks[0].taskId).toBe(task.taskId)
  })
})
