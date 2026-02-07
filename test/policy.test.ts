import { describe, expect, test } from "vitest"

import { enforceFilePolicy } from "../src/policy.js"
import { PolicyViolationError } from "../src/errors.js"

const constraints = {
  allowedPaths: ["src/**", "test/**"],
  forbiddenPaths: ["secrets/**"],
  maxFilesChanged: 3,
}

describe("enforceFilePolicy", () => {
  test("passes for allowed paths", () => {
    expect(() => enforceFilePolicy(["src/a.ts", "test/a.test.ts"], constraints)).not.toThrow()
  })

  test("blocks forbidden paths", () => {
    expect(() => enforceFilePolicy(["secrets/key.txt"], constraints)).toThrow(PolicyViolationError)
  })

  test("blocks files outside allowlist", () => {
    expect(() => enforceFilePolicy(["docs/readme.md"], constraints)).toThrow(PolicyViolationError)
  })
})
