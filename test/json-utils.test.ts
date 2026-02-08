import { describe, expect, test } from "vitest"

import { extractFirstJsonObject, tryParseJsonObject } from "../src/json-utils.js"

describe("json-utils", () => {
  test("parses direct JSON object", () => {
    expect(tryParseJsonObject('{"ok":true}')).toEqual({ ok: true })
  })

  test("returns null for non-object JSON", () => {
    expect(tryParseJsonObject("[]")).toBeNull()
    expect(tryParseJsonObject('"x"')).toBeNull()
  })

  test("extracts first JSON object from mixed text", () => {
    expect(extractFirstJsonObject("prefix {\"a\":1} suffix")).toEqual({ a: 1 })
  })

  test("returns null for invalid text", () => {
    expect(extractFirstJsonObject("not-json")).toBeNull()
  })
})
