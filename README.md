# Lucy Orchestrator (TypeScript)

Feishu-first coding orchestrator built around OpenCode SDK.

## What It Does

- Receives requirements from Feishu.
- Runs explicit state machine: `NEW -> CLARIFYING -> WAIT_APPROVAL -> RUNNING -> TESTING -> DONE/FAILED`.
- Uses OpenCode for clarify/build/test execution.
- Supports task-level git worktree isolation and optional Docker execution.
- Supports webhook callback mode with message dedupe and token validation.

## Quickstart

```bash
npm install
npm run build
npm test
```

Run CLI directly in dev mode:

```bash
npm run dev -- --help
```

## Typical Flow

```bash
# 1) init local config (optional: import Feishu credentials from nanobot)
npm run dev -- config-init --from-nanobot

# 2) create task
npm run dev -- create \
  --title "Add retry policy" \
  --description "Implement retry guard for failed tasks" \
  --chat-id "oc_xxx" \
  --user-id "ou_xxx"

# 3) clarify / approve / run
npm run dev -- clarify --task-id <TASK_ID>
npm run dev -- approval-message --task-id <TASK_ID> --user-id "ou_xxx" --text "同意，开始吧"
npm run dev -- run --task-id <TASK_ID>
```

## Feishu Integration

Single event processing:

```bash
npm run dev -- feishu-message \
  --payload-file examples/feishu_message_event.json \
  --repo-name lucy-code
```

Webhook server:

```bash
npm run dev -- serve-feishu-webhook \
  --host 0.0.0.0 \
  --port 18791 \
  --repo-name lucy-code \
  --auto-provision-worktree \
  --repo-path /path/to/repo \
  --send-reply
```

## OpenCode Drivers

- Default: `sdk` (official `@opencode-ai/sdk`)
- Fallback: `cli` (`--opencode-driver cli`)

The SDK path runs through `scripts/opencode_sdk_bridge.mjs` to keep one-shot commands deterministic.

Docker mode (for CLI fallback and test commands):

```bash
npm run dev -- \
  --opencode-driver cli \
  --opencode-use-docker \
  --opencode-docker-image nanobot-opencode \
  run --task-id <TASK_ID>
```

## Layout

```text
src/
  adapters/
  channels/
  cli.ts
  config.ts
  intent.ts
  models.ts
  orchestrator.ts
  plan.ts
  policy.ts
  state-machine.ts
  store.ts
  worktree.ts
test/
```
