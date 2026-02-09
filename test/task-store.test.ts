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
    expect(result.skippedActiveState).toBe(1)
    expect(result.matchedByState).toEqual({ DONE: 1 })
    expect(result.deletedByState).toEqual({ DONE: 1 })
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
    expect(result.matchedByState).toEqual({ DONE: 1 })
    expect(result.deletedByState).toEqual({})

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
    expect(result.preview.length).toBe(2)
    expect(result.preview[0].taskId).toBe(tasks[3].taskId)
    expect(result.preview[1].taskId).toBe(tasks[2].taskId)
    expect(result.preview[0].attempts).toBe(tasks[3].execution.attempt)

    const remaining = await store.list()
    expect(remaining.length).toBe(2)
    const remainingIds = new Set(remaining.map((item) => item.taskId))
    expect(remainingIds.has(tasks[0].taskId)).toBe(true)
    expect(remainingIds.has(tasks[1].taskId)).toBe(true)
  })

  test("protects active states unless explicitly allowed", async () => {
    const root = await mkdtemp(join(tmpdir(), "lucy-task-store-"))
    const store = new TaskStore(root)
    const task = newTask({
      title: "running",
      description: "desc",
      source: { type: "feishu", userId: "u", chatId: "c", messageId: "m" },
      repo: { name: "repo", baseBranch: "main", worktreePath: ".", branch: "agent/run" },
    })
    task.state = TaskState.RUNNING
    task.updatedAt = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
    await store.save(task)

    const blocked = await store.prune({ olderThanHours: 24, states: [TaskState.RUNNING] })
    expect(blocked.matched).toBe(0)
    expect(blocked.skippedActiveState).toBe(1)
    expect((await store.list()).length).toBe(1)

    const allowed = await store.prune({
      olderThanHours: 24,
      states: [TaskState.RUNNING],
      allowActiveStates: true,
    })
    expect(allowed.matched).toBe(1)
    expect(allowed.deleted).toBe(1)
    expect((await store.list()).length).toBe(0)
  })

  test("filters prune by minimum attempts", async () => {
    const root = await mkdtemp(join(tmpdir(), "lucy-task-store-"))
    const store = new TaskStore(root)
    const lowAttempt = newTask({
      title: "low",
      description: "desc",
      source: { type: "feishu", userId: "u", chatId: "c", messageId: "m1" },
      repo: { name: "repo", baseBranch: "main", worktreePath: ".", branch: "agent/low" },
    })
    lowAttempt.state = TaskState.FAILED
    lowAttempt.execution.attempt = 1
    lowAttempt.updatedAt = new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString()

    const highAttempt = newTask({
      title: "high",
      description: "desc",
      source: { type: "feishu", userId: "u", chatId: "c", messageId: "m2" },
      repo: { name: "repo", baseBranch: "main", worktreePath: ".", branch: "agent/high" },
    })
    highAttempt.state = TaskState.FAILED
    highAttempt.execution.attempt = 4
    highAttempt.updatedAt = new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString()

    await store.save(lowAttempt)
    await store.save(highAttempt)

    const result = await store.prune({
      olderThanHours: 24,
      states: [TaskState.FAILED],
      minAttempts: 3,
    })

    expect(result.matched).toBe(1)
    expect(result.taskIds).toEqual([highAttempt.taskId])
    expect(result.matchedByState).toEqual({ FAILED: 1 })
    expect(result.deletedByState).toEqual({ FAILED: 1 })
    const remaining = await store.list()
    expect(remaining.some((task) => task.taskId === lowAttempt.taskId)).toBe(true)
  })
})
