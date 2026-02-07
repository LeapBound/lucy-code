#!/usr/bin/env node

import { createOpencode, createOpencodeClient } from "@opencode-ai/sdk"

async function readStdin() {
  return await new Promise((resolve, reject) => {
    let data = ""
    process.stdin.setEncoding("utf8")
    process.stdin.on("data", (chunk) => {
      data += chunk
    })
    process.stdin.on("end", () => resolve(data))
    process.stdin.on("error", reject)
  })
}

function sanitizeUsage(parts) {
  let promptTokens = 0
  let completionTokens = 0

  for (const part of parts) {
    if (!part || part.type !== "step-finish") {
      continue
    }
    const tokens = part.tokens || {}
    const input = Number(tokens.input || 0)
    const output = Number(tokens.output || 0)
    const reasoning = Number(tokens.reasoning || 0)
    const cacheRead = Number(tokens.cache?.read || 0)
    const cacheWrite = Number(tokens.cache?.write || 0)

    promptTokens += input + cacheRead + cacheWrite
    completionTokens += output + reasoning
  }

  return {
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    total_tokens: promptTokens + completionTokens,
  }
}

function collectText(parts) {
  const chunks = []
  for (const part of parts) {
    if (part && part.type === "text" && typeof part.text === "string") {
      chunks.push(part.text)
    }
  }
  return chunks.join("").trim()
}

function responseError(response) {
  if (!response || !response.error) {
    return "Unknown SDK response error"
  }

  const error = response.error
  if (typeof error === "string") {
    return error
  }
  if (typeof error.detail === "string") {
    return error.detail
  }
  if (typeof error.message === "string") {
    return error.message
  }
  return JSON.stringify(error)
}

async function main() {
  let payload
  try {
    const raw = await readStdin()
    payload = JSON.parse(raw || "{}")
  } catch (error) {
    process.stdout.write(
      JSON.stringify(
        {
          ok: false,
          error: "Invalid JSON payload",
          details: String(error),
        },
        null,
        2,
      ),
    )
    process.exit(1)
  }

  if (!payload.agent || !payload.prompt || !payload.workspace) {
    process.stdout.write(
      JSON.stringify(
        {
          ok: false,
          error: "Missing required payload fields: agent, prompt, workspace",
        },
        null,
        2,
      ),
    )
    process.exit(1)
  }

  let server = null
  let client
  try {
    if (payload.baseUrl) {
      client = createOpencodeClient({ baseUrl: payload.baseUrl })
    } else {
      const started = await createOpencode({
        hostname: payload.hostname || "127.0.0.1",
        port: Number(payload.port ?? 4096),
        timeout: Number(payload.timeoutMs ?? 5000),
      })
      client = started.client
      server = started.server
    }

    const createResult = await client.session.create({
      body: {
        title: payload.sessionTitle || `lucy-${payload.agent}`,
      },
      query: {
        directory: payload.workspace,
      },
    })
    if (createResult.error || !createResult.data?.id) {
      throw new Error(`Failed to create session: ${responseError(createResult)}`)
    }

    const sessionID = createResult.data.id
    const promptResult = await client.session.prompt({
      path: {
        id: sessionID,
      },
      query: {
        directory: payload.workspace,
      },
      body: {
        agent: payload.agent,
        parts: [
          {
            type: "text",
            text: payload.prompt,
          },
        ],
      },
    })
    if (promptResult.error || !promptResult.data) {
      throw new Error(`Failed to run prompt: ${responseError(promptResult)}`)
    }

    const parts = Array.isArray(promptResult.data.parts) ? promptResult.data.parts : []
    process.stdout.write(
      JSON.stringify(
        {
          ok: true,
          agent: payload.agent,
          session_id: sessionID,
          text: collectText(parts),
          usage: sanitizeUsage(parts),
          parts,
        },
        null,
        2,
      ),
    )
  } catch (error) {
    process.stdout.write(
      JSON.stringify(
        {
          ok: false,
          error: "OpenCode SDK execution failed",
          details: String(error),
        },
        null,
        2,
      ),
    )
    process.exitCode = 1
  } finally {
    if (server) {
      try {
        server.close()
      } catch {
        // ignore
      }
    }
  }
}

await main()
process.exit(process.exitCode || 0)
