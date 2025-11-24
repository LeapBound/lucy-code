# Feature Specification: Claude Code Executor

**Feature Branch**: `001-cc-executor`
**Created**: 2025-11-24
**Status**: Draft
**Input**: User description: "P1: Claude Code 执行器 - 通过 CLI/API 调用本地 Claude Code 执行任务并获取结果。核心功能：调用 claude -p 执行指令、捕获输出、获取 diff、返回结构化结果。"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - 基础任务执行 (Priority: P1)

作为开发者，我想通过命令行发送一条指令给 Claude Code，让它执行任务并返回结果（包括生成的代码 diff 和提交信息），这样我就能自动化地让 AI 修改代码而无需手动操作。

**Why this priority**: 这是整个系统的核心功能，没有这个能力，后续的 API 和手机端都无法工作。它独立提供价值——即使没有手机 App，开发者也能通过 CLI 远程控制 AI 编码。

**Independent Test**: 可以通过运行一条简单的命令（如"添加一个 hello world 函数"）完全测试，观察是否成功调用 Claude Code、生成代码、commit 并返回 diff 信息。

**Acceptance Scenarios**:

1. **Given** 本地安装了 Claude Code，**When** 开发者执行命令提供一条指令（如"实现用户登录功能"），**Then** 系统调用 `claude -p` 执行该指令，返回执行输出、生成的 diff 和 commit hash
2. **Given** Claude Code 成功执行并修改了代码，**When** 开发者查看返回结果，**Then** 能看到所有修改文件的列表、每个文件的 diff 内容、以及新的 commit hash
3. **Given** 指令执行过程中出现错误（如 AI 无法理解需求），**When** Claude Code 失败，**Then** 系统捕获错误信息并返回清晰的错误描述，包括 stderr 输出

---

### User Story 2 - 结构化输出 (Priority: P2)

作为系统集成者，我想获取 JSON 格式的执行结果（而不是纯文本），这样我就能轻松解析数据并用于后续处理（如 API 返回、数据库存储）。

**Why this priority**: 结构化输出是实现 REST API 的基础，让机器能够可靠地解析结果。它独立于 P1，因为 P1 可以只返回文本输出给人类查看。

**Independent Test**: 运行相同的指令，但指定 JSON 输出格式，验证返回的是有效的 JSON 结构，包含所有必需字段（instruction, diff, commit, files_changed, status, error 等）。

**Acceptance Scenarios**:

1. **Given** 开发者指定 JSON 输出格式，**When** 执行任务，**Then** 返回符合预定义 schema 的 JSON 对象，包含 status、diff、commit hash、files_changed 列表等字段
2. **Given** JSON 输出模式，**When** 任务失败，**Then** 返回的 JSON 包含 error 字段和详细错误信息，status 标记为 "failed"
3. **Given** 需要查看详细执行日志，**When** 启用 verbose 模式，**Then** JSON 输出中包含 logs 字段，记录 Claude Code 的详细执行过程

---

### User Story 3 - 工具权限控制 (Priority: P3)

作为安全管理员，我想限制 Claude Code 在自动执行时能使用的工具（如只允许读写文件，禁止执行 bash 命令），这样能防止 AI 意外执行危险操作（如删除文件、修改系统配置）。

**Why this priority**: 安全控制很重要但不阻塞基础功能。P1/P2 可以先默认允许所有工具，P3 在生产环境才强制需要。

**Independent Test**: 配置只允许 Read/Write/Edit 工具，禁止 Bash，然后发送一条需要执行 bash 命令的指令，验证 Claude Code 是否被正确限制。

**Acceptance Scenarios**:

1. **Given** 配置了允许的工具列表（allowedTools），**When** 执行任务，**Then** Claude Code 只能使用列表中的工具，尝试使用其他工具会被拒绝
2. **Given** 配置了禁止的工具列表（disallowedTools），**When** Claude Code 尝试使用被禁止的工具，**Then** 操作被阻止，并在输出中记录警告信息
3. **Given** 未配置任何工具限制，**When** 执行任务，**Then** Claude Code 可以使用所有可用工具（默认行为）

---

### User Story 4 - 会话恢复与多轮对话 (Priority: P4)

作为开发者，我想能够继续之前的 AI 对话（而不是每次都从头开始），这样可以实现多轮交互（如"现在添加错误处理"继续上一个任务），提高效率和上下文连贯性。

