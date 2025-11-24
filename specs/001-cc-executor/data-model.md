# Data Model: Claude Code Executor

**Feature**: Claude Code Executor | **Branch**: `001-cc-executor` | **Date**: 2025-11-24

This document defines the core entities and their relationships for the Claude Code Executor feature.

## Entity Definitions

### 1. ExecutionRequest

Represents a single request to execute a Claude Code instruction.

**Attributes**:

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `instruction` | `str` | Yes | - | The text instruction to pass to Claude Code (e.g., "Add user login feature") |
| `output_format` | `Enum['text', 'json', 'stream-json']` | No | `'text'` | Output format for the result |
| `allowed_tools` | `List[str]` | No | `[]` | Whitelist of tools Claude Code can use (empty = no restriction) |
| `disallowed_tools` | `List[str]` | No | `[]` | Blacklist of tools Claude Code cannot use |
| `resume_session_id` | `Optional[str]` | No | `None` | Session ID to resume previous conversation |
| `continue_last` | `bool` | No | `False` | If True, resume the most recent session automatically |
| `verbose` | `bool` | No | `False` | If True, include detailed execution logs in output |
| `timeout` | `int` | No | `600` | Maximum execution time in seconds (default: 10 minutes) |
| `dirty_worktree` | `Enum['block', 'stash', 'allow']` | No | `'block'` | How to handle uncommitted Git changes |
| `repo_path` | `Optional[str]` | No | `os.getcwd()` | Path to Git repository (defaults to current directory) |

**Validation Rules**:
- `instruction` must be non-empty string
- `timeout` must be positive integer (1-3600 seconds)
- `allowed_tools` and `disallowed_tools` are mutually exclusive (both cannot be non-empty)
- `resume_session_id` and `continue_last` are mutually exclusive (both cannot be True)

**Example**:
```python
request = ExecutionRequest(
    instruction="Add hello world function to utils.py",
    output_format="json",
    allowed_tools=["Read", "Write", "Edit"],
    timeout=300,
    dirty_worktree="allow"
)
```

---

### 2. ExecutionResult

Represents the outcome of executing a Claude Code instruction.

**Attributes**:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `request_id` | `str` | Yes | Unique identifier for this execution (UUID) |
| `status` | `Enum['success', 'failed', 'timeout']` | Yes | Execution outcome |
| `instruction` | `str` | Yes | Original instruction from request |
| `diff` | `str` | No | Git diff text (all changed files combined) |
| `commit_hash` | `Optional[str]` | No | Git commit SHA if Claude Code created a commit |
| `files_changed` | `List[str]` | Yes | List of file paths modified/added/deleted |
| `stdout` | `str` | Yes | Standard output from Claude Code subprocess |
| `stderr` | `str` | Yes | Error output from Claude Code subprocess |
| `error_message` | `Optional[str]` | No | Human-readable error description (populated when status='failed' or 'timeout') |
| `execution_time` | `float` | Yes | Total execution duration in seconds |
| `session_id` | `str` | Yes | Session ID for this execution (new or resumed) |
| `timestamp` | `datetime` | Yes | When the execution started (ISO 8601 format) |
| `diff_info` | `List[DiffInfo]` | No | Per-file diff details (optional, for detailed analysis) |

**Status Codes**:
- `success`: Claude Code completed successfully (exit code 0)
- `failed`: Claude Code returned non-zero exit code or crashed
- `timeout`: Execution exceeded configured timeout limit

**Example**:
```python
result = ExecutionResult(
    request_id="a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    status="success",
    instruction="Add hello world function",
    diff="diff --git a/utils.py b/utils.py\n+def hello():\n+    return 'Hello'",
    commit_hash="abc123def456",
    files_changed=["utils.py"],
    stdout="Modified 1 file...",
    stderr="",
    error_message=None,
    execution_time=12.5,
    session_id="session-xyz",
    timestamp=datetime(2025, 11, 24, 10, 30, 0)
)
```

---

### 3. DiffInfo

Represents detailed diff information for a single file.

**Attributes**:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `file_path` | `str` | Yes | Relative path to the modified file |
| `diff_text` | `str` | Yes | Git diff output for this file (unified diff format) |
| `additions` | `int` | No | Number of lines added (0 if unavailable) |
| `deletions` | `int` | No | Number of lines deleted (0 if unavailable) |
| `status` | `Enum['added', 'modified', 'deleted', 'renamed']` | Yes | Type of change |

