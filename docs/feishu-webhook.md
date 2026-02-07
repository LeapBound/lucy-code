# Feishu Webhook Runtime

This project supports two Feishu ingestion modes:

- one-shot payload: `feishu-message`
- long-running HTTP callback: `serve-feishu-webhook`

## Prepare Config

```bash
lucy-orchestrator config-init --from-nanobot
lucy-orchestrator config-show
npm install
```

## Start Webhook Server

```bash
lucy-orchestrator serve-feishu-webhook \
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

## Docker + Worktree Execution

When running with `--opencode-use-docker`, OpenCode and tests execute in Docker with only task worktree mounted at `/workspace`.

If you need to bypass SDK bridge for agent execution, add `--opencode-driver cli`.
