# Architecture

## Control Plane vs Execution Plane

- Control plane: `Orchestrator` + `TaskStore` + `state-machine` + `policy`.
- Execution plane: `OpenCodeRuntimeClient` (SDK first, CLI fallback).
- Human interface: Feishu channel + webhook server + long-connection runtime.

## Main Flow

1. Ingest requirement from Feishu.
2. Create task with repo/source context.
3. Clarify and generate machine-readable plan.
4. Wait for approval.
5. Run implementation and enforce file policy.
6. Run test steps and persist report.
7. Mark `DONE` or `FAILED`.

## Guard Rails

- `RUNNING` requires approval + valid plan + no required open question.
- `TESTING` requires diff artifact.
- `DONE` requires test report.

## Worktree + Docker

- Task-level worktree: `git worktree add -b agent/<task_id> ...`.
- Optional Docker execution mounts only task worktree into `/workspace`.

## OpenCode Driver

- `sdk` (default): official `@opencode-ai/sdk` via `scripts/opencode_sdk_bridge.mjs`.
- `cli` fallback: `opencode run --agent ... --format json`.
