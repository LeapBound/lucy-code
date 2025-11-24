# Technical Research: Claude Code Executor

**Feature**: Claude Code Executor | **Branch**: `001-cc-executor` | **Date**: 2025-11-24

This document captures key technical decisions and research findings that inform the implementation plan.

## 1. File Locking Library Choice

**Decision**: Use `filelock` library

**Options Evaluated**:

| Library | Cross-Platform | API Simplicity | Timeout Support | Verdict |
|---------|---------------|----------------|-----------------|---------|
| **filelock** | ✅ Yes (Windows/Linux/macOS) | ✅ Simple context manager | ✅ Yes | **SELECTED** |
| portalocker | ✅ Yes | ⚠️ More complex API | ✅ Yes | Rejected (overkill) |
| fcntl | ❌ Unix only | ✅ Simple | ⚠️ Manual timeout | Rejected (not cross-platform) |

**Rationale**:
- FR-017 requires cross-platform support (Windows/Linux/macOS)
- `filelock` provides simple context manager API: `with FileLock("repo.lock", timeout=300):`
- Built-in timeout support aligns with 5-minute queue timeout requirement
- Widely adopted (13k+ GitHub stars), actively maintained

**Implementation Pattern**:
```python
from filelock import FileLock, Timeout

lock_path = repo_root / ".claude_executor.lock"
try:
    with FileLock(lock_path, timeout=300):  # 5 min default
        # Execute Claude Code subprocess
        pass
except Timeout:
    raise ConcurrentExecutionError("Another execution in progress")
```

## 2. Tool Interception Mechanism

**Decision**: Environment variables + stderr parsing (no native hook support)

**Challenge**: Claude Code CLI does not natively support tool restrictions via command-line flags.

**Options Evaluated**:

| Approach | Feasibility | Enforcement Level | Implementation Complexity | Verdict |
|----------|------------|-------------------|---------------------------|---------|
| **Env vars + stderr parsing** | ✅ Immediate | ⚠️ Advisory only | Low | **SELECTED (Phase 1)** |
| MCP protocol extension | ❌ Requires Claude Code changes | ✅ Strong | Very High | Future work |
| Subprocess wrapper | ⚠️ Brittle (version-dependent) | ⚠️ Fragile | High | Rejected |

**Rationale**:
- FR-006 requires tool control, but strict enforcement requires Claude Code cooperation
- **Phase 1 (MVP)**: Pass env vars (`CLAUDE_ALLOWED_TOOLS`, `CLAUDE_DISALLOWED_TOOLS`) and parse stderr for violations
- **Phase 2 (Future)**: If Claude Code adds MCP-based tool restrictions, integrate native enforcement
- Advisory model still provides value: logs tool usage violations for audit (FR-015)

**Implementation Pattern**:
```python
env = os.environ.copy()
if allowed_tools:
    env['CLAUDE_ALLOWED_TOOLS'] = ','.join(allowed_tools)
if disallowed_tools:
    env['CLAUDE_DISALLOWED_TOOLS'] = ','.join(disallowed_tools)

process = subprocess.Popen(['claude', '-p', instruction], env=env, ...)
# Parse stderr for tool usage patterns, log violations
```

**Limitation Acknowledged**: This does not *prevent* tool usage, only *detects and logs* it. Spec will be updated to reflect advisory nature for Phase 1.

## 3. CLI Framework

**Decision**: Use `click` library

**Options Evaluated**:

| Framework | Learning Curve | Argument Parsing | Help Generation | Verdict |
|-----------|---------------|------------------|-----------------|---------|
| **click** | Low | ✅ Decorators, clean | ✅ Auto-generated | **SELECTED** |
| argparse | None (stdlib) | ⚠️ Verbose boilerplate | ⚠️ Manual | Rejected (maintainability) |
| typer | Low | ✅ Type hints | ✅ Auto-generated | Rejected (adds FastAPI dep) |

**Rationale**:
- FR-013 requires 9+ CLI arguments, click reduces boilerplate significantly
- Auto-generated help text improves usability (Principle V: Observability)
- Decorator syntax aligns with Python conventions
- No unnecessary dependencies (typer pulls in FastAPI ecosystem)

**Implementation Pattern**:
```python
import click

@click.command()
@click.option('--instruction', required=True, help='Task instruction for Claude Code')
@click.option('--output-format', type=click.Choice(['text', 'json', 'stream-json']), default='text')
@click.option('--timeout', type=int, default=600, help='Execution timeout in seconds')
# ... 6 more options
def main(**kwargs):
    result = execute_instruction(ExecutionRequest(**kwargs))
    print(format_output(result, kwargs['output_format']))
```

## 4. Subprocess Timeout Handling

**Decision**: Use `subprocess.run(timeout=...)` with SIGTERM/SIGKILL escalation

**Best Practices Applied**:

1. **Timeout Mechanism** (FR-011):
   - Use `subprocess.run(timeout=timeout_seconds)` to automatically raise `TimeoutExpired`
   - Catch exception and return `ExecutionResult(status='timeout')`

2. **Graceful Shutdown**:
   - On timeout, send SIGTERM first (allow Claude Code to cleanup)
   - Wait 5 seconds, then SIGKILL if still running
   - Capture partial stdout/stderr before termination

