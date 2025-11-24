# Claude Code Executor

Python library and CLI tool for automating Claude Code execution with structured output capture.

## Overview

Claude Code Executor (`cc-executor`) automates code modification tasks by invoking local Claude Code, capturing execution results, extracting Git diffs, and returning structured output in text, JSON, or stream-JSON formats. It provides tool permission controls, session resumption for multi-turn conversations, and robust error handling.

## Features

- **Basic Execution**: Invoke Claude Code with text instructions and capture diffs/commits
- **Structured Output**: Text, JSON, and stream-JSON output formats for both human and machine consumption
- **Tool Control**: Whitelist/blacklist tool permissions via environment variables
- **Session Resume**: Multi-turn conversations with SQLite-backed session persistence
- **Concurrency Control**: File-lock-based execution queuing to prevent repository conflicts
- **Timeout Handling**: Configurable execution timeouts with graceful termination
- **Git Safety**: Dirty worktree validation with block/stash/allow policies

## Installation

```bash
pip install -e packages/cc-executor/
```

## Requirements

- Python 3.11 or higher
- Claude Code CLI installed and available in PATH
- Git repository (for execution context)

## Environment Variables

The following environment variables can be used to configure cc-executor:

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `CC_EXECUTOR_DB_PATH` | `str` | `~/.cc-executor/sessions.db` | Path to SQLite database for session storage |
| `CC_EXECUTOR_LOG_LEVEL` | `str` | `INFO` | Logging level (DEBUG, INFO, WARNING, ERROR) |
| `CC_EXECUTOR_DEFAULT_TIMEOUT` | `int` | `600` | Default execution timeout in seconds |

## Usage

### CLI

```bash
# Basic execution
cc-executor --instruction "Add hello world function to utils.py"

# JSON output
cc-executor --instruction "Refactor auth module" --output-format json

# Tool restrictions
cc-executor --instruction "Update config" --allowed-tools "Read,Write,Edit"

# Session resume
cc-executor --instruction "Add error handling" --resume <session-id>
```

### Library API

```python
from cc_executor import execute_instruction, ExecutionRequest

# Basic execution
request = ExecutionRequest(
    instruction="Add hello world function",
    output_format="json",
    timeout=300
)
result = execute_instruction(request)

print(f"Status: {result.status}")
print(f"Files changed: {result.files_changed}")
print(f"Diff: {result.diff}")
```

## Documentation

- [Feature Specification](../../specs/001-cc-executor/spec.md)
- [Implementation Plan](../../specs/001-cc-executor/plan.md)
- [Data Model](../../specs/001-cc-executor/data-model.md)
- [API Contract](../../specs/001-cc-executor/contracts/library_api.md)
- [CLI Contract](../../specs/001-cc-executor/contracts/cli_interface.md)

## Development

### Running Tests

```bash
# All tests
pytest packages/cc-executor/tests/

# Contract tests only
pytest packages/cc-executor/tests/contract/ -v

# Integration tests only
pytest packages/cc-executor/tests/integration/ -v

# Unit tests only
pytest packages/cc-executor/tests/unit/ -v

# With coverage
pytest packages/cc-executor/tests/ --cov=cc_executor --cov-report=html
```

### Session Cleanup

Sessions older than 7 days are automatically expired. To manually clean up expired sessions:

```bash
python scripts/cleanup_sessions.py
```

For automated cleanup, add to cron (Linux/macOS) or Task Scheduler (Windows):

```bash
# Run daily at 2 AM
0 2 * * * python /path/to/scripts/cleanup_sessions.py
```

## License

MIT License - see LICENSE file for details

## Support

For issues and feature requests, see the [Lucy Code repository](https://github.com/your-org/lucy-code).
