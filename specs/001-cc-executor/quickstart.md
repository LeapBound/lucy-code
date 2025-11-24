# Quickstart Guide: Claude Code Executor

**Feature**: Claude Code Executor | **Branch**: `001-cc-executor` | **Date**: 2025-11-24

Get started with the Claude Code Executor in 5 minutes.

---

## Prerequisites

1. **Python 3.11+** installed
2. **Claude Code CLI** installed and in PATH
   - Verify: `claude --version` should print version info
   - Install from: https://claude.ai/download
3. **Git** installed and repository initialized
   - Verify: `git --version`
   - Initialize: `git init` (if needed)

---

## Installation

### Option 1: Install from PyPI (when published)

```bash
pip install cc-executor
```

### Option 2: Install from Source

```bash
# Clone the repository
git clone https://github.com/yourorg/lucy-code.git
cd lucy-code

# Install in development mode
pip install -e .
```

### Verify Installation

```bash
cc-executor --help
```

You should see the help text with available options.

---

## Basic Usage (P1: Basic Task Execution)

### 1. Execute a Simple Instruction

Run a single instruction and view the results:

```bash
cc-executor --instruction "Add a hello world function to utils.py"
```

**Expected Output**:
```
=== Claude Code Execution Result ===
Status: SUCCESS
Execution Time: 8.2s
Session ID: session-abc-123

Files Changed (1):
  - src/utils.py (modified)

Commit: abc123def456

Diff:
diff --git a/src/utils.py b/src/utils.py
index 1234567..abcdefg 100644
--- a/src/utils.py
+++ b/src/utils.py
@@ -1,3 +1,6 @@
 # Utility functions
+
+def hello():
+    return "Hello World"
```

**What Happened**:
1. Claude Code was invoked with your instruction
2. It modified `src/utils.py` to add the function
3. Changes were committed to Git
4. Results (diff, commit hash, execution time) were captured and displayed

---

### 2. Check Git History

Verify the commit was created:

```bash
git log -1 --oneline
```

**Output**:
```
abc123d Add hello world function (via Claude Code)
```

---

## JSON Output (P2: Structured Output)

For programmatic use, request JSON output:

```bash
cc-executor --instruction "Refactor authentication logic" --output-format json
```

**Output** (formatted for readability):
```json
{
  "request_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "status": "success",
  "instruction": "Refactor authentication logic",
  "diff": "diff --git a/src/auth.py b/src/auth.py\n...",
  "commit_hash": "def456abc789",
  "files_changed": ["src/auth.py", "tests/test_auth.py"],
  "stdout": "Refactored authentication...",
  "stderr": "",
  "error_message": null,
  "execution_time": 15.3,
  "session_id": "session-xyz-789",
  "timestamp": "2025-11-24T10:30:00Z"
}
```

### Parse JSON in Scripts

Extract specific fields using `jq`:

```bash
# Get commit hash
cc-executor --instruction "Fix bug" --output-format json | jq -r '.commit_hash'

# Check if successful
RESULT=$(cc-executor --instruction "Deploy" --output-format json)
if [ $(echo "$RESULT" | jq -r '.status') = "success" ]; then
    echo "Deployment successful!"
fi
```

---

## Tool Restrictions (P3: Tool Permission Control)

Restrict which tools Claude Code can use for security.

### Whitelist Mode (Only Allow Specific Tools)

```bash
cc-executor \
  --instruction "Fix security vulnerability in auth.py" \
  --allowed-tools "Read,Write,Edit"
```

**Effect**: Claude Code can only use `Read`, `Write`, and `Edit` tools. Cannot use `Bash`, `WebFetch`, etc.

### Blacklist Mode (Block Specific Tools)

```bash
cc-executor \
  --instruction "Refactor utils.py" \
  --disallowed-tools "Bash,WebFetch"
```

**Effect**: Claude Code can use all tools except `Bash` and `WebFetch`.

### Important Note

Tool restrictions are **advisory** in Phase 1. The CLI passes restrictions via environment variables and logs violations, but cannot enforce them at the system level. Future versions will integrate native enforcement when Claude Code supports it.

---

## Session Resume (P4: Multi-Turn Conversations)