3. **Zombie Process Prevention**:
   - Always call `process.wait()` or `process.communicate()` even on timeout
   - Use context managers where possible

**Implementation Pattern**:
```python
try:
    result = subprocess.run(
        ['claude', '-p', instruction],
        timeout=timeout,
        capture_output=True,
        text=True,
        check=False  # Don't raise on non-zero exit
    )
except subprocess.TimeoutExpired as e:
    return ExecutionResult(
        status='timeout',
        stdout=e.stdout.decode() if e.stdout else '',
        stderr=e.stderr.decode() if e.stderr else '',
        error_message=f'Execution exceeded {timeout}s timeout'
    )
```

## 5. SQLite Session Storage Schema

**Decision**: Three-table design with foreign key relationships (note: actual SQLite FK constraints disabled per global policy)

**Schema Design**:

```sql
-- Session metadata
CREATE TABLE sessions (
    session_id TEXT PRIMARY KEY,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_accessed TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    status TEXT CHECK(status IN ('active', 'completed', 'expired')),
    repo_path TEXT NOT NULL
);

-- Execution history
CREATE TABLE executions (
    execution_id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,  -- FK to sessions (not enforced)
    instruction TEXT NOT NULL,
    status TEXT CHECK(status IN ('success', 'failed', 'timeout')),
    commit_hash TEXT,
    execution_time REAL,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Conversation history (for resume)
CREATE TABLE conversation_messages (
    message_id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,  -- FK to sessions (not enforced)
    role TEXT CHECK(role IN ('user', 'assistant')),
    content TEXT NOT NULL,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for performance
CREATE INDEX idx_sessions_last_accessed ON sessions(last_accessed);
CREATE INDEX idx_executions_session ON executions(session_id);
CREATE INDEX idx_messages_session ON conversation_messages(session_id);
```

**Design Rationale**:
- FR-008/FR-009: Support session resume with conversation history
- FR-016: `last_accessed` column enables 7-day expiration cleanup
- FR-015: Execution audit trail stored in `executions` table
- Global policy: No FK constraints, but logical relationships documented

**Cleanup Strategy** (FR-016):
```python
def cleanup_expired_sessions(db_path, days=7):
    cutoff = datetime.now() - timedelta(days=days)
    with sqlite3.connect(db_path) as conn:
        # Delete expired sessions and cascade manually
        conn.execute("DELETE FROM conversation_messages WHERE session_id IN (SELECT session_id FROM sessions WHERE last_accessed < ?)", (cutoff,))
        conn.execute("DELETE FROM executions WHERE session_id IN (SELECT session_id FROM sessions WHERE last_accessed < ?)", (cutoff,))
        conn.execute("DELETE FROM sessions WHERE last_accessed < ?", (cutoff,))
```

## 6. Git Diff Extraction Strategies

**Decision**: Use GitPython library with three-phase diff extraction

**Challenge**: FR-003 requires capturing "staged, unstaged, and recent commit" diffs

**Extraction Strategy**:

```python
from git import Repo

def extract_diffs(repo_path) -> Dict[str, DiffInfo]:
    repo = Repo(repo_path)
    diffs = {}

    # 1. Unstaged changes (working tree vs index)
    for diff in repo.index.diff(None):
        diffs[diff.a_path] = DiffInfo(
            file_path=diff.a_path,
            diff_text=diff.diff.decode(),
            status='modified'
        )

    # 2. Staged changes (index vs HEAD)
    for diff in repo.index.diff('HEAD'):
        diffs[diff.a_path] = DiffInfo(
            file_path=diff.a_path,
            diff_text=diff.diff.decode(),
            status='modified'
        )

    # 3. Latest commit (HEAD vs HEAD~1)
    if len(list(repo.iter_commits('HEAD', max_count=2))) > 1:
        for diff in repo.head.commit.diff('HEAD~1'):
            diffs[diff.a_path] = DiffInfo(
                file_path=diff.a_path,
                diff_text=diff.diff.decode(),
                additions=diff.stats['insertions'],
                deletions=diff.stats['deletions'],
                status='added' if diff.new_file else 'modified'
            )

    return diffs
```

**Edge Cases Handled**:
- Initial commit (no HEAD~1): Skip commit diff
- Large diffs (SC-002): GitPython streams diffs lazily, avoiding full load
- Binary files: GitPython marks them, skip diff_text generation

**Performance Considerations**:
- GitPython uses libgit2 (C library), handles 10MB diffs efficiently (SC-002 requirement)
- Lazy loading prevents memory overflow on large repositories

## Key Decisions Summary

| Area | Decision | Rationale |
|------|----------|-----------|
| File Locking | `filelock` library | Cross-platform, simple API, built-in timeouts |
| Tool Control | Env vars + stderr parsing | Immediate implementable, advisory model (future: MCP) |
| CLI Framework | `click` | Low boilerplate, auto-help, no excess dependencies |
| Subprocess Timeout | stdlib `subprocess.run(timeout=...)` | Built-in, Pythonic, handles SIGTERM/SIGKILL |
| Session Storage | SQLite 3-table schema | Relational fit, 7-day cleanup, audit trail |
| Git Diff | GitPython 3-phase extraction | Lazy loading, handles large diffs, covers all change types |

## Unresolved Questions (None)

All clarifications from spec.md Clarifications session have been incorporated into these decisions.
