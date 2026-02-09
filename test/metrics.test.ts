import { describe, expect, test } from "vitest"

import { MetricsRegistry } from "../src/metrics.js"

describe("MetricsRegistry", () => {
  test("aggregates counters by metric+labels", () => {
    const metrics = new MetricsRegistry()
    metrics.increment("run_total", { outcome: "success" })
    metrics.increment("run_total", { outcome: "success" }, 2)
    metrics.increment("run_total", { outcome: "failure" })

    const snapshot = metrics.snapshot()
    expect(snapshot.counters["run_total{outcome=success}"]).toBe(3)
    expect(snapshot.counters["run_total{outcome=failure}"]).toBe(1)
  })

  test("aggregates duration series", () => {
    const metrics = new MetricsRegistry()
    metrics.observeDurationMs("run_duration_ms", 100, { phase: "run" })
    metrics.observeDurationMs("run_duration_ms", 300, { phase: "run" })

    const snapshot = metrics.snapshot()
    expect(snapshot.timers["run_duration_ms{phase=run}"]).toMatchObject({
      count: 2,
      sumMs: 400,
      maxMs: 300,
    })
  })
})
