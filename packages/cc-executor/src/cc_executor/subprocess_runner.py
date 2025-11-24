"""
Subprocess runner for invoking Claude Code.

Handles subprocess execution, output capture, and timeout management.
Implements FR-001 (invoke claude -p), FR-002 (capture output), FR-011 (timeout).
"""

import subprocess
import shutil
from typing import Tuple

from .exceptions import ClaudeCodeNotFoundError, ExecutionTimeoutError


def invoke_claude(
    instruction: str,
    repo_path: str,
    timeout: int,
    verbose: bool = False,
) -> Tuple[str, str, int]:
    """
    Invoke Claude Code with the given instruction.

    Args:
        instruction: Text instruction to pass to Claude Code
        repo_path: Path to Git repository (working directory)
        timeout: Maximum execution time in seconds
        verbose: Enable verbose output (future use)

    Returns:
        Tuple of (stdout, stderr, returncode)

    Raises:
        ClaudeCodeNotFoundError: If 'claude' command not found in PATH
        ExecutionTimeoutError: If execution exceeds timeout
    """
    # Check if Claude Code is installed (FR-010)
    claude_path = shutil.which("claude")
    if claude_path is None:
        raise ClaudeCodeNotFoundError()

    # Build command: claude -p "<instruction>"
    # Using -p flag for programmatic mode
    command = [
        "claude",
        "-p",
        instruction,
    ]

    try:
        # Run subprocess with timeout (FR-001, FR-002, FR-011)
        result = subprocess.run(
            command,
            cwd=repo_path,
            timeout=timeout,
            capture_output=True,
            text=True,
            check=False,  # Don't raise on non-zero exit
        )

        return result.stdout, result.stderr, result.returncode

    except subprocess.TimeoutExpired as e:
        # Timeout exceeded (FR-011)
        raise ExecutionTimeoutError(timeout) from e
    except Exception as e:
        # Unexpected subprocess error
        raise RuntimeError(f"Failed to execute Claude Code: {e}") from e
