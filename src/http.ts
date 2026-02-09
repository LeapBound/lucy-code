import { OrchestratorError } from "./errors.js"
import { tryParseJsonObject } from "./json-utils.js"

export interface JsonRequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE"
  headers?: Record<string, string>
  payload?: Record<string, unknown>
  timeoutMs?: number
  retries?: number
  retryDelayMs?: number
  retryStatuses?: number[]
}

export async function requestJsonObject(url: string, options: JsonRequestOptions = {}): Promise<Record<string, unknown>> {
  const retries = Math.max(0, options.retries ?? 0)
  const retryDelayMs = Math.max(0, options.retryDelayMs ?? 250)
  const retryStatuses = new Set(options.retryStatuses ?? [408, 425, 429, 500, 502, 503, 504])
  const timeoutMs = options.timeoutMs ?? 10_000

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await fetch(url, {
        method: options.method ?? "GET",
        headers: options.headers,
        body: options.payload ? JSON.stringify(options.payload) : undefined,
        signal: controller.signal,
      })

      const raw = await response.text()
      if (!response.ok) {
        if (attempt < retries && retryStatuses.has(response.status)) {
          await sleep(backoffDelayMs(attempt, retryDelayMs))
          continue
        }
        throw new OrchestratorError(
          `HTTP ${response.status} ${response.statusText} for ${url}: ${raw.slice(0, 500)}`,
        )
      }

      const parsed = tryParseJsonObject(raw)
      if (!parsed) {
        throw new OrchestratorError(`Invalid JSON response payload from ${url}: ${raw.slice(0, 500)}`)
      }
      return parsed
    } catch (error) {
      if (error instanceof OrchestratorError) {
        throw error
      }

      const isAbort = error instanceof Error && error.name === "AbortError"
      if (attempt < retries && isRetryableNetworkError(error)) {
        await sleep(backoffDelayMs(attempt, retryDelayMs))
        continue
      }

      if (isAbort) {
        throw new OrchestratorError(`Request timed out after ${timeoutMs}ms: ${url}`)
      }
      throw new OrchestratorError(`Request failed for ${url}: ${String(error)}`)
    } finally {
      clearTimeout(timer)
    }
  }

  throw new OrchestratorError(`Request failed after retries for ${url}`)
}

function isRetryableNetworkError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false
  }
  if (error.name === "AbortError") {
    return true
  }
  return /ECONNRESET|ETIMEDOUT|EPIPE|ENOTFOUND|EAI_AGAIN/i.test(error.message)
}

function backoffDelayMs(attempt: number, baseDelayMs: number): number {
  return baseDelayMs * Math.pow(2, attempt)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms))
}
