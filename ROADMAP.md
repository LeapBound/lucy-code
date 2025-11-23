# Lucy Code - 项目路线图

**项目目标**：在手机端通过安全通道与本地 AI Server 交互，实现 AI 自动开发和代码管理

**核心理念**：AI Server 调用本地 Claude Code 无头模式（`claude -p`），不直接调用 API

---

## 架构概览

```
Android App (手机端)
    ↓ HTTPS/Tunnel
AI Server (Python FastAPI)
    ↓ subprocess
Claude Code 无头模式 (claude -p)
    ↓ 修改代码
Git Repository
```

---

## Feature 规划（按优先级）

### P1: Claude Code 执行器 🎯 MVP 核心

**价值**：能够通过 CLI/API 调用本地 Claude Code 执行任务并获取结果

**核心功能**：
- 调用 `claude -p "指令"` 执行任务
- 捕获 CC 输出（stdout/stderr）
- 执行后获取 git diff
- 返回结构化结果（diff, commit hash, 修改的文件）

**交付物**：
- Python 库：`cc-controller`
- CLI 工具：`lucy-cc execute`
- 基础测试

**独立验证**：
```bash
lucy-cc execute --instruction "添加 hello world 函数" --branch main
# 输出：diff, commit hash, files changed
```

**状态**: 📝 待规范化（下一步）

---

### P2: Git 安全操作

**价值**：保证多任务、多分支操作的安全性，避免冲突

**核心功能**：
- 安全的分支切换（检查 working tree clean）
- 进程锁/线程锁（防止并发 Git 操作）
- Stash/unstash 支持
- 获取 staged/unstaged/committed diff
- 分支列表和状态查询

**交付物**：
- Python 库：`git-operations`
- CLI 工具：`lucy-cc diff`, `lucy-cc branches`
- Git 操作集成测试

**独立验证**：
```bash
lucy-cc diff --branch feature/login
lucy-cc branches
```

**状态**: 📋 已规划

---

### P3: REST API 服务

**价值**：提供 HTTP 接口，解耦客户端，支持异步任务

**核心功能**：
- `POST /command` - 提交指令，返回 task_id
- `GET /task/{task_id}` - 查询任务状态和结果
- `GET /diff?branch=<branch>` - 获取分支 diff
- `GET /branches` - 列出所有分支
- `GET /commits?branch=<branch>` - 提交历史
- 异步任务队列（内存队列或 Celery）
- OpenAPI 文档自动生成

**交付物**：
- FastAPI 应用
- API 契约测试
- Swagger 文档

**独立验证**：
```bash
curl -X POST http://localhost:8000/command \
  -d '{"instruction": "实现登录", "branch": "feature/login"}'
# 返回：{"task_id": "abc123", "status": "queued"}

curl http://localhost:8000/task/abc123
# 返回：{"status": "completed", "diff": "...", "commit": "..."}
```

**状态**: 📋 已规划

---

### P4: Android App 基础版

**价值**：移动端访问，随时随地发送 AI 指令

**核心功能**：
- 输入框发送指令
- 选择目标分支
- 显示任务状态（queued/running/completed/failed）
- 显示返回的 diff（纯文本）
- 显示错误信息
- 基础的 API 配置（Server URL, API Key）

**交付物**：
- Kotlin + Jetpack Compose App
- Retrofit API 客户端
- 基础 UI

**独立验证**：
- 在手机上输入指令 "添加用户注册功能"
- 看到任务状态更新
- 看到返回的 diff 文本

**状态**: 📋 已规划

---

### P5: Diff 高级可视化

**价值**：更好的代码阅读体验，快速理解 AI 的修改

**核心功能**：
- Diff 按文件分组显示
- 语法高亮（根据文件类型）
- +/- 行颜色区分（绿色/红色）
- 可折叠文件列表
- 支持大文件 diff 性能优化
- 代码行号显示

**交付物**：
- 自定义 Compose Diff Viewer
- 或集成第三方 diff 组件

**独立验证**：
- 查看多文件修改的 diff
- 语法高亮正确
- 滚动流畅

**状态**: 📋 已规划

---

### P6: 生产就绪（安全 + 多任务）

**价值**：生产环境可用，安全、稳定、可监控

**核心功能**：
- HTTPS 支持（Let's Encrypt 或自签名）
- 内网穿透（Tailscale / Cloudflare Tunnel / ngrok）
- API 认证（JWT 或 API Key）
- 任务队列（Celery + Redis）支持并发
- 多分支并发（git worktree 或多 repo 副本）
- 日志记录（所有 AI 操作）
- 监控和告警（任务失败通知）
- 速率限制（防滥用）

**交付物**：
- 安全加固的 API Server
- Tunnel 配置指南
- 部署文档
- 监控仪表板（可选）

**独立验证**：
- HTTPS 访问成功
- 认证失败时返回 401
- 多个任务可以排队执行
- 查看日志能追溯所有操作

**状态**: 📋 已规划

---

## 技术栈

**后端（AI Server）**：
- Python 3.11+
- FastAPI（异步 Web 框架）
- GitPython（Git 操作）
- subprocess（调用 claude -p）
- pytest（测试）

**Android**：
- Kotlin
- Jetpack Compose
- Retrofit + OkHttp
- Coroutines（异步）

**基础设施**：
- Git worktree（多分支并发）
- Tailscale / Cloudflare Tunnel（内网穿透）
- JWT / API Key（认证）

---

## 开发策略

### 严格遵循宪法

1. **库优先 + CLI + API**
   - 每个功能先写独立库
   - 添加 CLI 接口（可测试性）
   - 最后包装 REST API

2. **测试驱动**
   - 写测试 → 用户审批 → 测试失败 → 实现 → 测试通过
   - 契约测试（API 接口）
   - 集成测试（Claude Code 调用）

3. **迭代交付**
   - 每个 Feature 独立完成、验证
   - P1 完成后立即可用（哪怕只有 CLI）
   - 每个 checkpoint 都能 demo

---

## 当前进度

- ✅ 宪法制定
- ✅ 整体规划
- 📝 **下一步：P1 详细 spec**（运行 `/speckit.specify`）

---

## 关键风险

1. **Claude Code 并发限制** ⚠️
   - 同一 repo 只能串行执行
   - 解决方案：任务队列

2. **执行时间不可控** ⏱️
   - AI 生成代码可能几分钟
   - 解决方案：异步任务架构

3. **CC 稳定性依赖** 🔧
   - 依赖 CC 不崩溃
   - 解决方案：错误捕获 + 重试机制

4. **移动端 Diff 性能** 📱
   - 大文件 diff 渲染慢
   - 解决方案：虚拟滚动 + 懒加载