**Example**:
```python
diff_info = DiffInfo(
    file_path="src/utils.py",
    diff_text="@@ -10,3 +10,6 @@\n+def hello():\n+    return 'Hello'",
    additions=3,
    deletions=0,
    status="modified"
)
```

---

### 4. ToolConfig

Represents tool permission configuration (internal model for validation logic).

**Attributes**:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `allowed_tools` | `Set[str]` | Yes | Set of explicitly allowed tool names (empty = all allowed) |
| `disallowed_tools` | `Set[str]` | Yes | Set of explicitly disallowed tool names (empty = none disallowed) |
| `mode` | `Enum['whitelist', 'blacklist', 'all']` | Yes | Permission mode derived from allowed/disallowed settings |

**Mode Determination Logic**:
- `whitelist`: `allowed_tools` is non-empty, `disallowed_tools` is empty
- `blacklist`: `disallowed_tools` is non-empty, `allowed_tools` is empty
- `all`: Both `allowed_tools` and `disallowed_tools` are empty (no restrictions)

**Validation**:
- `allowed_tools` and `disallowed_tools` cannot both be non-empty (raises `ValueError`)

**Example**:
```python
# Whitelist mode: only allow Read, Write, Edit
config = ToolConfig(
    allowed_tools={"Read", "Write", "Edit"},
    disallowed_tools=set(),
    mode="whitelist"
)

# Blacklist mode: disallow Bash, WebFetch
config = ToolConfig(
    allowed_tools=set(),
    disallowed_tools={"Bash", "WebFetch"},
    mode="blacklist"
)
```

---

### 5. Session

Represents a conversation session that can be resumed across multiple executions.

**Attributes**:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `session_id` | `str` | Yes | Unique session identifier (UUID) |
| `created_at` | `datetime` | Yes | When the session was created |
| `last_accessed` | `datetime` | Yes | Last time the session was used (for expiration) |
| `conversation_history` | `List[Dict[str, str]]` | Yes | List of messages: `[{"role": "user", "content": "..."}]` |
| `status` | `Enum['active', 'completed', 'expired']` | Yes | Session lifecycle state |
| `repo_path` | `str` | Yes | Absolute path to the Git repository this session is bound to |
| `execution_count` | `int` | Yes | Number of executions in this session |

**Session Lifecycle**:
1. **active**: Session is currently usable (< 7 days old)
2. **completed**: User explicitly ended the session (not yet implemented)
3. **expired**: Session exceeded 7-day retention period (cleaned up by FR-016)

**Expiration Rules** (FR-016):
- Sessions older than 7 days (based on `last_accessed`) are automatically deleted
- Cleanup runs daily via scheduled job or on-demand via CLI command

**Example**:
```python
session = Session(
    session_id="session-abc-123",
    created_at=datetime(2025, 11, 20, 10, 0, 0),
    last_accessed=datetime(2025, 11, 24, 15, 30, 0),
    conversation_history=[
        {"role": "user", "content": "Add hello function"},
        {"role": "assistant", "content": "I've added the hello() function to utils.py"},
        {"role": "user", "content": "Now add error handling"}
    ],
    status="active",
    repo_path="/home/user/projects/myapp",
    execution_count=2
)
```

---

## Entity Relationships

```
ExecutionRequest
       |
       | (1:1 transforms into)
       v
ExecutionResult
       |
       | (1:1 belongs to)
       v
    Session
       |
       | (1:N contains)
       v
conversation_history (List of messages)

ExecutionResult
       |
       | (1:N contains)
       v
   DiffInfo (per-file diff details)

ExecutionRequest
       |
       | (1:1 validates via)
       v
   ToolConfig (derived from allowed/disallowed tools)
```

**Key Relationships**:
1. Each `ExecutionRequest` produces exactly one `ExecutionResult`
2. Each `ExecutionResult` belongs to exactly one `Session` (new or resumed)
3. Each `Session` can have multiple `ExecutionResult` records (execution history)
4. Each `ExecutionResult` can contain multiple `DiffInfo` objects (one per changed file)
5. `ToolConfig` is derived from `ExecutionRequest` fields and used for validation

---

## Persistence Mapping (SQLite)

**Note**: See `research.md` Section 5 for full SQLite schema details.

| Python Entity | SQLite Table | Notes |
|---------------|--------------|-------|
| `Session` | `sessions` | Direct 1:1 mapping |
| `ExecutionResult` | `executions` | Stores execution metadata; `diff` and `stdout` stored as TEXT blobs |
| `conversation_history` | `conversation_messages` | Each message is a separate row linked to `session_id` |
| `DiffInfo` | Not persisted | Computed on-demand from `ExecutionResult.diff` field |
| `ExecutionRequest` | Not persisted | Transient input object, only results are stored |
| `ToolConfig` | Not persisted | Transient validation object |

