import { tryParseJsonObject } from "../json-utils.js"

export function readObject(input: unknown, key?: string): Record<string, unknown> {
  const value = key
    ? input && typeof input === "object"
      ? (input as Record<string, unknown>)[key]
      : undefined
    : input
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {}
}

export function extractTextMessageContent(
  content: unknown,
  options: { fallbackToRawOnInvalidJson: boolean },
): string {
  if (typeof content !== "string") {
    return ""
  }

  const parsed = tryParseJsonObject(content)
  if (parsed) {
    return String(parsed.text ?? "").trim()
  }

  return options.fallbackToRawOnInvalidJson ? content.trim() : ""
}

export function normalizeNonTextMessage(messageType: string): string {
  if (messageType === "image") return "[image]"
  if (messageType === "audio") return "[audio]"
  if (messageType === "file") return "[file]"
  if (messageType === "sticker") return "[sticker]"
  return messageType ? `[${messageType}]` : ""
}
