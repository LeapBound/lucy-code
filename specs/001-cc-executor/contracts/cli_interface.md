# CLI Interface Contract

**Feature**: Claude Code Executor | **Branch**: `001-cc-executor` | **Date**: 2025-11-24

This document defines the command-line interface contract for the Claude Code Executor.

## Command: `cc-executor`

The CLI entry point that wraps the Python library for terminal usage.

### Synopsis

```bash
cc-executor [OPTIONS]
```

---

## Options (FR-013)

### Required Arguments

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `--instruction TEXT` | `str` | **Yes** | Instruction to pass to Claude Code |

### Output Configuration

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `--output-format [text\|json\|stream-json]` | `Choice` | `text` | Output format for results |
| `--verbose` | `Flag` | `False` | Enable detailed execution logs |

### Tool Restrictions (FR-006)

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `--allowed-tools TEXT` | `str` | `None` | Comma-separated list of allowed tools (whitelist mode) |
| `--disallowed-tools TEXT` | `str` | `None` | Comma-separated list of disallowed tools (blacklist mode) |

**Validation**: Cannot use both `--allowed-tools` and `--disallowed-tools` simultaneously (exits with code 2).

**Example**:
```bash
# Whitelist mode
cc-executor --instruction "Refactor utils" --allowed-tools "Read,Write,Edit"

# Blacklist mode
cc-executor --instruction "Fix bug" --disallowed-tools "Bash,WebFetch"
```

### Session Management (FR-008/FR-009)

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `--resume TEXT` | `str` | `None` | Resume conversation from session ID |
| `--continue` | `Flag` | `False` | Continue last session automatically |

**Validation**: Cannot use both `--resume` and `--continue` simultaneously (exits with code 2).

**Example**:
```bash
# Resume specific session
cc-executor --instruction "Add tests" --resume "session-abc-123"

# Continue last session
cc-executor --instruction "Now add docs" --continue
```

### Execution Control

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `--timeout INTEGER` | `int` | `600` | Execution timeout in seconds (max: 3600) |
| `--dirty-worktree [block\|stash\|allow]` | `Choice` | `block` | How to handle uncommitted Git changes |
| `--repo-path PATH` | `str` | `CWD` | Path to Git repository (defaults to current directory) |

**Example**:
```bash
# Allow execution on dirty worktree
cc-executor --instruction "Quick fix" --dirty-worktree allow --timeout 300
```

---

## Exit Codes

The CLI uses these exit codes for programmatic parsing:

| Code | Name | Description |
|------|------|-------------|
| `0` | **SUCCESS** | Execution completed successfully (ExecutionStatus.SUCCESS) |
| `1` | **EXECUTION_FAILED** | Claude Code execution failed or crashed (ExecutionStatus.FAILED) |
| `2` | **INVALID_ARGUMENTS** | Invalid CLI arguments (validation failed) |
| `3` | **CLAUDE_NOT_FOUND** | Claude Code CLI not installed or not in PATH |
| `4` | **REPOSITORY_ERROR** | Not a Git repository or Git operation failed |
| `5` | **DIRTY_WORKTREE** | Uncommitted changes detected (dirty_worktree=block) |
| `6` | **CONCURRENT_EXECUTION** | Another execution in progress (lock timeout) |
| `7` | **TIMEOUT** | Execution exceeded timeout limit (ExecutionStatus.TIMEOUT) |
| `8` | **SESSION_NOT_FOUND** | Requested session ID does not exist or expired |
| `99` | **INTERNAL_ERROR** | Unexpected error (bug in cc_executor) |

**Usage in Scripts**:
```bash
cc-executor --instruction "Deploy to prod" --timeout 1800
if [ $? -eq 0 ]; then
    echo "Deployment successful"
elif [ $? -eq 7 ]; then
    echo "Deployment timed out"
else
    echo "Deployment failed"
fi
```

---

## Output Formats

### Text Format (Default)

Human-readable output for terminal usage.

**Example**:
```
=== Claude Code Execution Result ===
Status: SUCCESS
Execution Time: 12.5s
Session ID: session-abc-123

Files Changed (2):
  - src/utils.py (modified)
  - tests/test_utils.py (added)

Commit: abc123def456

Diff:
diff --git a/src/utils.py b/src/utils.py
+def hello():
+    return "Hello World"

Stdout:
Modified 1 file, added 1 test file.

Stderr:
(none)
```

### JSON Format

Machine-parseable structured output.

**Schema**:
```json
{
  "request_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "status": "success",
  "instruction": "Add hello world function",
  "diff": "diff --git a/src/utils.py...",
  "commit_hash": "abc123def456",
  "files_changed": ["src/utils.py", "tests/test_utils.py"],
  "stdout": "Modified 1 file...",
  "stderr": "",
  "error_message": null,
  "execution_time": 12.5,
  "session_id": "session-abc-123",
  "timestamp": "2025-11-24T10:30:00Z"
}
```

**Example**:
```bash
cc-executor --instruction "Fix bug" --output-format json | jq '.status'
# Output: "success"
```

### Stream-JSON Format

Line-delimited JSON (NDJSON) for streaming progress updates.

**Format**:
```json
{"type": "progress", "message": "Starting Claude Code...", "timestamp": "2025-11-24T10:30:00Z"}
{"type": "progress", "message": "Executing instruction...", "timestamp": "2025-11-24T10:30:05Z"}
{"type": "result", "data": {"status": "success", "execution_time": 12.5, ...}}
```

