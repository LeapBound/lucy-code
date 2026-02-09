type LogLevel = "info" | "warn" | "error"

function errorDetails(error: unknown): Record<string, unknown> {
  if (!(error instanceof Error)) {
    return { error: String(error) }
  }
  return {
    error: error.message,
    errorName: error.name,
    stack: error.stack,
  }
}

function write(level: LogLevel, message: string, context: Record<string, unknown> = {}): void {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...context,
  }
  const line = JSON.stringify(entry)
  if (level === "error") {
    console.error(line)
    return
  }
  if (level === "warn") {
    console.warn(line)
    return
  }
  console.info(line)
}

export function logInfo(message: string, context?: Record<string, unknown>): void {
  write("info", message, context)
}

export function logWarn(message: string, context?: Record<string, unknown>): void {
  write("warn", message, context)
}

export function logError(message: string, error: unknown, context: Record<string, unknown> = {}): void {
  write("error", message, {
    ...context,
    ...errorDetails(error),
  })
}
