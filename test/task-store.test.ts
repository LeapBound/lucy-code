import { mkdtemp, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"

import { describe, expect, test } from "vitest"

import { newTask, TaskState } from "../src/models.js"
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

  test("prunes tasks by age and state", async () => {
    const root = await mkdtemp(join(tmpdir(), "lucy-task-store-"))
    const store = new TaskStore(root)

    const oldDone = newTask({
      title: "old done",
      description: "desc",
      source: { type: "feishu", userId: "u", chatId: "c", messageId: "m1" },
      repo: { name: "repo", baseBranch: "main", worktreePath: ".", branch: "agent/1" },
    })
    oldDone.state = TaskState.DONE
    oldDone.updatedAt = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString()

    const oldRunning = newTask({
      title: "old running",
      description: "desc",
      source: { type: "feishu", userId: "u", chatId: "c", messageId: "m2" },
      repo: { name: "repo", baseBranch: "main", worktreePath: ".", branch: "agent/2" },
    })
    oldRunning.state = TaskState.RUNNING
    oldRunning.updatedAt = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString()

    const freshDone = newTask({
      title: "fresh done",
      description: "desc",
      source: { type: "feishu", userId: "u", chatId: "c", messageId: "m3" },
      repo: { name: "repo", baseBranch: "main", worktreePath: ".", branch: "agent/3" },
    })
    freshDone.state = TaskState.DONE
    freshDone.updatedAt = new Date().toISOString()

    await store.save(oldDone)
    await store.save(oldRunning)
    await store.save(freshDone)

    const result = await store.prune({
      olderThanHours: 24,
      states: ["DONE", "FAILED", "CANCELLED"],
    })

    expect(result.matched).toBe(1)
    expect(result.deleted).toBe(1)
    const tasks = await store.list()
    expect(tasks.some((task) => task.taskId === oldDone.taskId)).toBe(false)
    expect(tasks.some((task) => task.taskId === oldRunning.taskId)).toBe(true)
    expect(tasks.some((task) => task.taskId === freshDone.taskId)).toBe(true)
  })

  test("supports dry-run prune", async () => {
    const root = await mkdtemp(join(tmpdir(), "lucy-task-store-"))
    const store = new TaskStore(root)
    const task = newTask({
      title: "Task",
      description: "desc",
      source: { type: "feishu", userId: "u", chatId: "c", messageId: "m" },
      repo: { name: "repo", baseBranch: "main", worktreePath: ".", branch: "agent/t" },
    })
    task.state = TaskState.DONE
    task.updatedAt = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
    await store.save(task)

    const result = await store.prune({ olderThanHours: 24, states: ["DONE"], dryRun: true })
    expect(result.matched).toBe(1)
    expect(result.deleted).toBe(0)

    const loaded = await store.get(task.taskId)
    expect(loaded.taskId).toBe(task.taskId)
  })

  test("supports prune limit and keeps newer matches", async () => {
    const root = await mkdtemp(join(tmpdir(), "lucy-task-store-"))
    const store = new TaskStore(root)

    const tasks = await Promise.all(
      Array.from({ length: 4 }, async (_, index) => {
        const task = newTask({
          title: `Task-${index}`,
          description: "desc",
          source: { type: "feishu", userId: "u", chatId: "c", messageId: `m${index}` },
          repo: { name: "repo", baseBranch: "main", worktreePath: ".", branch: `agent/${index}` },
        })
        task.state = TaskState.DONE
        task.updatedAt = new Date(Date.now() - (index + 1) * 24 * 60 * 60 * 1000).toISOString()
        await store.save(task)
        return task
      }),
    )

    const result = await store.prune({
      olderThanHours: 1,
      states: [TaskState.DONE],
      limit: 2,
      batchSize: 1,
    })

    expect(result.matched).toBe(2)
    expect(result.deleted).toBe(2)

    const remaining = await store.list()
    expect(remaining.length).toBe(2)
    const remainingIds = new Set(remaining.map((item) => item.taskId))
    expect(remainingIds.has(tasks[0].taskId)).toBe(true)
    expect(remainingIds.has(tasks[1].taskId)).toBe(true)
  })
})