---

## Type Definitions (Python)

```python
from dataclasses import dataclass
from datetime import datetime
from enum import Enum
from typing import List, Optional, Set, Dict
from uuid import uuid4

class OutputFormat(str, Enum):
    TEXT = "text"
    JSON = "json"
    STREAM_JSON = "stream-json"

class ExecutionStatus(str, Enum):
    SUCCESS = "success"
    FAILED = "failed"
    TIMEOUT = "timeout"

class DirtyWorktreePolicy(str, Enum):
    BLOCK = "block"
    STASH = "stash"
    ALLOW = "allow"

class FileStatus(str, Enum):
    ADDED = "added"
    MODIFIED = "modified"
    DELETED = "deleted"
    RENAMED = "renamed"

class ToolMode(str, Enum):
    WHITELIST = "whitelist"
    BLACKLIST = "blacklist"
    ALL = "all"

class SessionStatus(str, Enum):
    ACTIVE = "active"
    COMPLETED = "completed"
    EXPIRED = "expired"

@dataclass
class ExecutionRequest:
    instruction: str
    output_format: OutputFormat = OutputFormat.TEXT
    allowed_tools: List[str] = None
    disallowed_tools: List[str] = None
    resume_session_id: Optional[str] = None
    continue_last: bool = False
    verbose: bool = False
    timeout: int = 600
    dirty_worktree: DirtyWorktreePolicy = DirtyWorktreePolicy.BLOCK
    repo_path: Optional[str] = None

@dataclass
class DiffInfo:
    file_path: str
    diff_text: str
    status: FileStatus
    additions: int = 0
    deletions: int = 0

@dataclass
class ExecutionResult:
    request_id: str
    status: ExecutionStatus
    instruction: str
    files_changed: List[str]
    stdout: str
    stderr: str
    execution_time: float
    session_id: str
    timestamp: datetime
    diff: str = ""
    commit_hash: Optional[str] = None
    error_message: Optional[str] = None
    diff_info: Optional[List[DiffInfo]] = None

@dataclass
class ToolConfig:
    allowed_tools: Set[str]
    disallowed_tools: Set[str]
    mode: ToolMode

@dataclass
class Session:
    session_id: str
    created_at: datetime
    last_accessed: datetime
    conversation_history: List[Dict[str, str]]
    status: SessionStatus
    repo_path: str
    execution_count: int = 0
```

---

## Validation Logic

### ExecutionRequest Validation

```python
def validate_execution_request(request: ExecutionRequest) -> None:
    """Raises ValueError if request is invalid."""
    if not request.instruction.strip():
        raise ValueError("Instruction cannot be empty")

    if request.timeout < 1 or request.timeout > 3600:
        raise ValueError("Timeout must be between 1 and 3600 seconds")

    if request.allowed_tools and request.disallowed_tools:
        raise ValueError("Cannot specify both allowed_tools and disallowed_tools")

    if request.resume_session_id and request.continue_last:
        raise ValueError("Cannot use both resume_session_id and continue_last")
```

### ToolConfig Derivation

```python
def create_tool_config(request: ExecutionRequest) -> ToolConfig:
    """Derive ToolConfig from ExecutionRequest."""
    allowed = set(request.allowed_tools or [])
    disallowed = set(request.disallowed_tools or [])

    if allowed and disallowed:
        raise ValueError("Invalid tool configuration")

    if allowed:
        mode = ToolMode.WHITELIST
    elif disallowed:
        mode = ToolMode.BLACKLIST
    else:
        mode = ToolMode.ALL

    return ToolConfig(
        allowed_tools=allowed,
        disallowed_tools=disallowed,
        mode=mode
    )
```

---

## Design Notes

1. **Immutability**: All dataclasses use `@dataclass(frozen=False)` to allow mutation during execution (e.g., updating `last_accessed` on Session)

2. **ID Generation**: Use `uuid4()` for `request_id` and `session_id` to ensure global uniqueness

3. **Timestamp Format**: All timestamps stored as `datetime` objects, serialized to ISO 8601 strings in JSON output

4. **Diff Storage**: Large diffs stored as single TEXT blobs in SQLite; per-file `DiffInfo` computed on-demand to reduce storage overhead

5. **Foreign Key Policy**: Per global instruction, SQLite foreign key constraints are disabled, but logical relationships are maintained via application-level cascade deletes (see `research.md` Section 5)
