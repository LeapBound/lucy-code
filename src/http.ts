import { OrchestratorError } from "./errors.js"
import { tryParseJsonObject } from "./json-utils.js"

export interface JsonRequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE"
  headers?: Record<string, string>
  payload?: Record<string, unknown>
  timeoutMs?: number
}

export async function requestJsonObject(url: string, options: JsonRequestOptions = {}): Promise<Record<string, unknown>> {
  const controller = new AbortController()
  const timeoutMs = options.timeoutMs ?? 10_000
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
    if (error instanceof Error && error.name === "AbortError") {
      throw new OrchestratorError(`Request timed out after ${timeoutMs}ms: ${url}`)
    }
    throw new OrchestratorError(`Request failed for ${url}: ${String(error)}`)
  } finally {
    clearTimeout(timer)
  }
}