**Why this priority**: 高级功能，提升用户体验但非必需。P1-P3 都是单次执行，P4 允许更复杂的工作流。

**Independent Test**: 执行第一条指令获得 session_id，然后用该 session_id 执行第二条相关指令，验证 Claude Code 是否理解之前的上下文。

**Acceptance Scenarios**:

1. **Given** 执行了一条指令并获得 session_id，**When** 使用该 session_id 继续对话（resume），**Then** Claude Code 记住之前的上下文，新指令基于之前的修改继续工作
2. **Given** 想要继续最近一次对话，**When** 使用 continue 模式（不指定 session_id），**Then** 自动恢复最后一个会话的上下文
3. **Given** 指定的 session_id 不存在或已过期，**When** 尝试恢复，**Then** 返回清晰的错误信息提示会话无效

---

### Edge Cases

- **Claude Code 执行超时**：如果 AI 任务运行超过预期时间（如 10 分钟），系统应该如何处理？超时后是否 kill 进程？
- **并发执行冲突**：如果两个指令同时尝试在同一个 Git 仓库上执行，通过文件锁机制自动排队，第二个请求等待第一个完成（支持配置等待超时，默认 5 分钟），避免 Git 冲突和文件锁定问题
- **Git 工作区不干净**：如果执行前 working tree 有未提交的修改，是否应该阻止执行、自动 stash、还是允许继续？
- **Claude Code 未安装或版本不兼容**：如果系统中没有安装 `claude` 命令或版本过旧，如何给出友好的错误提示？
- **大量输出处理**：如果 diff 非常大（如修改了上百个文件），如何避免内存溢出或输出截断？
- **特殊字符和编码**：指令中包含特殊字符（引号、换行符、emoji）时，subprocess 调用是否正确处理？
- **权限问题**：如果 Git 仓库路径没有写权限，Claude Code 执行失败时的错误信息是否清晰？

## Clarifications

### Session 2025-11-24

- Q: 会话恢复功能（FR-008/FR-009）需要存储 session 数据，应该使用什么存储方案？ → A: SQLite 数据库
- Q: FR-006 要求"将工具权限配置传递给 Claude Code"，但 Claude Code CLI 本身如何接收这些限制？ → A: 环境变量 + Hook 拦截
- Q: FR-012 提到"如果有未提交的修改，根据配置决定是否阻止执行、自动 stash 或允许继续"，应该使用什么默认策略？ → A: 默认阻止，要求用户显式选择
- Q: session 数据存储在 SQLite 后，应该设置多长的过期时间？过期的会话数据如何清理？ → A: 7 天自动过期，每日清理
- Q: Edge Cases 中提到"并发执行冲突"，如果两个指令同时在同一仓库执行，应该如何处理？ → A: 文件锁机制，队列等待

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: 系统必须能够调用本地安装的 Claude Code（`claude -p` 命令）并传递用户提供的文本指令
- **FR-002**: 系统必须能够捕获 Claude Code 的标准输出（stdout）和错误输出（stderr）
- **FR-003**: 系统必须在 Claude Code 执行完成后，从 Git 仓库获取生成的 diff（包括 staged、unstaged 和最近的 commit）
- **FR-004**: 系统必须支持三种输出格式：纯文本（text）、JSON（json）、流式 JSON（stream-json）
- **FR-005**: 系统必须返回结构化的执行结果，包含字段：instruction（原始指令）、status（成功/失败/超时）、diff（代码差异）、commit_hash（提交哈希）、files_changed（修改的文件列表）、stdout（标准输出）、stderr（错误输出）、execution_time（执行时长）
- **FR-006**: 系统必须支持配置允许的工具列表（allowedTools）和禁止的工具列表（disallowedTools），通过环境变量（如 CLAUDE_ALLOWED_TOOLS、CLAUDE_DISALLOWED_TOOLS）传递给 Claude Code 进程，并在系统层面实现 hook 机制拦截和验证工具调用，确保即使 Claude Code 不原生支持该配置也能强制执行限制
- **FR-007**: 系统必须支持启用详细日志模式（verbose），记录 Claude Code 的详细执行过程
- **FR-008**: 系统必须支持会话恢复（resume）功能，允许通过 session_id 继续之前的对话，会话数据使用 SQLite 数据库持久化存储（包括对话历史、执行上下文、时间戳等），会话默认 7 天后自动过期
- **FR-009**: 系统必须支持继续最近对话（continue）功能，自动从 SQLite 数据库查询并恢复最后一个会话
- **FR-016**: 系统必须实现会话清理机制，每日自动清理超过 7 天的过期会话数据，释放存储空间
- **FR-010**: 系统必须处理 Claude Code 执行失败的情况，捕获异常并返回包含错误信息的结果（而不是崩溃）
- **FR-011**: 系统必须支持执行超时机制，可配置最大执行时间（默认 10 分钟），超时后终止进程并返回超时状态
- **FR-012**: 系统必须在执行前检查 Git 工作区状态，如果有未提交的修改，默认阻止执行并返回错误提示，用户可通过 --dirty-worktree 参数显式指定行为：block（阻止，默认）、stash（自动保存到 stash）、allow（允许在脏工作区执行）
- **FR-013**: 系统必须提供命令行接口（CLI），支持以下参数：--instruction（指令文本）、--output-format（输出格式）、--allowed-tools（允许工具）、--disallowed-tools（禁止工具）、--resume（会话 ID）、--continue（继续最近会话）、--verbose（详细日志）、--timeout（超时秒数）、--dirty-worktree（脏工作区处理策略：block/stash/allow）
- **FR-014**: 系统必须提供核心库（Python 模块），可被其他程序导入使用，提供 execute_instruction() 函数
- **FR-015**: 系统必须记录所有执行的指令、时间戳、执行结果到日志文件，用于审计和调试
- **FR-017**: 系统必须实现基于文件锁的并发控制机制，当检测到同一 Git 仓库有正在执行的任务时，新请求自动进入等待队列串行执行，避免 Git 冲突，支持配置队列超时时间（默认 5 分钟），超时后返回错误