Continue a conversation across multiple executions.

### Step 1: First Execution

```bash
cc-executor --instruction "Create a user model with name and email fields" --output-format json > result1.json
```

### Step 2: Extract Session ID

```bash
SESSION_ID=$(jq -r '.session_id' result1.json)
echo "Session ID: $SESSION_ID"
```

### Step 3: Resume Conversation

```bash
cc-executor --instruction "Now add email validation to the user model" --resume "$SESSION_ID"
```

**Effect**: Claude Code has context from the first execution and can reference the previously created user model.

### Alternative: Continue Last Session

Skip session ID extraction by using `--continue`:

```bash
# First execution
cc-executor --instruction "Create user model"

# Continue last session automatically
cc-executor --instruction "Add validation" --continue
```

---

## Configuration Options

### Set Execution Timeout

Limit how long Claude Code can run (default: 600 seconds = 10 minutes):

```bash
cc-executor --instruction "Complex refactoring" --timeout 300
```

If execution exceeds 300 seconds, it will be terminated and status set to `timeout`.

---

### Handle Dirty Working Tree

By default, execution is **blocked** if you have uncommitted changes:

```bash
# Make some uncommitted changes
echo "test" >> temp.txt

# Try to execute (will fail)
cc-executor --instruction "Fix bug"
```

**Output**:
```
Error: Working tree has uncommitted changes in 1 file(s).
Use --dirty-worktree=allow or commit changes first.
```

**Options**:

1. **block** (default): Refuse to execute
2. **allow**: Execute anyway (changes may conflict)
3. **stash**: Automatically stash changes before execution

```bash
# Allow execution despite uncommitted changes
cc-executor --instruction "Quick fix" --dirty-worktree allow
```

---

### Enable Verbose Logging

See detailed execution logs (useful for debugging):

```bash
cc-executor --instruction "Debug issue" --verbose
```

**Additional Output**:
```
[DEBUG] Acquiring repository lock...
[DEBUG] Lock acquired: /path/to/repo/.claude_executor.lock
[DEBUG] Executing: claude -p "Debug issue"
[DEBUG] Claude Code stdout: Starting analysis...
[INFO] Execution completed in 12.5s
[DEBUG] Extracting Git diffs...
```

---

### Specify Repository Path

Execute on a different repository (default: current directory):

```bash
cc-executor \
  --instruction "Add tests" \
  --repo-path /path/to/other/repo
```

---

## Common Workflows

### Workflow 1: Automated Code Review Fix

```bash
# Get PR feedback from GitHub (via gh CLI)
FEEDBACK=$(gh pr view 123 --json comments -q '.comments[].body')

# Ask Claude Code to address feedback
cc-executor --instruction "Address the following PR feedback: $FEEDBACK"
```

---

### Workflow 2: Batch Refactoring with Session

```bash
# Start a refactoring session
cc-executor --instruction "Refactor authentication to use JWT" > result1.txt
SESSION=$(grep "Session ID:" result1.txt | awk '{print $3}')

# Continue with related changes
cc-executor --instruction "Update tests for new JWT auth" --resume "$SESSION"
cc-executor --instruction "Add migration script for existing users" --resume "$SESSION"
```

---

### Workflow 3: CI/CD Integration

```yaml
# .github/workflows/ai-fixes.yml
name: AI Auto-Fix
on: [pull_request]

jobs:
  ai-fix:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Install Claude Code Executor
        run: pip install cc-executor

      - name: Run AI fixes
        run: |
          cc-executor \
            --instruction "Fix linting errors reported by CI" \
            --output-format json \
            --allowed-tools "Read,Write,Edit" \
            > result.json

      - name: Push fixes
        if: success()
        run: |
          git push origin HEAD
```

---

## Troubleshooting

### Issue: "Claude Code CLI not found"

**Error**:
```
Error: Claude Code CLI not found. Install from https://claude.ai/download
```

**Solution**:
1. Install Claude Code CLI: https://claude.ai/download
2. Verify installation: `claude --version`
3. Ensure `claude` is in your PATH

---

### Issue: "Not a Git repository"

**Error**:
```
Error: Not a Git repository: /path/to/dir
```

