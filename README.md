# Lucy Orchestrator（TypeScript）

面向飞书（Feishu）的编码编排器，基于 OpenCode SDK 构建。

## 功能概览

- 从飞书接收需求。
- 运行显式状态机：`NEW -> CLARIFYING -> WAIT_APPROVAL -> RUNNING -> TESTING -> DONE/FAILED`。
- 使用 OpenCode 执行澄清 / 构建 / 测试。
- 默认以任务为粒度创建 git worktree 隔离执行环境，并可选使用 Docker 执行。
- 同时支持 webhook 回调模式与长连接（WebSocket）模式。
- 内置结构化日志与任务级指标计数/耗时统计（内存 registry）。

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
  --repo-path /path/to/repo \
  --chat-id "oc_xxx" \
  --user-id "ou_xxx"

# 3) 澄清 / 同意 / 运行
npm run dev -- clarify --task-id <TASK_ID>
npm run dev -- approval-message --task-id <TASK_ID> --user-id "ou_xxx" --text "同意，开始吧"
npm run dev -- run --task-id <TASK_ID>
```

说明：

- 默认 worktree 根目录：`<dirname(repoPath)>/agent/<repoName>`（可用 `--worktrees-root` 覆盖）。任务 worktree：`<worktreesRoot>/<TASK_ID>--<slug>`。
- 默认分支名：`agent/<TASK_ID>--<slug>`（标题含中文时会尽量转换为短英文；无法转换时会退化为 `task-<hash>`）。

## 飞书集成

单次事件处理：

```bash
npm run dev -- feishu-message \
  --payload-file examples/feishu_message_event.json \
  --repo-name lucy-code \
  --repo-path /path/to/repo
```

Webhook 服务：

```bash
npm run dev -- serve-feishu-webhook \
  --host 0.0.0.0 \
  --port 18791 \
  --repo-name lucy-code \
  --repo-path /path/to/repo \
  --send-reply
```

长连接服务（无需公网回调 URL）：

```bash
npm run dev -- serve-feishu-longconn \
  --repo-name lucy-code \
  --repo-path /path/to/repo \
  --send-reply
```

交互说明：

- 如果你只是提问，机器人不会立即创建任务。
- 用自然语言确认（例如 "好，帮我做" / "开始"）回复，或在消息前加 `需求:` 来显式创建任务。
- 回复过长时会自动分段；若超过段数上限，尾段会截断并带 `...`。
- 即使回复发送失败，消息也会先标记去重，避免同一条需求被重复执行。

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

容器隔离常用参数：

```bash
npm run dev -- \
  --opencode-use-docker \
  --opencode-docker-user "1000:1000" \
  --opencode-docker-network "none" \
  --opencode-docker-pids-limit 256 \
  --opencode-docker-memory 2g \
  --opencode-docker-cpus 2 \
  --opencode-docker-read-only-root-fs \
  --opencode-docker-tmpfs "/tmp:rw,noexec,nosuid,size=64m" \
  --opencode-docker-stop-timeout 30 \
  run --task-id <TASK_ID>
```

## 可靠性说明

- `TaskStore`、Feishu 去重存储、Feishu 草稿存储均采用原子写（临时文件 + rename）。
- Feishu 去重存储默认保留最近 `10000` 条消息 ID，避免无限增长。
- Feishu 草稿存储默认支持条目数与时效清理（默认 2000 条，7 天）。
- `TaskStore.list()` 遇到损坏任务文件会跳过并记录告警，不阻断整体读取。
- 支持 `store-prune` 运维命令，按状态+时间清理历史任务，并支持 `--dry-run`、`--limit`、`--batch-size`。

## 可观测性

- 指标位于 `src/metrics.ts`，当前已接入任务创建、澄清、执行、容器事件等关键路径。
- 结构化日志位于 `src/logger.ts`，Feishu/TaskStore/运行时错误路径均已接入。

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
