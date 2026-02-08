import { afterEach, describe, expect, test, vi } from "vitest"

import { requestJsonObject } from "../src/http.js"

describe("requestJsonObject", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  test("returns parsed JSON object on success", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response('{"ok":true}', { status: 200, headers: { "content-type": "application/json" } }),
    )

    await expect(requestJsonObject("https://example.com/api")).resolves.toEqual({ ok: true })
  })

  test("throws on non-2xx responses", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response('{"error":"bad"}', { status: 500 }))

    await expect(requestJsonObject("https://example.com/api")).rejects.toThrow(/HTTP 500/)
  })

  test("throws on invalid json body", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("not-json", { status: 200 }))

    await expect(requestJsonObject("https://example.com/api")).rejects.toThrow(/Invalid JSON response payload/)
  })

  test("throws timeout error when aborted", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation((_input, init) => {
      const signal = init?.signal as AbortSignal | undefined
      return new Promise((_, reject) => {
        signal?.addEventListener("abort", () => {
          const error = new Error("aborted")
          error.name = "AbortError"
          reject(error)
        })
      }) as Promise<Response>
    })

    await expect(requestJsonObject("https://example.com/api", { timeoutMs: 5 })).rejects.toThrow(/timed out/)
  })
})