### Key Entities

- **ExecutionRequest**: 表示一次执行请求，包含属性：instruction（指令文本）、output_format（输出格式，枚举：text/json/stream-json）、allowed_tools（允许工具列表）、disallowed_tools（禁止工具列表）、resume_session_id（要恢复的会话 ID，可选）、continue_last（是否继续最近会话，布尔）、verbose（是否详细日志，布尔）、timeout（超时秒数，整数）

- **ExecutionResult**: 表示执行结果，包含属性：request_id（唯一请求 ID）、status（状态，枚举：success/failed/timeout）、instruction（原始指令）、diff（Git diff 文本）、commit_hash（提交哈希值）、files_changed（修改的文件路径列表）、stdout（Claude Code 标准输出）、stderr（Claude Code 错误输出）、error_message（错误描述，失败时）、execution_time（执行时长秒数）、session_id（会话 ID，用于后续恢复）、timestamp（执行时间戳）

- **DiffInfo**: 表示代码差异信息，包含属性：file_path（文件路径）、diff_text（该文件的 diff 文本）、additions（新增行数）、deletions（删除行数）、status（文件状态，枚举：added/modified/deleted）

- **ToolConfig**: 表示工具权限配置，包含属性：allowed_tools（允许的工具名称列表）、disallowed_tools（禁止的工具名称列表）、mode（模式，枚举：whitelist/blacklist/all）

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 开发者能够在 30 秒内通过命令行执行一条简单指令（如"添加 hello world 函数"）并查看返回的 diff
- **SC-002**: 系统能够处理至少 100 个文件修改的大型 diff（总大小 10MB），而不出现内存溢出或性能严重下降
- **SC-003**: 当 Claude Code 执行失败时，90% 的错误情况都能返回清晰、可操作的错误信息（如"Claude Code 未安装"、"Git 工作区有未提交修改"等）
- **SC-004**: JSON 输出格式的结果能够被标准 JSON 解析器（如 Python json.loads()）100% 成功解析，无格式错误
- **SC-005**: 会话恢复功能的成功率达到 95%（除了会话过期等合理失败情况）
- **SC-006**: 执行超时机制能够在配置的时间限制（±5 秒误差内）准确终止长时间运行的任务
- **SC-007**: 工具权限控制能够 100% 阻止被禁止的工具使用（通过测试用例验证）
- **SC-008**: 所有执行记录（指令、结果、时间戳）都被完整记录到日志文件，可追溯审计
