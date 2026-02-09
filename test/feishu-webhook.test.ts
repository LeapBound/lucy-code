import { mkdtemp, readFile, writeFile } from "node:fs/promises"
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

  test("returns reply part metadata for oversized replies", async () => {
    const root = await mkdtemp(join(tmpdir(), "lucy-webhook-store-"))
    const store = new ProcessedMessageStore(join(root, "seen.json"))
    const processFeishuMessage = vi.fn().mockResolvedValue({
      task: { taskId: "task_1", state: "WAIT_APPROVAL" },
      replyText: "x".repeat(30_000),
    })
    const processor = new FeishuWebhookProcessor(
      { processFeishuMessage } as unknown as any,
      { repoName: "repo", sendReply: false },
      undefined,
      store,
    )

    const result = await processor.processPayload({
      header: { event_type: "im.message.receive_v1" },
      event: {
        message: {
          chat_id: "oc_1",
          message_id: "om_oversized",
          content: JSON.stringify({ text: "hello" }),
        },
        sender: {
          sender_id: { open_id: "ou_1" },
        },
      },
    })

    expect(result.statusCode).toBe(200)
    expect(result.payload.status).toBe("ok")
    expect(result.payload.replyParts).toBe(5)
    expect(result.payload.replyTruncated).toBe(true)
  })

  test("marks processed even when reply sending fails", async () => {
    const root = await mkdtemp(join(tmpdir(), "lucy-webhook-store-"))
    const store = new ProcessedMessageStore(join(root, "seen.json"))
    const processFeishuMessage = vi.fn().mockResolvedValue({
      task: { taskId: "task_1", state: "WAIT_APPROVAL" },
      replyText: "ok",
    })
    const messenger = {
      sendText: vi.fn().mockRejectedValue(new Error("send failed")),
    }

    const processor = new FeishuWebhookProcessor(
      { processFeishuMessage } as unknown as any,
      { repoName: "repo", sendReply: true },
      messenger as unknown as any,
      store,
    )

    const payload = {
      header: { event_type: "im.message.receive_v1" },
      event: {
        message: {
          chat_id: "oc_1",
          message_id: "om_send_fail",
          content: JSON.stringify({ text: "hello" }),
        },
        sender: {
          sender_id: { open_id: "ou_1" },
        },
      },
    }

    const first = await processor.processPayload(payload)
    const second = await processor.processPayload(payload)

    expect(first.statusCode).toBe(200)
    expect(first.payload).toMatchObject({
      status: "ok",
      replySent: false,
      replyError: "send failed",
    })
    expect(second.payload.status).toBe("duplicate")
    expect(processFeishuMessage).toHaveBeenCalledTimes(1)
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

  test("serializes concurrent add operations without losing message ids", async () => {
    const root = await mkdtemp(join(tmpdir(), "lucy-webhook-store-"))
    const path = join(root, "seen.json")
    const store = new ProcessedMessageStore(path)

    const ids = Array.from({ length: 20 }, (_, index) => `m_${index}`)
    await Promise.all(ids.map((id) => store.add(id)))

    const persisted = JSON.parse(await readFile(path, "utf-8")) as string[]
    expect(persisted.length).toBe(20)
    for (const id of ids) {
      await expect(store.has(id)).resolves.toBe(true)
    }
  })

  test("prunes oldest ids when max entries is exceeded", async () => {
    const root = await mkdtemp(join(tmpdir(), "lucy-webhook-store-"))
    const path = join(root, "seen.json")
    const store = new ProcessedMessageStore(path, 3)

    await store.add("m1")
    await store.add("m2")
    await store.add("m3")
    await store.add("m4")

    await expect(store.has("m1")).resolves.toBe(false)
    await expect(store.has("m2")).resolves.toBe(true)
    await expect(store.has("m3")).resolves.toBe(true)
    await expect(store.has("m4")).resolves.toBe(true)

    const persisted = JSON.parse(await readFile(path, "utf-8")) as string[]
    expect(persisted).toEqual(["m2", "m3", "m4"])
  })

  test("prunes oversized persisted ids during load", async () => {
    const root = await mkdtemp(join(tmpdir(), "lucy-webhook-store-"))
    const path = join(root, "seen.json")
    await writeFile(path, JSON.stringify(["m1", "m2", "m3", "m4", "m5"]), "utf-8")

    const store = new ProcessedMessageStore(path, 3)
    await expect(store.has("m1")).resolves.toBe(false)
    await expect(store.has("m2")).resolves.toBe(false)
    await expect(store.has("m3")).resolves.toBe(true)
    await expect(store.has("m4")).resolves.toBe(true)
    await expect(store.has("m5")).resolves.toBe(true)
  })
})
