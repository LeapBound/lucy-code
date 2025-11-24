"""
Data models for CC Executor.

Defines core entities: ExecutionRequest, ExecutionResult, DiffInfo, ToolConfig, Session.
"""

from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import List, Optional, Dict, Set
from uuid import uuid4
import os


# Enums (T011)

class OutputFormat(str, Enum):
    """Output format for execution results."""
    TEXT = "text"
    JSON = "json"
    STREAM_JSON = "stream-json"


class ExecutionStatus(str, Enum):
    """Execution outcome status."""
    SUCCESS = "success"
    FAILED = "failed"
    TIMEOUT = "timeout"


class DirtyWorktreePolicy(str, Enum):
    """Policy for handling uncommitted Git changes."""
    BLOCK = "block"
    STASH = "stash"
    ALLOW = "allow"


class FileStatus(str, Enum):
    """Git file change status."""
    ADDED = "added"
    MODIFIED = "modified"
    DELETED = "deleted"
    RENAMED = "renamed"


class ToolMode(str, Enum):
    """Tool permission mode."""
    WHITELIST = "whitelist"
    BLACKLIST = "blacklist"
    ALL = "all"


class SessionStatus(str, Enum):
    """Session lifecycle state."""
    ACTIVE = "active"
    COMPLETED = "completed"
    EXPIRED = "expired"


# Data Classes

@dataclass
class ExecutionRequest:
    """
    Represents a request to execute a Claude Code instruction.
    
    Attributes:
        instruction: Text instruction to pass to Claude Code
        output_format: Output format (text/json/stream-json)
        allowed_tools: Whitelist of tool names (empty = no restriction)
        disallowed_tools: Blacklist of tool names (empty = none disallowed)
        resume_session_id: Session ID to resume (optional)
        continue_last: If True, resume most recent session
        verbose: Enable detailed execution logs
        timeout: Execution timeout in seconds
        dirty_worktree: How to handle uncommitted changes
        repo_path: Path to Git repository (defaults to CWD)
    """
    instruction: str
    output_format: OutputFormat = OutputFormat.TEXT
    allowed_tools: List[str] = field(default_factory=list)
    disallowed_tools: List[str] = field(default_factory=list)
    resume_session_id: Optional[str] = None
    continue_last: bool = False
    verbose: bool = False
    timeout: int = 600  # 10 minutes default
    dirty_worktree: DirtyWorktreePolicy = DirtyWorktreePolicy.BLOCK
    repo_path: Optional[str] = None

    def __post_init__(self):
        """Validate request after initialization."""
        if not self.instruction or not self.instruction.strip():
            raise ValueError("Instruction cannot be empty")
        
        if self.timeout < 1 or self.timeout > 3600:
            raise ValueError("Timeout must be between 1 and 3600 seconds")
        
        if self.allowed_tools and self.disallowed_tools:
            raise ValueError("Cannot specify both allowed_tools and disallowed_tools")
        
        if self.resume_session_id and self.continue_last:
            raise ValueError("Cannot use both resume_session_id and continue_last")
        
        # Default repo_path to current working directory
        if self.repo_path is None:
            self.repo_path = os.getcwd()


@dataclass
class DiffInfo:
    """
    Per-file diff information.
    
    Attributes:
        file_path: Relative path to the modified file
        diff_text: Git diff output for this file
        status: Type of change (added/modified/deleted/renamed)
        additions: Number of lines added
        deletions: Number of lines deleted
    """
    file_path: str
    diff_text: str
    status: FileStatus
    additions: int = 0
    deletions: int = 0


@dataclass
class ExecutionResult:
    """
    Result of executing a Claude Code instruction.
    
    Attributes:
        request_id: Unique execution identifier (UUID)
        status: Execution outcome
        instruction: Original instruction from request
        files_changed: List of modified file paths
        stdout: Standard output from Claude Code
        stderr: Error output from Claude Code
        execution_time: Total execution duration in seconds
        session_id: Session ID for this execution
        timestamp: When execution started
        diff: Combined Git diff text (all files)
        commit_hash: Git commit SHA if created
        error_message: Human-readable error description
        diff_info: Per-file diff details (optional)
    """
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

    @staticmethod
    def generate_request_id() -> str:
        """Generate unique request ID."""
        return str(uuid4())


@dataclass
class ToolConfig:
    """
    Tool permission configuration (internal validation model).
    
    Attributes:
        allowed_tools: Set of explicitly allowed tool names
        disallowed_tools: Set of explicitly disallowed tool names
        mode: Permission mode derived from allowed/disallowed settings
    """
    allowed_tools: Set[str] = field(default_factory=set)
    disallowed_tools: Set[str] = field(default_factory=set)
    mode: ToolMode = ToolMode.ALL

    def __post_init__(self):
        """Derive mode from tool lists."""
        if self.allowed_tools and self.disallowed_tools:
            raise ValueError("Cannot specify both allowed_tools and disallowed_tools")
        
        if self.allowed_tools:
            self.mode = ToolMode.WHITELIST
        elif self.disallowed_tools:
            self.mode = ToolMode.BLACKLIST
        else:
            self.mode = ToolMode.ALL

    @classmethod
    def from_request(cls, request: ExecutionRequest) -> "ToolConfig":
        """Create ToolConfig from ExecutionRequest."""
        return cls(
            allowed_tools=set(request.allowed_tools or []),
            disallowed_tools=set(request.disallowed_tools or []),
        )


@dataclass
class Session:
    """
    Conversation session for multi-turn execution.
    
    Attributes:
        session_id: Unique session identifier (UUID)
        created_at: When session was created
        last_accessed: Last usage time (for expiration)
        conversation_history: List of messages (role/content dicts)
        status: Session lifecycle state
        repo_path: Absolute path to Git repository
        execution_count: Number of executions in this session
    """
    session_id: str
    created_at: datetime
    last_accessed: datetime
    conversation_history: List[Dict[str, str]]
    status: SessionStatus
    repo_path: str
    execution_count: int = 0

    @staticmethod
    def generate_session_id() -> str:
        """Generate unique session ID."""
        return f"session-{uuid4()}"
    
    def is_expired(self, days: int = 7) -> bool:
        """Check if session is older than specified days."""
        age = datetime.now() - self.last_accessed
        return age.days > days
