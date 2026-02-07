import { minimatch } from "minimatch"

import { PolicyViolationError } from "./errors.js"
import type { PlanConstraints } from "./models.js"

function matchesAny(path: string, patterns: string[]): boolean {
  return patterns.some((pattern) => minimatch(path, pattern, { dot: true }))
}

export function enforceFilePolicy(changedFiles: string[], constraints: PlanConstraints): void {
  if (changedFiles.length > constraints.maxFilesChanged) {
    throw new PolicyViolationError(
      `Changed files exceeded maxFilesChanged: ${changedFiles.length} > ${constraints.maxFilesChanged}`,
    )
  }

  for (const filePath of changedFiles) {
    const normalized = filePath.replace(/\\/g, "/")

    if (constraints.forbiddenPaths.length > 0 && matchesAny(normalized, constraints.forbiddenPaths)) {
      throw new PolicyViolationError(`File is forbidden by policy: ${normalized}`)
    }

    if (constraints.allowedPaths.length > 0 && !matchesAny(normalized, constraints.allowedPaths)) {
      throw new PolicyViolationError(`File is outside allowed paths: ${normalized}`)
    }
  }
}
