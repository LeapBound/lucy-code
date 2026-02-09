import { Command } from "commander"

import { OpenCodeRuntimeClient } from "./adapters/opencode.js"
import {
  FeishuMessenger,
  parseRequirementEvent,
} from "./channels/feishu.js"
import {
  FeishuWebhookProcessor,
  FeishuWebhookSettings,
  ProcessedMessageStore,
  serveFeishuWebhook,
} from "./channels/feishu-webhook.js"
import {
  FeishuLongConnProcessor,
  FeishuLongConnSettings,
  serveFeishuLongConnection,
} from "./channels/feishu-longconn.js"
import {
  DEFAULT_CONFIG_PATH,
  initConfig,
  loadConfig,
  loadFeishuCredentialsFromConfig,
} from "./config.js"
import {
  HybridIntentClassifier,
  OpenCodeIntentClassifier,
  RuleBasedIntentClassifier,
} from "./intent.js"
import { Orchestrator } from "./orchestrator.js"
import { TaskStore } from "./store.js"

interface GlobalOptions {
  config: string
  storeDir: string
  artifactDir: string
  reportDir: string
  workspace: string
  opencodeDriver: "sdk" | "cli" | "container-sdk"
  opencodeNodeCommand: string
  opencodeSdkScript: string
  opencodeCommand: string
  opencodeTimeout: number
  opencodeUseDocker: boolean
  opencodeDockerImage: string
  opencodeDockerUser?: string
  opencodeDockerNetwork?: string
  opencodeDockerPidsLimit?: number
  opencodeDockerMemory?: string
  opencodeDockerCpus?: string
  opencodeDockerReadOnlyRootFs: boolean
  opencodeDockerTmpfs?: string
  opencodeDockerStopTimeoutSec: number
  opencodePlanAgent: string
  opencodeBuildAgent: string
  opencodeSdkBaseUrl?: string
  opencodeSdkHostname: string
  opencodeSdkPort: number
  opencodeSdkTimeoutMs: number
  opencodeWsServerHost: string
  opencodeWsServerPort: number
  intentMode: "rules" | "llm" | "hybrid"
  intentAgent: string
  intentConfidenceThreshold: number
}

function buildOrchestrator(options: GlobalOptions): Orchestrator {
  const store = new TaskStore(options.storeDir)
  const opencodeClient = new OpenCodeRuntimeClient({
    artifactRoot: options.artifactDir,
    driver: options.opencodeDriver,
    nodeCommand: options.opencodeNodeCommand,
    sdkScript: options.opencodeSdkScript,
    command: options.opencodeCommand,
    useDocker: options.opencodeUseDocker,
    dockerImage: options.opencodeDockerImage,
    dockerUser: options.opencodeDockerUser,
    dockerNetwork: options.opencodeDockerNetwork,
    dockerPidsLimit: options.opencodeDockerPidsLimit,
    dockerMemory: options.opencodeDockerMemory,
    dockerCpus: options.opencodeDockerCpus,
    dockerReadOnlyRootFs: options.opencodeDockerReadOnlyRootFs,
    dockerTmpfs: options.opencodeDockerTmpfs,
    dockerStopTimeoutSec: options.opencodeDockerStopTimeoutSec,
    workspace: options.workspace,
    timeoutSec: options.opencodeTimeout,
    planAgent: options.opencodePlanAgent,
    buildAgent: options.opencodeBuildAgent,
    sdkBaseUrl: options.opencodeSdkBaseUrl,
    sdkHostname: options.opencodeSdkHostname,
    sdkPort: options.opencodeSdkPort,
    sdkTimeoutMs: options.opencodeSdkTimeoutMs,
    wsServerHost: options.opencodeWsServerHost,
    wsServerPort: options.opencodeWsServerPort,
  })

  const ruleClassifier = new RuleBasedIntentClassifier()
  const llmClassifier =
    options.intentMode === "rules"
      ? null
      : new OpenCodeIntentClassifier({
          agent: options.intentAgent,
          baseUrl: options.opencodeSdkBaseUrl,
          hostname: options.opencodeSdkHostname,
          port: options.opencodeSdkPort || undefined,
          timeoutMs: options.opencodeSdkTimeoutMs,
          workspace: options.workspace,
        })

  const intentClassifier =
    options.intentMode === "rules"
      ? ruleClassifier
      : options.intentMode === "llm"
        ? llmClassifier ?? ruleClassifier
        : new HybridIntentClassifier(ruleClassifier, llmClassifier, options.intentConfidenceThreshold)

  return new Orchestrator(store, opencodeClient, {
    reportDir: options.reportDir,
    intentClassifier,
  })
}

