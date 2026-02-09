# Architecture

## Control Plane vs Execution Plane

- Control plane: `Orchestrator` + `TaskStore` + `state-machine` + `policy`.
- Execution plane: `OpenCodeRuntimeClient` (SDK first, CLI fallback).
- Human interface: Feishu channel + webhook server + long-connection runtime.
- Observability plane: structured logger + in-process metrics registry.

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

## Persistence & Idempotency

- `TaskStore` uses atomic write (`*.tmp` + rename) and per-task in-process write serialization.
- `TaskStore.list()` skips unreadable/corrupted JSON files and logs warning instead of failing globally.
- Feishu processed-message store is atomic and bounded (default max 10k message IDs).
- Feishu draft conversation store is atomic and bounded by both count and age (default 2k entries, 7 days).
- Webhook / long-connection processing marks message as processed before reply sending, so reply delivery failures do not break idempotency.

## Worktree + Docker

- Task-level worktree: `git worktree add -b agent/<task_id> ...`.
- Optional Docker execution mounts only task worktree into `/workspace`.
- Container runtime supports isolation controls: user/network/memory/cpu/pids/read-only-root-fs/tmpfs/stop-timeout.

## OpenCode Driver

- `sdk` (default): official `@opencode-ai/sdk` via `scripts/opencode_sdk_bridge.mjs`.
- `cli` fallback: `opencode run --agent ... --format json`.

## Observability

- Structured JSON logging in `src/logger.ts` with phase/task context.
- In-process metrics in `src/metrics.ts`:
  - task creation counter + duration
  - clarify success/failure + duration
  - run started/succeeded/failed + duration
  - container event success/failure + duration
