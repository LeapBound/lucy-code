import { createHash } from "node:crypto"
import { existsSync } from "node:fs"
import { mkdir } from "node:fs/promises"
import { join } from "node:path"
import { spawnSync } from "node:child_process"

import { createOpencode } from "@opencode-ai/sdk"

import { WorktreeError } from "./errors.js"

export interface WorktreeHandle {
  branch: string
  path: string
}

function stableHash8(input: string): string {
  return createHash("sha256").update(input).digest("hex").slice(0, 8)
}

function slugifyAscii(input: string): string {
  const normalized = input
    .normalize("NFKD")
    .replace(/['"`]/g, " ")
    .toLowerCase()
  return normalized
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "")
}

function containsCjk(input: string): boolean {
  // Basic CJK Unified Ideographs range.
  return /[\u4e00-\u9fff]/.test(input)
}

function extractFirstObject(text: string): Record<string, unknown> | null {
  const candidate = text.trim()
  if (!candidate) {
    return null
  }
  try {
    const parsed = JSON.parse(candidate)
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null
  } catch {
    // continue
  }

  const match = candidate.match(/\{[\s\S]*\}/)
  if (!match) {
    return null
  }
  try {
    const parsed = JSON.parse(match[0])
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null
  } catch {
    return null
  }
}

async function translateTitleToEnglishSlug(title: string, workspace: string): Promise<string> {
  let serverClose: (() => void) | undefined
  let disposeInstance: (() => Promise<void>) | undefined

  try {
    const started = await createOpencode({ hostname: "127.0.0.1", port: 0, timeout: 5000 })
    serverClose = () => {
      started.server.close()
    }
    disposeInstance = async () => {
      try {
        await started.client.instance.dispose()
      } catch {
        // ignore
      }
    }

    const client = started.client
    const session = await client.session.create({
      body: { title: `worktree-slug-${Date.now()}` },
      query: { directory: workspace },
    })
    if (session.error || !session.data?.id) {
      throw new Error(`create session failed: ${JSON.stringify(session.error)}`)
    }

    const prompt = [
      "Translate the task title into a short English summary slug.",
      "Return strict JSON only.",
      "Schema: {\"slug\":\"kebab-case-english\"}.",
      "Rules:",
      "- slug must be English words, kebab-case, lowercase", 
      "- allowed chars: a-z, 0-9, hyphen (-)",
      "- 2 to 6 words if possible; keep it concise", 
      "- do NOT include the task id", 
      "- do NOT output Chinese", 
      `title=${title}`,
    ].join("\n")

    const response = await client.session.prompt({
      path: { id: session.data.id },
      query: { directory: workspace },
      body: {
        agent: "plan",
        parts: [{ type: "text", text: prompt }],
      },
    })
    if (response.error || !response.data) {
      throw new Error(`prompt failed: ${JSON.stringify(response.error)}`)
    }

    const textOutput = (Array.isArray(response.data.parts) ? response.data.parts : [])
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("")
      .trim()

    const parsed = extractFirstObject(textOutput)
    if (!parsed) {
      throw new Error("slug output did not contain valid JSON")
    }
    const rawSlug = typeof parsed.slug === "string" ? parsed.slug : ""
    return rawSlug.trim()
  } finally {
    if (disposeInstance) {
      await disposeInstance()
    }
    if (serverClose) {
      serverClose()
    }
  }
}

function translateChineseToEnglish(input: string): string {
  // Best-effort: keep existing ASCII and translate common Chinese keywords into short English.
  // If translation yields nothing useful, caller should fall back to hash.
  let text = input

  const rules: Array<[RegExp, string]> = [
    [/新增|增加|添加|引入/g, "add "],
    [/修复|修正|解决/g, "fix "],
    [/支持/g, "support "],
    [/重构/g, "refactor "],
    [/优化/g, "optimize "],
    [/更新|升级/g, "update "],
    [/清理/g, "cleanup "],
    [/迁移/g, "migrate "],
    [/文档|说明|readme/gi, "docs "],
    [/测试/g, "test "],

    [/工作区|workspace/gi, "workspace "],
    [/隔离/g, "isolation "],
    [/分支/g, "branch "],
    [/目录/g, "dir "],
    [/创建/g, "create "],
    [/删除|移除/g, "remove "],

    [/重试/g, "retry "],
    [/策略/g, "policy "],
    [/默认/g, "default "],

    [/飞书|feishu|lark/gi, "feishu "],
    [/长连接/g, "longconn "],
    [/回调|webhook/gi, "webhook "],
    [/容器|docker/gi, "docker "],

    [/启动/g, "startup "],
    [/失败/g, "fail "],
    [/问题/g, "issue "],
    [/配置/g, "config "],
  ]

  for (const [pattern, replacement] of rules) {
    text = text.replace(pattern, replacement)
  }
  return text
}

export async function buildWorktreeName(
  taskId: string,
  title: string,
  options?: { maxSlugLen?: number; workspace?: string },
): Promise<string> {
  const trimmedTitle = title.trim()
  if (!trimmedTitle) {
    return taskId
  }

  const maxSlugLen = options?.maxSlugLen ?? 32
  let slug = ""

  if (containsCjk(trimmedTitle) && options?.workspace) {
    try {
      const llmSlug = await translateTitleToEnglishSlug(trimmedTitle, options.workspace)
      slug = slugifyAscii(llmSlug)
    } catch {
      // ignore and fall back to rule-based translation below
    }
  }

  if (!slug) {
    slug = slugifyAscii(translateChineseToEnglish(trimmedTitle))
  }
  if (!slug) {
    slug = `task-${stableHash8(trimmedTitle)}`
  }
  if (slug.length > maxSlugLen) {
    slug = slug.slice(0, maxSlugLen).replace(/-+$/, "")
  }

  return `${taskId}--${slug}`
}

export class WorktreeManager {
  private readonly root: string

  constructor(
    private readonly repoPath: string,
    worktreesRoot?: string,
  ) {
    this.root = worktreesRoot ?? join(repoPath, "worktrees")
  }

  async create(
    taskId: string,
    title: string,
    baseBranch = "main",
    branchPrefix = "agent",
  ): Promise<WorktreeHandle> {
    const name = await buildWorktreeName(taskId, title, { workspace: this.repoPath })
    const branch = `${branchPrefix}/${name}`
    const targetPath = join(this.root, name)
    if (existsSync(targetPath)) {
      throw new WorktreeError(`Worktree already exists: ${targetPath}`)
    }

    await mkdir(this.root, { recursive: true })
    const baseRef = this.refExists(baseBranch) ? baseBranch : "HEAD"
    this.run(["git", "worktree", "add", "-b", branch, targetPath, baseRef])
    return { branch, path: targetPath }
  }

  async remove(worktreePath: string, force = false): Promise<void> {
    const targetPath = worktreePath
    if (!existsSync(targetPath)) {
      return
    }
    const command = ["git", "worktree", "remove", targetPath]
    if (force) {
      command.push("--force")
    }
    this.run(command)
  }

  private refExists(ref: string): boolean {
    const result = spawnSync("git", ["rev-parse", "--verify", ref], {
      cwd: this.repoPath,
      encoding: "utf-8",
    })
    return result.status === 0
  }

  private run(command: string[]): void {
    const [executable, ...args] = command
    const result = spawnSync(executable, args, {
      cwd: this.repoPath,
      encoding: "utf-8",
    })
    if (result.status !== 0) {
      const error = result.stderr?.trim() || `Command failed: ${command.join(" ")}`
      throw new WorktreeError(error)
    }
  }
}