function printJson(payload: unknown): void {
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`)
}

async function requirePayload(path: string): Promise<Record<string, unknown>> {
  const fs = await import("node:fs/promises")
  const raw = await fs.readFile(path, "utf-8")
  const parsed = JSON.parse(raw)
  if (!parsed || typeof parsed !== "object") {
    throw new Error("payload file must contain JSON object")
  }
  return parsed as Record<string, unknown>
}

export async function main(): Promise<void> {
  const program = new Command()
  program
    .name("lucy-orchestrator")
    .description("Lucy Orchestrator CLI")
    .option("--config <path>", "Config file path", DEFAULT_CONFIG_PATH)
    .option("--store-dir <path>", "Task store directory", ".orchestrator/tasks")
    .option("--artifact-dir <path>", "Artifact directory", ".orchestrator/artifacts")
    .option("--report-dir <path>", "Report directory", ".orchestrator/reports")
    .option("--workspace <path>", "Workspace path", process.cwd())
    .option("--opencode-driver <driver>", "OpenCode driver (sdk|cli|container-sdk)", "sdk")
    .option("--opencode-node-command <bin>", "Node runtime for SDK bridge", "node")
    .option(
      "--opencode-sdk-script <path>",
      "SDK bridge script path",
      "scripts/opencode_sdk_bridge.mjs",
    )
    .option("--opencode-command <bin>", "OpenCode CLI command", "opencode")
    .option("--opencode-timeout <sec>", "OpenCode command timeout in seconds", "900")
    .option("--opencode-use-docker", "Run OpenCode/tests in Docker", false)
    .option("--opencode-docker-image <image>", "Docker image", "nanobot-opencode")
    .option("--opencode-docker-user <uid:gid>", "Docker container user (default: current user)")
    .option("--opencode-docker-network <name>", "Docker network")
    .option("--opencode-docker-pids-limit <num>", "Docker pids limit")
    .option("--opencode-docker-memory <mem>", "Docker memory limit, e.g. 2g")
    .option("--opencode-docker-cpus <num>", "Docker CPU limit, e.g. 2")
    .option("--opencode-docker-read-only-root-fs", "Enable Docker read-only root filesystem", true)
    .option("--no-opencode-docker-read-only-root-fs", "Disable Docker read-only root filesystem")
    .option("--opencode-docker-tmpfs <spec>", "Docker tmpfs spec", "/tmp:rw,noexec,nosuid,size=64m")
    .option("--opencode-docker-stop-timeout <sec>", "Docker stop timeout in seconds", "30")
    .option("--opencode-plan-agent <name>", "Plan agent name", "plan")
    .option("--opencode-build-agent <name>", "Build agent name", "build")
    .option("--opencode-sdk-base-url <url>", "Connect to existing OpenCode server")
    .option("--opencode-sdk-hostname <host>", "SDK server host", "127.0.0.1")
    .option("--opencode-sdk-port <port>", "SDK server port (0 for random)", "0")
     .option("--opencode-sdk-timeout-ms <ms>", "SDK boot timeout ms", "5000")
     .option("--opencode-ws-server-host <host>", "WebSocket server host for container SDK", "host.docker.internal")
     .option("--opencode-ws-server-port <port>", "WebSocket server port", "18791")
    .option("--intent-mode <mode>", "Intent classifier mode (rules|llm|hybrid)", "rules")
    .option("--intent-agent <agent>", "LLM intent classifier agent", "plan")
    .option("--intent-confidence-threshold <float>", "LLM confidence threshold", "0.8")

  program
    .command("create")
    .requiredOption("--title <title>")
    .requiredOption("--description <description>")
    .requiredOption("--chat-id <chatId>")
    .requiredOption("--user-id <userId>")
    .option("--message-id <id>", "Message ID", "manual-message")
    .option("--repo-name <name>", "Repo name", "repository")
    .option("--base-branch <name>", "Base branch", "main")
    .option("--repo-path <path>", "Git repository path", process.cwd())
    .option("--worktrees-root <path>", "Worktrees root path")
    .option("--branch-prefix <prefix>", "Task branch prefix", "agent")
    .action(async (commandOptions) => {
      const options = normalizeOptions(program.opts())
      const orchestrator = buildOrchestrator(options)
      const task = await orchestrator.createTask({
        title: commandOptions.title,
        description: commandOptions.description,
        source: {
          type: "feishu",
          userId: commandOptions.userId,
          chatId: commandOptions.chatId,
          messageId: commandOptions.messageId,
        },
        repo: {
          name: commandOptions.repoName,
          baseBranch: commandOptions.baseBranch,
          worktreePath: null,
          branch: null,
        },
      })
      const provisioned = await orchestrator.provisionWorktree({
        taskId: task.taskId,
        repoPath: commandOptions.repoPath,
        worktreesRoot: commandOptions.worktreesRoot,
        branchPrefix: commandOptions.branchPrefix,
      })
      printJson(provisioned)
    })

  program
    .command("ingest-feishu")
    .requiredOption("--payload-file <path>")
    .option("--repo-name <name>", "Repo name", "repository")
    .option("--base-branch <name>", "Base branch", "main")
    .option("--repo-path <path>", "Git repository path", process.cwd())
    .option("--worktrees-root <path>", "Worktrees root path")
    .option("--branch-prefix <prefix>", "Task branch prefix", "agent")
    .action(async (commandOptions) => {
      const options = normalizeOptions(program.opts())
      const orchestrator = buildOrchestrator(options)
      const payload = await requirePayload(commandOptions.payloadFile)
      const requirement = parseRequirementEvent(payload)
      const task = await orchestrator.createTaskFromRequirement({
        requirement,
        repoName: commandOptions.repoName,
        baseBranch: commandOptions.baseBranch,
      })
      const provisioned = await orchestrator.provisionWorktree({
        taskId: task.taskId,
        repoPath: commandOptions.repoPath,
        worktreesRoot: commandOptions.worktreesRoot,
        branchPrefix: commandOptions.branchPrefix,
      })
      printJson(provisioned)
    })

  program
    .command("feishu-message")
    .requiredOption("--payload-file <path>")
    .option("--repo-name <name>", "Repo name", "repository")
    .option("--base-branch <name>", "Base branch", "main")
    .option("--repo-path <path>", "Git repository path", process.cwd())
    .option("--worktrees-root <path>", "Worktrees root path")
    .option("--branch-prefix <prefix>", "Task branch prefix", "agent")
    .option("--no-auto-clarify", "Skip clarify step")
    .option("--auto-run-on-approve", "Auto run task when approved", false)
    .option("--send-reply", "Send Feishu reply", false)
    .action(async (commandOptions) => {
      const options = normalizeOptions(program.opts())
      const orchestrator = buildOrchestrator(options)
      const payload = await requirePayload(commandOptions.payloadFile)
      const requirement = parseRequirementEvent(payload)
      const { task, replyText } = await orchestrator.processFeishuMessage({
        requirement,
        repoName: commandOptions.repoName,
        baseBranch: commandOptions.baseBranch,
        autoClarify: commandOptions.autoClarify,
        autoRunOnApprove: commandOptions.autoRunOnApprove,
        repoPath: commandOptions.repoPath,
        worktreesRoot: commandOptions.worktreesRoot,
        branchPrefix: commandOptions.branchPrefix,
      })

      let replySent = false
      if (commandOptions.sendReply) {
        const credentials = await loadFeishuCredentialsFromConfig(options.config)
        const messenger = new FeishuMessenger(credentials.appId, credentials.appSecret)
        await messenger.sendText(requirement.chatId, replyText)
        replySent = true
      }

      if (!task) {
        printJson({
          status: "draft",
          chatId: requirement.chatId,
          replyText,
          replySent,
        })
        return
      }

      printJson({
        status: "ok",
        taskId: task.taskId,
        state: task.state,
        chatId: requirement.chatId,
        replyText,
        replySent,
      })
    })

  program
    .command("serve-feishu-webhook")
    .option("--host <host>", "Host", "0.0.0.0")
    .option("--port <number>", "Port", "18791")
    .option("--repo-name <name>", "Repo name", "repository")
    .option("--base-branch <name>", "Base branch", "main")
    .option("--repo-path <path>", "Git repository path", process.cwd())
    .option("--worktrees-root <path>", "Worktrees root path")
    .option("--branch-prefix <prefix>", "Task branch prefix", "agent")
    .option("--no-auto-clarify", "Skip clarify step")
    .option("--auto-run-on-approve", "Auto run task when approved", false)
    .option("--send-reply", "Send Feishu replies", false)
    .option("--allow-from [ids...]", "Allowed sender open_id list")
    .option(
      "--processed-store <path>",
      "Processed message dedupe store",
      ".orchestrator/feishu_seen_messages.json",
    )
    .action(async (commandOptions) => {
      const options = normalizeOptions(program.opts())
      const orchestrator = buildOrchestrator(options)
      const config = await loadConfig(options.config, true)

      const allowFrom =
        Array.isArray(commandOptions.allowFrom) && commandOptions.allowFrom.length > 0
          ? commandOptions.allowFrom.map(String)
          : config.channels.feishu.allowFrom

      const settings: FeishuWebhookSettings = {
        repoName: commandOptions.repoName,
        baseBranch: commandOptions.baseBranch,
        autoClarify: commandOptions.autoClarify,
        autoRunOnApprove: commandOptions.autoRunOnApprove,
        repoPath: commandOptions.repoPath,
        worktreesRoot: commandOptions.worktreesRoot,
        branchPrefix: commandOptions.branchPrefix,
        sendReply: commandOptions.sendReply,
        allowFrom,
        verificationToken: config.channels.feishu.verificationToken || undefined,
      }

      const messenger = commandOptions.sendReply
        ? await (async () => {
            const credentials = await loadFeishuCredentialsFromConfig(options.config)
            return new FeishuMessenger(credentials.appId, credentials.appSecret)
          })()
        : undefined

      const processor = new FeishuWebhookProcessor(
        orchestrator,
        settings,
        messenger,
        new ProcessedMessageStore(commandOptions.processedStore),
      )

      printJson({
        status: "starting",
        host: commandOptions.host,
        port: Number(commandOptions.port),
        sendReply: commandOptions.sendReply,
      })

      await serveFeishuWebhook(processor, {
        host: commandOptions.host,
        port: Number(commandOptions.port),
      })
    })

  program
    .command("serve-feishu-longconn")
    .option("--repo-name <name>", "Repo name", "repository")
    .option("--base-branch <name>", "Base branch", "main")
    .option("--repo-path <path>", "Git repository path", process.cwd())
    .option("--worktrees-root <path>", "Worktrees root path")
    .option("--branch-prefix <prefix>", "Task branch prefix", "agent")
    .option("--no-auto-clarify", "Skip clarify step")
    .option("--auto-run-on-approve", "Auto run task when approved", false)
    .option("--send-reply", "Send Feishu replies", false)
    .option("--allow-from [ids...]", "Allowed sender open_id list")
    .option(
      "--processed-store <path>",
      "Processed message dedupe store",
      ".orchestrator/feishu_seen_messages.json",
    )
    .action(async (commandOptions) => {
      const options = normalizeOptions(program.opts())
      const orchestrator = buildOrchestrator(options)
      const config = await loadConfig(options.config, true)
      const credentials = await loadFeishuCredentialsFromConfig(options.config)

      const allowFrom =
        Array.isArray(commandOptions.allowFrom) && commandOptions.allowFrom.length > 0
          ? commandOptions.allowFrom.map(String)
          : config.channels.feishu.allowFrom

      const settings: FeishuLongConnSettings = {
        repoName: commandOptions.repoName,
        baseBranch: commandOptions.baseBranch,
        autoClarify: commandOptions.autoClarify,
        autoRunOnApprove: commandOptions.autoRunOnApprove,
        repoPath: commandOptions.repoPath,
        worktreesRoot: commandOptions.worktreesRoot,
        branchPrefix: commandOptions.branchPrefix,
        sendReply: commandOptions.sendReply,
        allowFrom,
      }

      const messenger = commandOptions.sendReply
        ? new FeishuMessenger(credentials.appId, credentials.appSecret)
        : undefined

      const processor = new FeishuLongConnProcessor(
        orchestrator,
        settings,
        messenger,
        new ProcessedMessageStore(commandOptions.processedStore),
      )

      printJson({
        status: "starting",
        mode: "longconn",
        sendReply: commandOptions.sendReply,
      })

      await serveFeishuLongConnection({
        appId: credentials.appId,
        appSecret: credentials.appSecret,
        encryptKey: config.channels.feishu.encryptKey || undefined,
        verificationToken: config.channels.feishu.verificationToken || undefined,
        processor,
      })
    })

  program
    .command("config-init")
    .option("--force", "Overwrite existing config", false)
    .option("--from-nanobot", "Import feishu credentials from nanobot", false)
    .option("--nanobot-config <path>", "Nanobot config path", "~/.nanobot/config.json")
    .action(async (commandOptions) => {
      const options = normalizeOptions(program.opts())
      const path = await initConfig({
        configPath: options.config,
        force: commandOptions.force,
        fromNanobot: commandOptions.fromNanobot,
        nanobotConfigPath: commandOptions.nanobotConfig,
      })
      printJson({ configPath: path, fromNanobot: commandOptions.fromNanobot })
    })

  program.command("config-show").action(async () => {
    const options = normalizeOptions(program.opts())
    const config = await loadConfig(options.config, true)
    const masked = structuredClone(config)
    if (masked.channels.feishu.appSecret) {
      const secret = masked.channels.feishu.appSecret
      masked.channels.feishu.appSecret = `***${secret.slice(-4)}`
    }
    printJson({ configPath: options.config, config: masked })
  })

  program
    .command("clarify")
    .requiredOption("--task-id <id>")
    .action(async (commandOptions) => {
      const orchestrator = buildOrchestrator(normalizeOptions(program.opts()))
      const task = await orchestrator.clarifyTask(commandOptions.taskId)
      printJson(task)
    })

  program
    .command("approve")
    .requiredOption("--task-id <id>")
    .requiredOption("--by <userId>")
    .action(async (commandOptions) => {
      const orchestrator = buildOrchestrator(normalizeOptions(program.opts()))
      const task = await orchestrator.approveTask(commandOptions.taskId, commandOptions.by)
      printJson(task)
    })

  program
    .command("approval-message")
    .requiredOption("--task-id <id>")
    .requiredOption("--user-id <id>")
    .requiredOption("--text <text>")
    .action(async (commandOptions) => {
      const orchestrator = buildOrchestrator(normalizeOptions(program.opts()))
      const task = await orchestrator.handleApprovalMessage(
        commandOptions.taskId,
        commandOptions.userId,
        commandOptions.text,
      )
      printJson(task)
    })

  program
    .command("run")
    .requiredOption("--task-id <id>")
    .action(async (commandOptions) => {
      const orchestrator = buildOrchestrator(normalizeOptions(program.opts()))
      const task = await orchestrator.runTask(commandOptions.taskId)
      printJson(task)
    })

  program
    .command("worktree-create")
    .requiredOption("--task-id <id>")
    .option("--repo-path <path>", "Repository path", process.cwd())
    .option("--worktrees-root <path>")
    .option("--branch-prefix <prefix>", "Branch prefix", "agent")
    .action(async (commandOptions) => {
      const orchestrator = buildOrchestrator(normalizeOptions(program.opts()))
      const task = await orchestrator.provisionWorktree({
        taskId: commandOptions.taskId,
        repoPath: commandOptions.repoPath,
        worktreesRoot: commandOptions.worktreesRoot,
        branchPrefix: commandOptions.branchPrefix,
      })
      printJson(task)
    })

  program
    .command("worktree-remove")
    .requiredOption("--task-id <id>")
    .option("--repo-path <path>", "Repository path", process.cwd())
    .option("--worktrees-root <path>")
    .option("--force", "Force remove worktree", false)
    .action(async (commandOptions) => {
      const orchestrator = buildOrchestrator(normalizeOptions(program.opts()))
      const task = await orchestrator.cleanupWorktree({
        taskId: commandOptions.taskId,
        repoPath: commandOptions.repoPath,
        worktreesRoot: commandOptions.worktreesRoot,
        force: commandOptions.force,
      })
      printJson(task)
    })

  program
    .command("show")
    .requiredOption("--task-id <id>")
    .action(async (commandOptions) => {
      const options = normalizeOptions(program.opts())
      const task = await new TaskStore(options.storeDir).get(commandOptions.taskId)
      printJson(task)
    })

  program.command("list").action(async () => {
    const options = normalizeOptions(program.opts())
    const tasks = await new TaskStore(options.storeDir).list()
    printJson({
      count: tasks.length,
      tasks: tasks.map((task) => ({
        taskId: task.taskId,
        title: task.title,
        state: task.state,
        updatedAt: task.updatedAt,
      })),
    })
  })

  program
    .command("store-prune")
    .option("--older-than-hours <hours>", "Delete tasks older than hours", "168")
    .option("--older-than-days <days>", "Delete tasks older than days (higher priority than hours)")
    .option("--states <csv>", "Task states to prune, comma-separated", "DONE,FAILED,CANCELLED")
    .option("--limit <num>", "Maximum tasks to prune in this run")
    .option("--batch-size <num>", "Delete batch size", "100")
    .option("--dry-run", "Only report matches without deleting", false)
    .action(async (commandOptions) => {
      const options = normalizeOptions(program.opts())
      const store = new TaskStore(options.storeDir)
      const states = String(commandOptions.states ?? "")
        .split(",")
        .map((item: string) => item.trim())
        .filter(Boolean)
      const olderThanHours =
        typeof commandOptions.olderThanDays === "string" && commandOptions.olderThanDays.trim()
          ? Number(commandOptions.olderThanDays) * 24
          : Number(commandOptions.olderThanHours ?? 168)
      const limit =
        typeof commandOptions.limit === "string" && commandOptions.limit.trim()
          ? Number(commandOptions.limit)
          : undefined
      const batchSize = Number(commandOptions.batchSize ?? 100)
      const dryRun = Boolean(commandOptions.dryRun)

      const beforeTasks = await store.list()
      const result = await store.prune({
        olderThanHours,
        states,
        limit,
        batchSize,
        dryRun,
      })
      const afterTasks = dryRun ? beforeTasks : await store.list()

      printJson({
        input: {
          olderThanHours,
          states,
          limit: limit ?? null,
          batchSize,
          dryRun,
        },
        before: {
          count: beforeTasks.length,
          byState: summarizeTasksByState(beforeTasks),
        },
        result,
        after: {
          count: afterTasks.length,
          byState: summarizeTasksByState(afterTasks),
        },
      })
    })

  await program.parseAsync(process.argv)
}

export function normalizeOptions(raw: Record<string, unknown>): GlobalOptions {
  return {
    config: String(raw.config ?? DEFAULT_CONFIG_PATH),
    storeDir: String(raw.storeDir ?? ".orchestrator/tasks"),
    artifactDir: String(raw.artifactDir ?? ".orchestrator/artifacts"),
    reportDir: String(raw.reportDir ?? ".orchestrator/reports"),
    workspace: String(raw.workspace ?? process.cwd()),
    opencodeDriver:
      raw.opencodeDriver === "cli" || raw.opencodeDriver === "container-sdk"
        ? raw.opencodeDriver
        : "sdk",
    opencodeNodeCommand: String(raw.opencodeNodeCommand ?? "node"),
    opencodeSdkScript: String(raw.opencodeSdkScript ?? "scripts/opencode_sdk_bridge.mjs"),
    opencodeCommand: String(raw.opencodeCommand ?? "opencode"),
    opencodeTimeout: parsePositiveNumber(raw.opencodeTimeout, 900),
    opencodeUseDocker: Boolean(raw.opencodeUseDocker),
    opencodeDockerImage: String(raw.opencodeDockerImage ?? "nanobot-opencode"),
    opencodeDockerUser:
      typeof raw.opencodeDockerUser === "string" && raw.opencodeDockerUser.trim()
        ? raw.opencodeDockerUser.trim()
        : undefined,
    opencodeDockerNetwork:
      typeof raw.opencodeDockerNetwork === "string" && raw.opencodeDockerNetwork.trim()
        ? raw.opencodeDockerNetwork.trim()
        : undefined,
    opencodeDockerPidsLimit: parseOptionalPositiveNumber(raw.opencodeDockerPidsLimit),
    opencodeDockerMemory:
      typeof raw.opencodeDockerMemory === "string" && raw.opencodeDockerMemory.trim()
        ? raw.opencodeDockerMemory.trim()
        : undefined,
    opencodeDockerCpus:
      typeof raw.opencodeDockerCpus === "string" && raw.opencodeDockerCpus.trim()
        ? raw.opencodeDockerCpus.trim()
        : undefined,
    opencodeDockerReadOnlyRootFs:
      typeof raw.opencodeDockerReadOnlyRootFs === "boolean"
        ? raw.opencodeDockerReadOnlyRootFs
        : raw.opencodeDockerReadOnlyRootFs === "false"
          ? false
          : true,
    opencodeDockerTmpfs:
      typeof raw.opencodeDockerTmpfs === "string" && raw.opencodeDockerTmpfs.trim()
        ? raw.opencodeDockerTmpfs.trim()
        : undefined,
    opencodeDockerStopTimeoutSec: parsePositiveNumber(raw.opencodeDockerStopTimeout, 30),
    opencodePlanAgent: String(raw.opencodePlanAgent ?? "plan"),
    opencodeBuildAgent: String(raw.opencodeBuildAgent ?? "build"),
    opencodeSdkBaseUrl:
      typeof raw.opencodeSdkBaseUrl === "string" && raw.opencodeSdkBaseUrl
        ? raw.opencodeSdkBaseUrl
        : undefined,
    opencodeSdkHostname: String(raw.opencodeSdkHostname ?? "127.0.0.1"),
    opencodeSdkPort: parseNumber(raw.opencodeSdkPort, 0),
    opencodeSdkTimeoutMs: parsePositiveNumber(raw.opencodeSdkTimeoutMs, 5000),
    opencodeWsServerHost: String(raw.opencodeWsServerHost ?? "host.docker.internal"),
    opencodeWsServerPort: parsePositiveNumber(raw.opencodeWsServerPort, 18791),
    intentMode:
      raw.intentMode === "llm" || raw.intentMode === "hybrid" ? raw.intentMode : "rules",
    intentAgent: String(raw.intentAgent ?? "plan"),
    intentConfidenceThreshold: parseNumber(raw.intentConfidenceThreshold, 0.8),
  }
}

function parseNumber(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value
  }
  if (typeof value === "string") {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) {
      return parsed
    }
  }
  return fallback
}

function parsePositiveNumber(value: unknown, fallback: number): number {
  const parsed = parseNumber(value, fallback)
  return parsed > 0 ? parsed : fallback
}

function parseOptionalPositiveNumber(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined
  }
  const parsed = parseNumber(value, NaN)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return undefined
  }
  return parsed
}

function summarizeTasksByState(tasks: Array<{ state: string }>): Record<string, number> {
  const summary: Record<string, number> = {}
  for (const task of tasks) {
    summary[task.state] = (summary[task.state] ?? 0) + 1
  }
  return summary
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exit(1)
  })
}
