import { describe, expect, test } from "vitest"

import { newTask, parseTask, recordTaskEvent } from "../src/models.js"

describe("task event log retention", () => {
  test("keeps only latest 500 events when recording", () => {
    const task = newTask({
      title: "Task",
      description: "desc",
      source: { type: "feishu", userId: "u", chatId: "c", messageId: "m" },
      repo: { name: "repo", baseBranch: "main", worktreePath: ".", branch: "agent/test" },
    })

    for (let i = 0; i < 550; i += 1) {
      recordTaskEvent(task, "test.event", `event-${i}`, { index: i })
    }

    expect(task.eventLog.length).toBe(500)
    expect(task.eventLog[0].message).toBe("event-50")
    expect(task.eventLog[499].message).toBe("event-549")
  })

  test("parseTask truncates oversized persisted event log", () => {
    const payload = {
      task_id: "task_1",
      title: "Task",
      description: "desc",
      state: "NEW",
      source: { type: "feishu", user_id: "u", chat_id: "c", message_id: "m" },
      repo: { name: "repo", base_branch: "main", worktree_path: ".", branch: null },
      approval: { required: true, approved_by: null, approved_at: null },
      execution: { attempt: 0, max_attempts: 3, last_error: null },
      artifacts: {},
      event_log: Array.from({ length: 620 }, (_, i) => ({
        timestamp: new Date(1_700_000_000_000 + i).toISOString(),
        event_type: "test.event",
        message: `persisted-${i}`,
        payload: { index: i },
      })),
      timestamps: {
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    }

    const parsed = parseTask(payload)
    expect(parsed.eventLog.length).toBe(500)
    expect(parsed.eventLog[0].message).toBe("persisted-120")
    expect(parsed.eventLog[499].message).toBe("persisted-619")
  })
})
