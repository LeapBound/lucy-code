# Lucy Orchestrator（TypeScript）

面向飞书（Feishu）的编码编排器，基于 OpenCode SDK 构建。

## 功能概览

- 从飞书接收需求。
- 运行显式状态机：`NEW -> CLARIFYING -> WAIT_APPROVAL -> RUNNING -> TESTING -> DONE/FAILED`。
- 使用 OpenCode 执行澄清 / 构建 / 测试。
- 支持以任务为粒度的 git worktree 隔离，并可选使用 Docker 执行。
- 同时支持 webhook 回调模式与长连接（WebSocket）模式。

## 快速开始

```bash
npm install
npm run build
npm test
```

开发模式下直接运行 CLI：

```bash
npm run dev -- --help
```

## 典型流程

```bash
# 1) 初始化本地配置（可选：从 nanobot 导入飞书凭证）
npm run dev -- config-init --from-nanobot

# 2) 创建任务
npm run dev -- create \
  --title "增加重试策略" \
  --description "为失败任务实现重试保护" \
  --chat-id "oc_xxx" \
  --user-id "ou_xxx"

# 3) 澄清 / 同意 / 运行
npm run dev -- clarify --task-id <TASK_ID>
npm run dev -- approval-message --task-id <TASK_ID> --user-id "ou_xxx" --text "同意，开始吧"
npm run dev -- run --task-id <TASK_ID>
```

## 飞书集成

单次事件处理：

```bash
npm run dev -- feishu-message \
  --payload-file examples/feishu_message_event.json \
  --repo-name lucy-code
```

Webhook 服务：

```bash
npm run dev -- serve-feishu-webhook \
  --host 0.0.0.0 \
  --port 18791 \
  --repo-name lucy-code \
  --auto-provision-worktree \
  --repo-path /path/to/repo \
  --send-reply
```

长连接服务（无需公网回调 URL）：

```bash
npm run dev -- serve-feishu-longconn \
  --repo-name lucy-code \
  --auto-provision-worktree \
  --repo-path /path/to/repo \
  --send-reply
```

交互说明：

- 如果你只是提问，机器人不会立即创建任务。
- 用自然语言确认（例如 "好，帮我做" / "开始"）回复，或在消息前加 `需求:` 来显式创建任务。

## OpenCode 驱动

- 默认：`sdk`（官方 `@opencode-ai/sdk`）
- 兜底：`cli`（`--opencode-driver cli`）

SDK 路径会经过 `scripts/opencode_sdk_bridge.mjs`，以保证一次性命令的可复现与确定性。

Docker 模式（用于 CLI 兜底与测试命令）：

```bash
npm run dev -- \
  --opencode-driver cli \
  --opencode-use-docker \
  --opencode-docker-image nanobot-opencode \
  run --task-id <TASK_ID>
```

## 目录结构

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
