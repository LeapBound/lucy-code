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

  test("prunes oldest drafts when max entries exceeded", async () => {
    const root = await mkdtemp(join(tmpdir(), "lucy-conversation-store-"))
    const path = join(root, "drafts.json")
    const store = new FeishuConversationStore(path, 2, 24 * 7)

    await store.setDraft({ chatId: "c1", userId: "u1", messageId: "m1", text: "one" })
    await store.setDraft({ chatId: "c2", userId: "u2", messageId: "m2", text: "two" })
    await store.setDraft({ chatId: "c3", userId: "u3", messageId: "m3", text: "three" })

    expect(await store.getDraft("c1", "u1")).toBeNull()
    expect(await store.getDraft("c2", "u2")).not.toBeNull()
    expect(await store.getDraft("c3", "u3")).not.toBeNull()
  })

  test("prunes stale drafts on load by age", async () => {
    const root = await mkdtemp(join(tmpdir(), "lucy-conversation-store-"))
    const path = join(root, "drafts.json")
    const now = new Date()
    const old = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString()
    const fresh = new Date(now.getTime() - 10 * 60 * 1000).toISOString()

    await writeFile(
      path,
      `${JSON.stringify(
        {
          "c_old::u_old": {
            chatId: "c_old",
            userId: "u_old",
            messageId: "m_old",
            text: "old",
            createdAt: old,
            updatedAt: old,
          },
          "c_new::u_new": {
            chatId: "c_new",
            userId: "u_new",
            messageId: "m_new",
            text: "new",
            createdAt: fresh,
            updatedAt: fresh,
          },
        },
        null,
        2,
      )}\n`,
      "utf-8",
    )

    const store = new FeishuConversationStore(path, 10, 24)
    expect(await store.getDraft("c_old", "u_old")).toBeNull()
    expect(await store.getDraft("c_new", "u_new")).not.toBeNull()
  })
})
