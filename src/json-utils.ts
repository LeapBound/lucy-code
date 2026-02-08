function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

export function tryParseJsonObject(input: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(input)
    return isRecord(parsed) ? parsed : null
  } catch (error) {
    if (error instanceof SyntaxError) {
      return null
    }
    throw error
  }
}

export function extractFirstJsonObject(text: string): Record<string, unknown> | null {
  const candidate = text.trim()
  if (!candidate) {
    return null
  }

  const direct = tryParseJsonObject(candidate)
  if (direct) {
    return direct
  }

  const match = candidate.match(/\{[\s\S]*\}/)
  if (!match) {
    return null
  }

  return tryParseJsonObject(match[0])
}
