"""
CC Executor - Python library and CLI tool for automating Claude Code execution.

This module provides the public API for executing Claude Code instructions programmatically.
"""

__version__ = "0.1.0"

# Core execution function
from .executor import execute_instruction

# Data models
from .models import (
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
)

# Exceptions
from .exceptions import (
    CCExecutorError,
    ClaudeCodeNotFoundError,
    RepositoryNotFoundError,
    DirtyWorktreeError,
    ConcurrentExecutionError,
    ExecutionTimeoutError,
    GitError,
    SessionNotFoundError,
)

# Public API exports
__all__ = [
    # Version
    "__version__",
    # Core function
    "execute_instruction",
    # Data models
    "ExecutionRequest",
    "ExecutionResult",
    "DiffInfo",
    "ToolConfig",
    "Session",
    # Enums
    "OutputFormat",
    "ExecutionStatus",
    "DirtyWorktreePolicy",
    "FileStatus",
    "ToolMode",
    "SessionStatus",
    # Exceptions
    "CCExecutorError",
    "ClaudeCodeNotFoundError",
    "RepositoryNotFoundError",
    "DirtyWorktreeError",
    "ConcurrentExecutionError",
    "ExecutionTimeoutError",
    "GitError",
    "SessionNotFoundError",
]
