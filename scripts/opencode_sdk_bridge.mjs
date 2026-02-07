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

function collectText(parts) {
  return parts
    .filter((part) => part?.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("")
    .trim()
}

function collectUsage(parts) {
  let prompt = 0
  let completion = 0

  for (const part of parts) {
    if (part?.type !== "step-finish") {
      continue
    }
    const tokens = part.tokens || {}
    const cache = tokens.cache || {}
    prompt += Number(tokens.input || 0) + Number(cache.read || 0) + Number(cache.write || 0)
    completion += Number(tokens.output || 0) + Number(tokens.reasoning || 0)
  }

  return {
    prompt_tokens: prompt,
    completion_tokens: completion,
    total_tokens: prompt + completion,
  }
}

async function main() {
  let payload
  try {
    payload = JSON.parse((await readStdin()) || "{}")
  } catch (error) {
    process.stdout.write(JSON.stringify({ ok: false, error: "invalid payload", details: String(error) }, null, 2))
    process.exit(1)
  }

  if (!payload.agent || !payload.prompt || !payload.workspace) {
    process.stdout.write(JSON.stringify({ ok: false, error: "missing required fields" }, null, 2))
    process.exit(1)
  }

  let server = null
  try {
    const client = payload.baseUrl
      ? createOpencodeClient({ baseUrl: payload.baseUrl })
      : await (async () => {
          const started = await createOpencode({
            hostname: payload.hostname || "127.0.0.1",
            port: Number(payload.port ?? 4096),
            timeout: Number(payload.timeoutMs ?? 5000),
          })
          server = started.server
          return started.client
        })()

    const session = await client.session.create({
      body: { title: payload.sessionTitle || `lucy-${payload.agent}` },
      query: { directory: payload.workspace },
    })
    if (session.error || !session.data?.id) {
      throw new Error(`create session failed: ${JSON.stringify(session.error)}`)
    }

    const response = await client.session.prompt({
      path: { id: session.data.id },
      query: { directory: payload.workspace },
      body: {
        agent: payload.agent,
        parts: [{ type: "text", text: payload.prompt }],
      },
    })
    if (response.error || !response.data) {
      throw new Error(`prompt failed: ${JSON.stringify(response.error)}`)
    }

    const parts = Array.isArray(response.data.parts) ? response.data.parts : []
    process.stdout.write(
      JSON.stringify(
        {
          ok: true,
          agent: payload.agent,
          session_id: session.data.id,
          text: collectText(parts),
          usage: collectUsage(parts),
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
