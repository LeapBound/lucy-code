import { describe, expect, test } from "vitest"

import { splitMessageForFeishu } from "../src/channels/feishu.js"

describe("splitMessageForFeishu", () => {
  test("keeps short message as single part", () => {
    const parts = splitMessageForFeishu("hello", { maxChars: 20, maxParts: 3 })
    expect(parts).toEqual(["hello"])
  })

  test("splits long message into multiple parts", () => {
    const text = "line1\nline2\nline3\nline4"
    const parts = splitMessageForFeishu(text, { maxChars: 10, maxParts: 5 })
    expect(parts.length).toBeGreaterThan(1)
    expect(parts.join(""))
      .toContain("line1")
  })

  test("truncates tail when exceeding max parts", () => {
    const text = "x".repeat(100)
    const parts = splitMessageForFeishu(text, { maxChars: 20, maxParts: 2 })
    expect(parts.length).toBe(2)
    expect(parts[1].endsWith("…")).toBe(true)
    expect(parts[1].length).toBeLessThanOrEqual(20)
  })
})
