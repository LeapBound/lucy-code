import { existsSync } from "node:fs"
import { mkdir } from "node:fs/promises"
import { join } from "node:path"
import { spawnSync } from "node:child_process"

import { WorktreeError } from "./errors.js"

export interface WorktreeHandle {
  branch: string
  path: string
}

export class WorktreeManager {
  private readonly root: string

  constructor(
    private readonly repoPath: string,
    worktreesRoot?: string,
  ) {
    this.root = worktreesRoot ?? join(repoPath, "worktrees")
  }

  async create(taskId: string, baseBranch = "main", branchPrefix = "agent"): Promise<WorktreeHandle> {
    const branch = `${branchPrefix}/${taskId}`
    const targetPath = join(this.root, taskId)
    if (existsSync(targetPath)) {
      throw new WorktreeError(`Worktree already exists: ${targetPath}`)
    }

    await mkdir(this.root, { recursive: true })
    const baseRef = this.refExists(baseBranch) ? baseBranch : "HEAD"
    this.run(["git", "worktree", "add", "-b", branch, targetPath, baseRef])
    return { branch, path: targetPath }
  }

  async remove(taskId: string, force = false): Promise<void> {
    const targetPath = join(this.root, taskId)
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
