import { mkdtemp } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"

import { describe, expect, test, vi } from "vitest"

import { FeishuLongConnProcessor } from "../src/channels/feishu-longconn.js"
import { ProcessedMessageStore } from "../src/channels/feishu-webhook.js"

describe("FeishuLongConnProcessor", () => {
  test("processes text message and sends reply", async () => {
    const root = await mkdtemp(join(tmpdir(), "lucy-longconn-test-"))
    const processFeishuMessage = vi.fn().mockResolvedValue({
      task: { taskId: "task_1", state: "WAIT_APPROVAL" },
      replyText: "ok",
    })
    const sendText = vi.fn().mockResolvedValue(undefined)

    const processor = new FeishuLongConnProcessor(
      { processFeishuMessage } as unknown as any,
      {
        repoName: "repo",
        sendReply: true,
      },
      { sendText } as unknown as any,
      new ProcessedMessageStore(join(root, "seen.json")),
    )

    const result = await processor.handleMessageEvent({
      sender: {
        sender_id: { open_id: "ou_1" },
        sender_type: "user",
      },
      message: {
        message_id: "om_1",
        chat_id: "oc_1",
        message_type: "text",
        content: JSON.stringify({ text: "hello" }),
      },
    })

    expect(result.status).toBe("ok")
    expect(result.replyParts).toBe(1)
    expect(result.replyTruncated).toBe(false)
    expect(processFeishuMessage).toHaveBeenCalledTimes(1)
    expect(sendText).toHaveBeenCalledWith("oc_1", "ok")
  })

  test("deduplicates message id", async () => {
    const root = await mkdtemp(join(tmpdir(), "lucy-longconn-test-"))
    const processFeishuMessage = vi.fn().mockResolvedValue({
      task: { taskId: "task_1", state: "WAIT_APPROVAL" },
      replyText: "ok",
    })

    const processor = new FeishuLongConnProcessor(
      { processFeishuMessage } as unknown as any,
      {
        repoName: "repo",
        sendReply: false,
      },
      undefined,
      new ProcessedMessageStore(join(root, "seen.json")),
    )

    const payload = {
      sender: {
        sender_id: { open_id: "ou_1" },
        sender_type: "user",
      },
      message: {
        message_id: "om_dup",
        chat_id: "oc_1",
        message_type: "text",
        content: JSON.stringify({ text: "hello" }),
      },
    }

    const first = await processor.handleMessageEvent(payload)
    const second = await processor.handleMessageEvent(payload)

    expect(first.status).toBe("ok")
    expect(second.status).toBe("duplicate")
    expect(processFeishuMessage).toHaveBeenCalledTimes(1)
  })

  test("blocks sender not in allowlist", async () => {
    const root = await mkdtemp(join(tmpdir(), "lucy-longconn-test-"))
    const processFeishuMessage = vi.fn().mockResolvedValue({
      task: { taskId: "task_1", state: "WAIT_APPROVAL" },
      replyText: "ok",
    })

    const processor = new FeishuLongConnProcessor(
      { processFeishuMessage } as unknown as any,
      {
        repoName: "repo",
        sendReply: false,
        allowFrom: ["ou_allow"],
      },
      undefined,
      new ProcessedMessageStore(join(root, "seen.json")),
    )

    const result = await processor.handleMessageEvent({
      sender: {
        sender_id: { open_id: "ou_blocked" },
        sender_type: "user",
      },
      message: {
        message_id: "om_2",
        chat_id: "oc_2",
        message_type: "text",
        content: JSON.stringify({ text: "hello" }),
      },
    })

    expect(result.status).toBe("ignored")
    expect(result.reason).toBe("sender_not_allowed")
    expect(processFeishuMessage).not.toHaveBeenCalled()
  })

  test("falls back to raw text when message content is malformed json", async () => {
    const root = await mkdtemp(join(tmpdir(), "lucy-longconn-test-"))
    const processFeishuMessage = vi.fn().mockResolvedValue({
      task: { taskId: "task_1", state: "WAIT_APPROVAL" },
      replyText: "ok",
    })

    const processor = new FeishuLongConnProcessor(
      { processFeishuMessage } as unknown as any,
      {
        repoName: "repo",
        sendReply: false,
      },
      undefined,
      new ProcessedMessageStore(join(root, "seen.json")),
    )

    const result = await processor.handleMessageEvent({
      sender: {
        sender_id: { open_id: "ou_1" },
        sender_type: "user",
      },
      message: {
        message_id: "om_bad_json",
        chat_id: "oc_1",
        message_type: "text",
        content: "  this is not json  ",
      },
    })

    expect(result.status).toBe("ok")
    expect(result.replyParts).toBe(1)
    expect(result.replyTruncated).toBe(false)
    expect(processFeishuMessage).toHaveBeenCalledTimes(1)
    expect(processFeishuMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        requirement: expect.objectContaining({ text: "this is not json" }),
      }),
    )
  })

  test("marks message processed even when reply sending fails", async () => {
    const root = await mkdtemp(join(tmpdir(), "lucy-longconn-test-"))
    const processFeishuMessage = vi.fn().mockResolvedValue({
      task: { taskId: "task_1", state: "WAIT_APPROVAL" },
      replyText: "ok",
    })
    const sendText = vi.fn().mockRejectedValue(new Error("send failed"))

    const processor = new FeishuLongConnProcessor(
      { processFeishuMessage } as unknown as any,
      {
        repoName: "repo",
        sendReply: true,
      },
      { sendText } as unknown as any,
      new ProcessedMessageStore(join(root, "seen.json")),
    )

    const payload = {
      sender: {
        sender_id: { open_id: "ou_1" },
        sender_type: "user",
      },
      message: {
        message_id: "om_send_fail",
        chat_id: "oc_1",
        message_type: "text",
        content: JSON.stringify({ text: "hello" }),
      },
    }

    const first = await processor.handleMessageEvent(payload)
    const second = await processor.handleMessageEvent(payload)

    expect(first).toMatchObject({
      status: "ok",
      replySent: false,
      replyError: "send failed",
    })
    expect(second.status).toBe("duplicate")
    expect(processFeishuMessage).toHaveBeenCalledTimes(1)
  })
})