**Use Case**: Long-running executions where progress feedback is desired.

---

## Environment Variables

The CLI respects these environment variables (same as library):

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `CC_EXECUTOR_DB_PATH` | `str` | `~/.cc_executor/sessions.db` | SQLite database location |
| `CC_EXECUTOR_LOG_LEVEL` | `str` | `INFO` | Logging level (DEBUG/INFO/WARNING/ERROR) |
| `CC_EXECUTOR_DEFAULT_TIMEOUT` | `int` | `600` | Default execution timeout in seconds |

**Example**:
```bash
export CC_EXECUTOR_LOG_LEVEL=DEBUG
cc-executor --instruction "Debug issue" --verbose
```

---

## Configuration File (Future Work)

Not implemented in Phase 1. Future versions may support `~/.cc_executor/config.yaml` for defaults.

---

## Usage Examples

### Example 1: Basic Execution (User Story P1)

```bash
cc-executor --instruction "Add a hello world function to utils.py"
```

**Expected Output** (text format):
```
=== Claude Code Execution Result ===
Status: SUCCESS
Execution Time: 8.2s
...
```

**Exit Code**: `0`

---

### Example 2: JSON Output (User Story P2)

```bash
cc-executor --instruction "Refactor authentication logic" --output-format json
```

**Expected Output** (JSON):
```json
{
  "status": "success",
  "files_changed": ["src/auth.py", "tests/test_auth.py"],
  ...
}
```

**Exit Code**: `0`

---

### Example 3: Tool Restrictions (User Story P3)

```bash
cc-executor \
  --instruction "Fix security vulnerability" \
  --allowed-tools "Read,Write,Edit" \
  --output-format json
```

**Expected Behavior**:
- Claude Code receives env vars `CLAUDE_ALLOWED_TOOLS=Read,Write,Edit`
- If Bash tool is used, violation logged in output (advisory mode)

**Exit Code**: `0` (even if tool violations detected, advisory only)

---

### Example 4: Session Resume (User Story P4)

```bash
# First execution
cc-executor --instruction "Create user model" --output-format json > result1.json
SESSION_ID=$(jq -r '.session_id' result1.json)

# Continue conversation
cc-executor --instruction "Add validation to user model" --resume "$SESSION_ID"
```

**Expected Behavior**:
- Second execution has context from first execution
- Same session_id in both results

**Exit Code**: `0`

---

### Example 5: Timeout Handling

```bash
cc-executor --instruction "Complex refactoring task" --timeout 60
```

**Expected Output** (if timeout):
```
=== Claude Code Execution Result ===
Status: TIMEOUT
Execution Time: 60.0s
Error: Execution exceeded 60s timeout
...
```

**Exit Code**: `7` (TIMEOUT)

---

### Example 6: Dirty Worktree Handling

```bash
# Block on dirty worktree (default)
cc-executor --instruction "Deploy to prod"
```

**Expected Output** (if uncommitted changes):
```
Error: Working tree has uncommitted changes in 3 file(s).
Use --dirty-worktree=allow or commit changes first.
```

**Exit Code**: `5` (DIRTY_WORKTREE)

**Alternative**:
```bash
# Allow execution on dirty worktree
cc-executor --instruction "Quick fix" --dirty-worktree allow
```

**Exit Code**: `0` (proceeds with execution)

---

## Help Text

Running `cc-executor --help` displays:

```
Usage: cc-executor [OPTIONS]

  Execute Claude Code instructions and capture structured results.

Options:
  --instruction TEXT              Instruction to pass to Claude Code [required]
  --output-format [text|json|stream-json]
                                  Output format for results  [default: text]
  --verbose                       Enable detailed execution logs
  --allowed-tools TEXT            Comma-separated list of allowed tools
  --disallowed-tools TEXT         Comma-separated list of disallowed tools
  --resume TEXT                   Resume conversation from session ID
  --continue                      Continue last session automatically
  --timeout INTEGER               Execution timeout in seconds  [default: 600]
  --dirty-worktree [block|stash|allow]
                                  Handle uncommitted Git changes  [default: block]
  --repo-path PATH                Path to Git repository  [default: current directory]
  --help                          Show this message and exit.

Examples:
  cc-executor --instruction "Add hello world function"
  cc-executor --instruction "Fix bug" --output-format json
  cc-executor --instruction "Refactor" --allowed-tools "Read,Write,Edit"

Exit Codes:
  0 = Success, 1 = Execution failed, 2 = Invalid arguments, 3 = Claude not found,
  4 = Repository error, 5 = Dirty worktree, 6 = Concurrent execution,
  7 = Timeout, 8 = Session not found, 99 = Internal error

Documentation: https://github.com/yourorg/lucy-code/specs/001-cc-executor
```

---

## Testing Contract

Contract tests validate all CLI scenarios in `tests/contract/test_cli_interface.py`:

1. **All 9 CLI options** parse correctly (FR-013)
2. **Exit codes** match specification for each error type
3. **Output formats** (text/JSON/stream-JSON) are valid and parseable (FR-004)
4. **Help text** displays correctly
5. **Environment variable overrides** work as expected
6. **Mutual exclusion** validation (allowed/disallowed tools, resume/continue)
7. **Large output handling** (SC-002: 10MB diff does not crash CLI)
8. **Special character handling** (quotes, newlines, emoji in instruction)

Each test uses subprocess to invoke CLI and validates:
- Exit code
- Output format structure
- Stderr for errors
- No shell injection vulnerabilities (FR-006 security requirement)
