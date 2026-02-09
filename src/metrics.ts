type Labels = Record<string, string>

interface TimerSeries {
  count: number
  sumMs: number
  maxMs: number
}

function serializeLabels(labels?: Labels): string {
  if (!labels || Object.keys(labels).length === 0) {
    return ""
  }
  return Object.entries(labels)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join(",")
}

function metricKey(name: string, labels?: Labels): string {
  const suffix = serializeLabels(labels)
  return suffix ? `${name}{${suffix}}` : name
}

export class MetricsRegistry {
  private readonly counters = new Map<string, number>()
  private readonly timers = new Map<string, TimerSeries>()

  increment(name: string, labels?: Labels, delta = 1): void {
    const key = metricKey(name, labels)
    this.counters.set(key, (this.counters.get(key) ?? 0) + delta)
  }

  observeDurationMs(name: string, durationMs: number, labels?: Labels): void {
    const key = metricKey(name, labels)
    const series = this.timers.get(key) ?? { count: 0, sumMs: 0, maxMs: 0 }
    series.count += 1
    series.sumMs += durationMs
    if (durationMs > series.maxMs) {
      series.maxMs = durationMs
    }
    this.timers.set(key, series)
  }

  snapshot(): { counters: Record<string, number>; timers: Record<string, TimerSeries> } {
    return {
      counters: Object.fromEntries(this.counters.entries()),
      timers: Object.fromEntries(this.timers.entries()),
    }
  }
}

export const orchestratorMetrics = new MetricsRegistry()