**Solution**:
```bash
cd /path/to/dir
git init
git add .
git commit -m "Initial commit"
```

---

### Issue: "Another execution is in progress"

**Error**:
```
Error: Another execution is in progress. Lock timeout after 300s.
```

**Cause**: Another `cc-executor` process is running on the same repository.

**Solution**:
1. Wait for the other execution to finish
2. Or manually remove lock: `rm /path/to/repo/.claude_executor.lock` (if stuck)

---

### Issue: "Execution exceeded timeout"

**Error**:
```
Status: TIMEOUT
Error: Execution exceeded 600s timeout
```

**Solution**:
Increase timeout for complex tasks:
```bash
cc-executor --instruction "Large refactoring" --timeout 1800
```

---

### Issue: "Session not found"

**Error**:
```
Error: Session not found: session-abc-123
```

**Cause**: Session expired (> 7 days old) or invalid session ID.

**Solution**:
- Start a new session (omit `--resume`)
- List active sessions: `cc-executor list-sessions` (future feature)

---

## Session Management

### List Active Sessions

```bash
# List all sessions (future feature, Phase 2)
cc-executor list-sessions
```

**Output**:
```
session-abc-123  2025-11-24 10:30  /path/to/repo  2 executions
session-xyz-789  2025-11-23 15:20  /path/to/repo  1 execution
```

---

### Manually Clean Up Old Sessions

```bash
# Delete sessions older than 7 days (future feature, Phase 2)
cc-executor cleanup-sessions --days 7
```

**Output**:
```
Deleted 5 expired sessions
```

---

## Using as a Python Library

For programmatic integration in Python scripts:

```python
from cc_executor import execute_instruction, ExecutionRequest, OutputFormat

# Create request
request = ExecutionRequest(
    instruction="Add hello world function",
    output_format=OutputFormat.JSON,
    timeout=300
)

# Execute
result = execute_instruction(request)

# Check result
if result.status == "success":
    print(f"Modified {len(result.files_changed)} files")
    print(f"Commit: {result.commit_hash}")
else:
    print(f"Error: {result.error_message}")
```

**See**: [contracts/library_api.md](./contracts/library_api.md) for full API documentation.

---

## Next Steps

1. **Read Contracts**: See [contracts/library_api.md](./contracts/library_api.md) and [contracts/cli_interface.md](./contracts/cli_interface.md) for detailed API specifications
2. **Review Data Model**: See [data-model.md](./data-model.md) for entity definitions
3. **Check Research**: See [research.md](./research.md) for technical decisions and architecture
4. **Run Tests**: `pytest tests/` to validate installation

---

## Configuration Reference

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `CC_EXECUTOR_DB_PATH` | `~/.cc_executor/sessions.db` | SQLite database location |
| `CC_EXECUTOR_LOG_LEVEL` | `INFO` | Logging level (DEBUG/INFO/WARNING/ERROR) |
| `CC_EXECUTOR_DEFAULT_TIMEOUT` | `600` | Default execution timeout in seconds |

**Example**:
```bash
export CC_EXECUTOR_LOG_LEVEL=DEBUG
export CC_EXECUTOR_DEFAULT_TIMEOUT=300
cc-executor --instruction "Debug issue"
```

---

## Support

- **Documentation**: See [plan.md](./plan.md) for implementation details
- **Issues**: https://github.com/yourorg/lucy-code/issues
- **Spec**: [spec.md](./spec.md) for feature requirements

---

## Summary

You've learned how to:
- ✅ Execute basic instructions (P1)
- ✅ Use JSON output for automation (P2)
- ✅ Restrict tool permissions (P3)
- ✅ Resume conversations across executions (P4)
- ✅ Configure timeouts, dirty worktree handling, and logging
- ✅ Integrate with CI/CD pipelines
- ✅ Troubleshoot common issues

**Quick Reference**:
```bash
# Basic execution
cc-executor --instruction "Your instruction here"

# JSON output with tool restrictions
cc-executor --instruction "..." --output-format json --allowed-tools "Read,Write,Edit"

# Resume session
cc-executor --instruction "..." --resume "session-id"

# Continue last session
cc-executor --instruction "..." --continue
```

Happy automating!
