# Feishu Webhook Runtime

This project supports two Feishu ingestion modes:

- one-shot payload: `feishu-message`
- long-running HTTP callback: `serve-feishu-webhook`
- long-connection WebSocket: `serve-feishu-longconn`

## Prepare

```bash
npm install
npm run dev -- config-init --from-nanobot
npm run dev -- config-show
```

## Start Webhook Server

```bash
npm run dev -- serve-feishu-webhook \
  --host 0.0.0.0 \
  --port 18791 \
  --repo-name lucy-code \
  --auto-provision-worktree \
  --repo-path /path/to/repo \
  --send-reply
```

Runtime behavior:

- URL verification challenge is handled automatically.
- Duplicate message IDs are skipped via `.orchestrator/feishu_seen_messages.json`.
- If a pending `WAIT_APPROVAL` task exists for same chat/user, message is treated as approval intent.
- Otherwise a new task is created and clarified.

## Start Long-Connection Mode

```bash
npm run dev -- serve-feishu-longconn \
  --repo-name lucy-code \
  --auto-provision-worktree \
  --repo-path /path/to/repo \
  --send-reply
```

This mode uses Feishu long connection via `@larksuiteoapi/node-sdk` and does not require public webhook exposure.
