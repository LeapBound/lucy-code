# Architecture

## Control Plane vs Execution Plane

- Control plane: `Orchestrator` + `TaskStore` + `state_machine` + `policy`.
- Execution plane: `OpenCodeClient` implementations.
- Human interface: Feishu webhook payload parser + Feishu message sender.
- Approval understanding: hybrid intent classifier (rules first, optional LLM fallback).
- Config source: `~/.lucy-orchestrator/config.json` (bootstrapped by `config-init`).
- Runtime entrypoint: `serve-feishu-webhook` command for callback mode.

`feishu-message` command bridges one inbound Feishu event to orchestration logic:

- If no pending task in the same chat/user, create + clarify a new task.
- If there is a pending approval task, classify user intent and approve/reject accordingly.
- Optional: auto-provision git worktree for new tasks, then run OpenCode inside Docker with only that worktree mounted.

## Main Flow

1. Ingest requirement from Feishu payload.
2. Create task (`NEW`) with source and repo context.
3. Clarify (`CLARIFYING`) and generate machine-readable plan.
4. Wait for approval (`WAIT_APPROVAL`).
5. Run build (`RUNNING`) and enforce path policy.
6. Execute test steps (`TESTING`) and write structured report.
7. Finish at `DONE` or `FAILED`.

## OpenCode Adapter Modes

- `StubOpenCodeClient`: deterministic local development mode.
- `OpenCodeCLIClient`: runs `opencode run --agent <plan|build> --format json`, parses JSONL events, and stores raw execution logs under `.orchestrator/artifacts`.

## State Guards

- `RUNNING` requires:
  - approval granted;
  - plan exists;
  - no required question remains open.
- `TESTING` requires `diff_path`.
- `DONE` requires `test_report_path`.

## Retry Rule

- Failed tasks can be retried until `execution.attempt >= execution.max_attempts`.

## Worktree Isolation

`WorktreeManager` supports task-per-worktree model:

- create: `git worktree add -b agent/<task_id> worktrees/<task_id> <base_branch>`
- remove: `git worktree remove worktrees/<task_id>`

Container runtime should mount only the task worktree path.
