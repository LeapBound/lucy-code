import { describe, expect, test } from "vitest"

import { normalizeOptions, resolveStorePruneInput } from "../src/cli.js"

describe("normalizeOptions", () => {
  test("supports container-sdk driver and docker isolation options", () => {
    const options = normalizeOptions({
      opencodeDriver: "container-sdk",
      opencodeDockerUser: "1000:1000",
      opencodeDockerNetwork: "none",
      opencodeDockerPidsLimit: "128",
      opencodeDockerMemory: "2g",
      opencodeDockerCpus: "2",
      opencodeDockerReadOnlyRootFs: true,
      opencodeDockerTmpfs: "/tmp:rw,size=64m",
      opencodeDockerStopTimeout: "45",
      opencodeWsServerHost: "127.0.0.1",
      opencodeWsServerPort: "19000",
    })

    expect(options.opencodeDriver).toBe("container-sdk")
    expect(options.opencodeDockerUser).toBe("1000:1000")
    expect(options.opencodeDockerNetwork).toBe("none")
    expect(options.opencodeDockerPidsLimit).toBe(128)
    expect(options.opencodeDockerMemory).toBe("2g")
    expect(options.opencodeDockerCpus).toBe("2")
    expect(options.opencodeDockerReadOnlyRootFs).toBe(true)
    expect(options.opencodeDockerTmpfs).toBe("/tmp:rw,size=64m")
    expect(options.opencodeDockerStopTimeoutSec).toBe(45)
    expect(options.opencodeWsServerHost).toBe("127.0.0.1")
    expect(options.opencodeWsServerPort).toBe(19000)
  })

  test("defaults read-only root fs to true", () => {
    const options = normalizeOptions({})
    expect(options.opencodeDockerReadOnlyRootFs).toBe(true)
    expect(options.opencodeDockerStopTimeoutSec).toBe(30)
  })

  test("falls back safely on invalid numeric options", () => {
    const options = normalizeOptions({
      opencodeTimeout: "NaN",
      opencodeDockerPidsLimit: "-5",
      opencodeDockerStopTimeout: "0",
      opencodeSdkTimeoutMs: "bad",
      opencodeWsServerPort: "invalid",
      intentConfidenceThreshold: "oops",
    })

    expect(options.opencodeTimeout).toBe(900)
    expect(options.opencodeDockerPidsLimit).toBeUndefined()
    expect(options.opencodeDockerStopTimeoutSec).toBe(30)
    expect(options.opencodeSdkTimeoutMs).toBe(5000)
    expect(options.opencodeWsServerPort).toBe(18791)
    expect(options.intentConfidenceThreshold).toBe(0.8)
  })

  test("normalizes store-prune options with safe defaults", () => {
    const input = resolveStorePruneInput({
      olderThanHours: "bad",
      olderThanDays: "",
      states: "DONE, FAILED,",
      limit: "x",
      batchSize: "0",
      minAttempts: "-1",
      preview: "NaN",
      includeRunning: true,
      dryRun: true,
    })

    expect(input).toMatchObject({
      olderThanHours: 168,
      states: ["DONE", "FAILED"],
      limit: null,
      batchSize: 100,
      minAttempts: null,
      previewCount: 5,
      includeRunning: true,
      dryRun: true,
    })
  })

  test("prefers older-than-days when provided", () => {
    const input = resolveStorePruneInput({
      olderThanHours: "12",
      olderThanDays: "3",
      states: "DONE",
    })
    expect(input.olderThanHours).toBe(72)
  })
})
