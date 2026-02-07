import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"

import { OrchestratorError } from "./errors.js"
import { loadFeishuCredentialsFromNanobot, type FeishuAppCredentials } from "./channels/feishu.js"

export const DEFAULT_CONFIG_PATH = "~/.lucy-orchestrator/config.json"

export interface FeishuChannelConfig {
  enabled: boolean
  appId: string
  appSecret: string
  encryptKey: string
  verificationToken: string
  allowFrom: string[]
}

export interface AppConfig {
  channels: {
    feishu: FeishuChannelConfig
  }
}

export function defaultConfig(): AppConfig {
  return {
    channels: {
      feishu: {
        enabled: false,
        appId: "",
        appSecret: "",
        encryptKey: "",
        verificationToken: "",
        allowFrom: [],
      },
    },
  }
}

export async function loadConfig(configPath = DEFAULT_CONFIG_PATH, createIfMissing = false): Promise<AppConfig> {
  const absolutePath = normalizePath(configPath)
  try {
    const raw = await readFile(absolutePath, "utf-8")
    const payload = JSON.parse(raw) as Record<string, unknown>
    const feishu = readObject(readObject(payload, "channels"), "feishu")

    return {
      channels: {
        feishu: {
          enabled: feishu.enabled !== false,
          appId: String(feishu.appId ?? feishu.app_id ?? ""),
          appSecret: String(feishu.appSecret ?? feishu.app_secret ?? ""),
          encryptKey: String(feishu.encryptKey ?? feishu.encrypt_key ?? ""),
          verificationToken: String(feishu.verificationToken ?? feishu.verification_token ?? ""),
          allowFrom: Array.isArray(feishu.allowFrom) ? feishu.allowFrom.map(String) : [],
        },
      },
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw new OrchestratorError(`Invalid Lucy config JSON: ${String(error)}`)
    }
    if (!createIfMissing) {
      throw new OrchestratorError(`Lucy config file not found: ${absolutePath}`)
    }
    const config = defaultConfig()
    await saveConfig(config, absolutePath)
    return config
  }
}

export async function saveConfig(config: AppConfig, configPath = DEFAULT_CONFIG_PATH): Promise<string> {
  const absolutePath = normalizePath(configPath)
  const parent = dirname(absolutePath)
  await mkdir(parent, { recursive: true })
  await writeFile(absolutePath, `${JSON.stringify(config, null, 2)}\n`, "utf-8")
  return absolutePath
}

export async function initConfig(options?: {
  configPath?: string
  force?: boolean
  fromNanobot?: boolean
  nanobotConfigPath?: string
}): Promise<string> {
  const configPath = normalizePath(options?.configPath ?? DEFAULT_CONFIG_PATH)
  const force = options?.force === true

  try {
    await readFile(configPath, "utf-8")
    if (!force) {
      throw new OrchestratorError(`Lucy config already exists: ${configPath}. Use --force to overwrite.`)
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error
    }
  }

  const config = defaultConfig()
  if (options?.fromNanobot) {
    const credentials = await loadFeishuCredentialsFromNanobot(options.nanobotConfigPath)
    config.channels.feishu.enabled = credentials.enabled
    config.channels.feishu.appId = credentials.appId
    config.channels.feishu.appSecret = credentials.appSecret
  }

  return saveConfig(config, configPath)
}

export async function loadFeishuCredentialsFromConfig(configPath = DEFAULT_CONFIG_PATH): Promise<FeishuAppCredentials> {
  const config = await loadConfig(configPath)
  const feishu = config.channels.feishu
  if (!feishu.enabled) {
    throw new OrchestratorError("Feishu channel is disabled in Lucy config")
  }
  if (!feishu.appId || !feishu.appSecret) {
    throw new OrchestratorError("Feishu credentials missing in Lucy config")
  }
  return {
    appId: feishu.appId,
    appSecret: feishu.appSecret,
    enabled: true,
  }
}

function normalizePath(path: string): string {
  return resolve(path.replace(/^~(?=\/)/, process.env.HOME ?? "~"))
}

function readObject(input: unknown, key: string): Record<string, unknown> {
  const root = input && typeof input === "object" ? (input as Record<string, unknown>) : {}
  const value = root[key]
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {}
}
