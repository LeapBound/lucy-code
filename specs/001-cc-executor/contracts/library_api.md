# Library API Contract

**Feature**: Claude Code Executor | **Branch**: `001-cc-executor` | **Date**: 2025-11-24

This document defines the public Python library interface for the Claude Code Executor.

## Module: `cc_executor`

### Public Function: `execute_instruction`

The primary entry point for executing Claude Code instructions programmatically.

**Signature**:
```python
def execute_instruction(
    request: ExecutionRequest,
    *,
    lock_timeout: int = 300
) -> ExecutionResult:
    """
    Execute a Claude Code instruction and return structured results.

    Args:
        request: ExecutionRequest object containing instruction and configuration
        lock_timeout: Maximum seconds to wait for repository lock (default: 300)

    Returns:
        ExecutionResult object containing execution outcome, diffs, and metadata

    Raises:
        ValueError: If request validation fails
        ClaudeCodeNotFoundError: If 'claude' command not found in PATH
        RepositoryNotFoundError: If repo_path is not a valid Git repository
        DirtyWorktreeError: If dirty_worktree='block' and uncommitted changes exist
        ConcurrentExecutionError: If another execution is in progress and lock times out
        ExecutionTimeoutError: If Claude Code execution exceeds request.timeout
        GitError: If Git operations fail (e.g., diff extraction)

    Example:
        >>> request = ExecutionRequest(
        ...     instruction="Add hello world function",
        ...     output_format=OutputFormat.JSON,
        ...     timeout=300
        ... )
        >>> result = execute_instruction(request)
        >>> print(result.status)
        ExecutionStatus.SUCCESS
    """
```

**Functional Requirements Covered**:
- FR-001: Invoke `claude -p` with instruction
- FR-002: Capture stdout/stderr
- FR-003: Extract Git diffs (staged/unstaged/commit)
- FR-005: Return structured ExecutionResult
- FR-006: Apply tool restrictions via env vars
- FR-007: Support verbose logging
- FR-008/FR-009: Session resume/continue
- FR-010: Error handling (raises specific exceptions)
- FR-011: Timeout mechanism
- FR-012: Dirty worktree validation
- FR-017: File-lock concurrency control

---

## Exception Hierarchy

All custom exceptions inherit from `CCExecutorError` base class.

```python
class CCExecutorError(Exception):
    """Base exception for all cc_executor errors."""
    pass

class ClaudeCodeNotFoundError(CCExecutorError):
    """Raised when 'claude' command not found in PATH."""
    def __init__(self):
        super().__init__(
            "Claude Code CLI not found. Install from https://claude.ai/download"
        )

class RepositoryNotFoundError(CCExecutorError):
    """Raised when repo_path is not a valid Git repository."""
    def __init__(self, path: str):
        super().__init__(f"Not a Git repository: {path}")

class DirtyWorktreeError(CCExecutorError):
    """Raised when dirty_worktree='block' and uncommitted changes exist."""
    def __init__(self, files: List[str]):
        super().__init__(
            f"Working tree has uncommitted changes in {len(files)} file(s). "
            f"Use --dirty-worktree=allow or commit changes first."
        )

class ConcurrentExecutionError(CCExecutorError):
    """Raised when file lock acquisition times out."""
    def __init__(self, timeout: int):
        super().__init__(
            f"Another execution is in progress. Lock timeout after {timeout}s."
        )

class ExecutionTimeoutError(CCExecutorError):
    """Raised when Claude Code execution exceeds timeout."""
    def __init__(self, timeout: int):
        super().__init__(f"Execution exceeded {timeout}s timeout")

class GitError(CCExecutorError):
    """Raised when Git operations fail."""
    def __init__(self, operation: str, message: str):
        super().__init__(f"Git {operation} failed: {message}")

class SessionNotFoundError(CCExecutorError):
    """Raised when resume_session_id does not exist."""
    def __init__(self, session_id: str):
        super().__init__(f"Session not found: {session_id}")
```

---

## Session Management Functions

### `get_session`

Retrieve a session by ID.

**Signature**:
```python
def get_session(session_id: str) -> Optional[Session]:
    """
    Retrieve session by ID from SQLite database.

    Args:
        session_id: Unique session identifier

    Returns:
        Session object if found and not expired, None otherwise
    """
```

---

### `list_sessions`

List all active sessions.

**Signature**:
```python
def list_sessions(
    repo_path: Optional[str] = None,
    include_expired: bool = False
) -> List[Session]:
    """
    List sessions, optionally filtered by repository.

    Args:
        repo_path: Filter by repository path (None = all repos)
        include_expired: Include expired sessions (default: False)

    Returns:
        List of Session objects sorted by last_accessed (newest first)
    """
```

