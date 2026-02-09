import { mkdtemp, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"

import { describe, expect, test } from "vitest"

import { FeishuConversationStore } from "../src/channels/feishu-conversation.js"

describe("FeishuConversationStore", () => {
  test("recovers from corrupted json file", async () => {
    const root = await mkdtemp(join(tmpdir(), "lucy-conversation-store-"))
    const path = join(root, "drafts.json")
    await writeFile(path, "not-json", "utf-8")

    const store = new FeishuConversationStore(path)
    const draft = await store.getDraft("c1", "u1")
    expect(draft).toBeNull()

    await store.setDraft({
      chatId: "c1",
      userId: "u1",
      messageId: "m1",
      text: "hello",
    })

    const loaded = await store.getDraft("c1", "u1")
    expect(loaded?.text).toBe("hello")
  })

  test("recovers when payload is not object", async () => {
    const root = await mkdtemp(join(tmpdir(), "lucy-conversation-store-"))
    const path = join(root, "drafts.json")
    await writeFile(path, JSON.stringify([1, 2, 3]), "utf-8")

    const store = new FeishuConversationStore(path)
    expect(await store.getDraft("c2", "u2")).toBeNull()

    await store.setDraft({
      chatId: "c2",
      userId: "u2",
      messageId: "m2",
      text: "task details",
    })

    const loaded = await store.getDraft("c2", "u2")
    expect(loaded?.text).toBe("task details")
  })

  test("serializes concurrent append operations on same draft", async () => {
    const root = await mkdtemp(join(tmpdir(), "lucy-conversation-store-"))
    const path = join(root, "drafts.json")
    const store = new FeishuConversationStore(path)

    await store.setDraft({
      chatId: "c3",
      userId: "u3",
      messageId: "m0",
      text: "base",
    })

    await Promise.all([
      store.appendToDraft("c3", "u3", "m1", "a"),
      store.appendToDraft("c3", "u3", "m2", "b"),
      store.appendToDraft("c3", "u3", "m3", "c"),
    ])

    const loaded = await store.getDraft("c3", "u3")
    expect(loaded?.text).toContain("base")
    expect(loaded?.text).toContain("a")
    expect(loaded?.text).toContain("b")
    expect(loaded?.text).toContain("c")
  })
})
