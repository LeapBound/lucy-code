"""
Exception hierarchy for CC Executor.

All custom exceptions inherit from CCExecutorError base class.
"""

from typing import List


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
        self.path = path


class DirtyWorktreeError(CCExecutorError):
    """Raised when dirty_worktree='block' and uncommitted changes exist."""
    
    def __init__(self, files: List[str]):
        file_count = len(files)
        super().__init__(
            f"Working tree has uncommitted changes in {file_count} file(s). "
            f"Use --dirty-worktree=allow or commit changes first."
        )
        self.files = files


class ConcurrentExecutionError(CCExecutorError):
    """Raised when file lock acquisition times out."""
    
    def __init__(self, timeout: int):
        super().__init__(
            f"Another execution is in progress. Lock timeout after {timeout}s."
        )
        self.timeout = timeout


class ExecutionTimeoutError(CCExecutorError):
    """Raised when Claude Code execution exceeds timeout."""
    
    def __init__(self, timeout: int):
        super().__init__(f"Execution exceeded {timeout}s timeout")
        self.timeout = timeout


class GitError(CCExecutorError):
    """Raised when Git operations fail."""
    
    def __init__(self, operation: str, message: str):
        super().__init__(f"Git {operation} failed: {message}")
        self.operation = operation
        self.message = message


class SessionNotFoundError(CCExecutorError):
    """Raised when resume_session_id does not exist."""
    
    def __init__(self, session_id: str):
        super().__init__(f"Session not found: {session_id}")
        self.session_id = session_id