---

### `cleanup_expired_sessions`

Manually trigger session cleanup.

**Signature**:
```python
def cleanup_expired_sessions(days: int = 7) -> int:
    """
    Delete sessions older than specified days.

    Args:
        days: Sessions older than this are deleted (default: 7)

    Returns:
        Number of sessions deleted

    Raises:
        ValueError: If days < 1
    """
```

---

## Configuration

### Environment Variables

The library respects these environment variables:

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `CC_EXECUTOR_DB_PATH` | `str` | `~/.cc_executor/sessions.db` | SQLite database location |
| `CC_EXECUTOR_LOG_LEVEL` | `str` | `INFO` | Logging level (DEBUG/INFO/WARNING/ERROR) |
| `CC_EXECUTOR_DEFAULT_TIMEOUT` | `int` | `600` | Default execution timeout in seconds |

---

## Data Model Imports

All data models are importable from the main module:

```python
from cc_executor import (
    # Main function
    execute_instruction,

    # Data models
    ExecutionRequest,
    ExecutionResult,
    DiffInfo,
    ToolConfig,
    Session,

    # Enums
    OutputFormat,
    ExecutionStatus,
    DirtyWorktreePolicy,
    FileStatus,
    ToolMode,
    SessionStatus,

    # Exceptions
    CCExecutorError,
    ClaudeCodeNotFoundError,
    RepositoryNotFoundError,
    DirtyWorktreeError,
    ConcurrentExecutionError,
    ExecutionTimeoutError,
    GitError,
    SessionNotFoundError,

    # Session management
    get_session,
    list_sessions,
    cleanup_expired_sessions,
)
```

---

## Usage Examples

### Basic Execution

```python
from cc_executor import execute_instruction, ExecutionRequest

# Simple text output
request = ExecutionRequest(instruction="Add hello world function")
result = execute_instruction(request)
print(result.diff)
```

### JSON Output with Tool Restrictions

```python
from cc_executor import execute_instruction, ExecutionRequest, OutputFormat

request = ExecutionRequest(
    instruction="Refactor user authentication logic",
    output_format=OutputFormat.JSON,
    allowed_tools=["Read", "Write", "Edit"],  # No Bash/WebFetch
    timeout=300,
    verbose=True
)

result = execute_instruction(request)
if result.status == "success":
    print(f"Modified {len(result.files_changed)} files")
else:
    print(f"Error: {result.error_message}")
```

### Session Resume

```python
from cc_executor import execute_instruction, ExecutionRequest

# First execution
request1 = ExecutionRequest(instruction="Create user model")
result1 = execute_instruction(request1)
session_id = result1.session_id

# Continue conversation
request2 = ExecutionRequest(
    instruction="Now add validation to the user model",
    resume_session_id=session_id
)
result2 = execute_instruction(request2)
```

### Error Handling

```python
from cc_executor import (
    execute_instruction,
    ExecutionRequest,
    ClaudeCodeNotFoundError,
    DirtyWorktreeError,
    ConcurrentExecutionError
)

try:
    request = ExecutionRequest(instruction="Fix bug in auth.py")
    result = execute_instruction(request, lock_timeout=60)
except ClaudeCodeNotFoundError:
    print("Please install Claude Code CLI")
except DirtyWorktreeError as e:
    print(f"Uncommitted changes detected: {e}")
except ConcurrentExecutionError:
    print("Another execution is running, try again later")
```

---

## Thread Safety

**Warning**: The library is **not thread-safe** within a single process. File locks prevent conflicts across processes, but concurrent calls to `execute_instruction()` from multiple threads in the same process may cause race conditions.

**Recommendation**: Use process-level parallelism (e.g., `multiprocessing`) instead of thread-level parallelism.

---

## Testing Contract

Contract tests validate all scenarios in `tests/contract/test_library_api.py`:

1. **Successful execution** (FR-001, FR-002, FR-003, FR-005)
2. **JSON output format** (FR-004)
3. **Tool restrictions** (FR-006)
4. **Verbose logging** (FR-007)
5. **Session resume** (FR-008)
6. **Continue last session** (FR-009)
7. **Timeout handling** (FR-011)
8. **Dirty worktree policies** (FR-012: block/stash/allow)
9. **Concurrency control** (FR-017)
10. **All exception types** (FR-010)

Each test validates:
- Correct return type
- Required fields populated
- Error messages are actionable
- No memory leaks on large diffs (SC-002)
