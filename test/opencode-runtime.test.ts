import { mkdtemp, readFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"

import { afterEach, describe, expect, test } from "vitest"

import { OpenCodeRuntimeClient } from "../src/adapters/opencode.js"
import { newTask } from "../src/models.js"

const createdDirs: string[] = []

afterEach(async () => {
  const fs = await import("node:fs/promises")
  while (createdDirs.length > 0) {
    const dir = createdDirs.pop()
    if (!dir) continue
    await fs.rm(dir, { recursive: true, force: true })
  }
})

describe("OpenCodeRuntimeClient runTest", () => {
  test("records timedOut metadata when test command exceeds timeout", async () => {
    const root = await mkdtemp(join(tmpdir(), "lucy-opencode-runtime-"))
    const workspace = await mkdtemp(join(tmpdir(), "lucy-opencode-workspace-"))
    createdDirs.push(root, workspace)

    const client = new OpenCodeRuntimeClient({
      artifactRoot: root,
      timeoutSec: 1,
      useDocker: false,
    })

    const task = newTask({
      title: "Task",
      description: "Run tests",
      source: { type: "feishu", userId: "u", chatId: "c", messageId: "m" },
      repo: { name: "repo", baseBranch: "main", worktreePath: workspace, branch: "agent/test" },
    })

    const result = await client.runTest(task, 'node -e "setTimeout(() => {}, 2500)"')
    expect(result.exitCode).toBe(124)

    const payload = JSON.parse(await readFile(result.logPath, "utf-8")) as Record<string, unknown>
    expect(payload.timedOut).toBe(true)
    expect(payload.exitCategory).toBe("timeout")
    expect(payload.exitCode).toBe(124)
    expect(typeof payload.runtimeCommand).toBe("string")
  })
})
