import { mkdtemp, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { describe, expect, test, vi } from "vitest"

import { OrchestratorError } from "../src/errors.js"
import { FeishuWebhookProcessor, ProcessedMessageStore } from "../src/channels/feishu-webhook.js"

describe("FeishuWebhookProcessor", () => {
  test("returns 400 when requirement payload is invalid", async () => {
    const processor = new FeishuWebhookProcessor(
      { processFeishuMessage: vi.fn() } as unknown as any,
      { repoName: "repo" },
    )

    const result = await processor.processPayload({
      header: { event_type: "im.message.receive_v1" },
      event: { message: { content: "{}" } },
    })

    expect(result.statusCode).toBe(400)
    expect(result.payload.error).toBeTruthy()
  })

  test("returns errorCode for orchestrator failures", async () => {
    const processor = new FeishuWebhookProcessor(
      {
        processFeishuMessage: vi.fn().mockRejectedValue(new OrchestratorError("boom", "ORCH_FAIL")),
      } as unknown as any,
      { repoName: "repo" },
    )

    const result = await processor.processPayload({
      header: { event_type: "im.message.receive_v1" },
      event: {
        message: {
          chat_id: "oc_1",
          message_id: "om_1",
          content: JSON.stringify({ text: "hello" }),
        },
        sender: {
          sender_id: { open_id: "ou_1" },
        },
      },
    })

    expect(result.statusCode).toBe(500)
    expect(result.payload).toMatchObject({
      status: "error",
      error: "boom",
      errorCode: "ORCH_FAIL",
    })
  })
})

describe("ProcessedMessageStore", () => {
  test("recovers from corrupted json file", async () => {
    const root = await mkdtemp(join(tmpdir(), "lucy-webhook-store-"))
    const path = join(root, "seen.json")
    await writeFile(path, "not-json", "utf-8")

    const store = new ProcessedMessageStore(path)
    await expect(store.has("m1")).resolves.toBe(false)
    await expect(store.add("m1")).resolves.toBeUndefined()
    await expect(store.has("m1")).resolves.toBe(true)
  })

  test("recovers when persisted payload is not array", async () => {
    const root = await mkdtemp(join(tmpdir(), "lucy-webhook-store-"))
    const path = join(root, "seen.json")
    await writeFile(path, JSON.stringify({ bad: true }), "utf-8")

    const store = new ProcessedMessageStore(path)
    await expect(store.has("m2")).resolves.toBe(false)
    await expect(store.add("m2")).resolves.toBeUndefined()
    await expect(store.has("m2")).resolves.toBe(true)
  })
})
