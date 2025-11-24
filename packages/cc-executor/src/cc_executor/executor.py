"""
Main executor function for Claude Code execution.

Orchestrates the complete execution flow:
1. Validation (request, repository, worktree)
2. Lock acquisition (FR-017)
3. Claude Code invocation
4. Git diff extraction
5. Result construction
6. Error handling
7. Audit logging (FR-015)

Implements User Story 1: Basic Task Execution.
"""

import time
import logging
import shutil
from datetime import datetime
from pathlib import Path
from typing import Optional
import os

from .models import (
    ExecutionRequest,
    ExecutionResult,
    ExecutionStatus,
    Session,
    DirtyWorktreePolicy,
)
from .exceptions import (
    ClaudeCodeNotFoundError,
    RepositoryNotFoundError,
    DirtyWorktreeError,
    ExecutionTimeoutError,
)
from .subprocess_runner import invoke_claude
from .git_diff import (
    extract_diff,
    get_commit_hash,
    list_changed_files,
    check_dirty_worktree,
)
from .lock_manager import acquire_lock, release_lock


# Configure logging (FR-015)
logger = logging.getLogger(__name__)


def execute_instruction(request: ExecutionRequest) -> ExecutionResult:
    """
    Execute a Claude Code instruction and return structured results.

    This is the main entry point for the library API.

    Args:
        request: ExecutionRequest with instruction and configuration

    Returns:
        ExecutionResult with execution outcome, diff, commit, etc.

    Raises:
        ClaudeCodeNotFoundError: If Claude Code not installed
        RepositoryNotFoundError: If repo_path is invalid
        DirtyWorktreeError: If worktree is dirty and policy is BLOCK
        ConcurrentExecutionError: If lock acquisition times out
        ExecutionTimeoutError: If Claude Code execution times out

    Functional Requirements:
        FR-001: Invoke Claude Code with instruction
        FR-002: Capture stdout/stderr
        FR-003: Extract Git diff
        FR-005: Return ExecutionResult
        FR-010: Error handling
        FR-011: Timeout mechanism
        FR-012: Dirty worktree validation
        FR-015: Audit logging
        FR-017: Lock management
    """
    start_time = time.time()
    request_id = ExecutionResult.generate_request_id()
    session_id = Session.generate_session_id()  # For now, always create new session
    lock_handle = None

    logger.info(f"Starting execution {request_id}: {request.instruction[:50]}...")

    try:
        # --- Step 0: Early validation ---
        # Check Claude Code availability early (before lock)
        if shutil.which("claude") is None:
            raise ClaudeCodeNotFoundError()

        # --- Step 1: Validate repository (FR-010) ---
        repo_path = request.repo_path or os.getcwd()
        if not Path(repo_path).exists():
            raise RepositoryNotFoundError(repo_path)

        # Check if it's a Git repository (will raise RepositoryNotFoundError)
        from git import Repo
        try:
            Repo(repo_path)
        except Exception:
            raise RepositoryNotFoundError(repo_path)

        # Record commit before execution to detect new commits
        commit_before = get_commit_hash(repo_path)

        # --- Step 2: Check dirty worktree (FR-012) ---
        dirty_files = check_dirty_worktree(repo_path)
        if dirty_files:
            if request.dirty_worktree == DirtyWorktreePolicy.BLOCK:
                logger.warning(f"Blocking execution due to dirty worktree: {dirty_files}")
                raise DirtyWorktreeError(dirty_files)
            elif request.dirty_worktree == DirtyWorktreePolicy.STASH:
                # TODO: Implement stash logic in Phase 7 (T153)
                logger.info("STASH policy not yet implemented, allowing execution")
            elif request.dirty_worktree == DirtyWorktreePolicy.ALLOW:
                logger.info(f"Allowing execution despite dirty worktree: {dirty_files}")

        # --- Step 3: Acquire lock (FR-017) ---
        lock_timeout = 300  # 5 minutes default
        lock_handle = acquire_lock(repo_path, timeout=lock_timeout)
        logger.debug(f"Acquired lock for {repo_path}")

        # --- Step 4: Invoke Claude Code (FR-001, FR-002, FR-011) ---
        logger.info("Invoking Claude Code...")
        stdout, stderr, returncode = invoke_claude(
            instruction=request.instruction,
            repo_path=repo_path,
            timeout=request.timeout,
            verbose=request.verbose,
        )

        # --- Step 5: Determine execution status ---
        if returncode == 0:
            status = ExecutionStatus.SUCCESS
            error_message = None
            logger.info("Execution completed successfully")
        else:
            status = ExecutionStatus.FAILED
            error_message = f"Claude Code returned exit code {returncode}"
            logger.error(f"Execution failed: {error_message}")

        # --- Step 6: Extract Git information (FR-003) ---
        # Only extract diff/commit if execution was successful
        if status == ExecutionStatus.SUCCESS:
            try:
                commit_after = get_commit_hash(repo_path)
                # Only return diff/commit if a new commit was created
                if commit_after != commit_before:
                    diff = extract_diff(repo_path)
                    commit_hash = commit_after
                    files_changed = list_changed_files(repo_path)
                else:
                    # Success but no new commit
                    diff = ""
                    commit_hash = None
                    files_changed = []
            except Exception as e:
                logger.warning(f"Failed to extract Git info: {e}")
                diff = ""
                commit_hash = None
                files_changed = []
        else:
            # Failed execution - no commit info
            diff = ""
            commit_hash = None
            files_changed = []

        # --- Step 7: Construct result (FR-005) ---
        execution_time = time.time() - start_time

        result = ExecutionResult(
            request_id=request_id,
            status=status,
            instruction=request.instruction,
            files_changed=files_changed,
            stdout=stdout,
            stderr=stderr,
            execution_time=execution_time,
            session_id=session_id,
            timestamp=datetime.now(),
            diff=diff,
            commit_hash=commit_hash,
            error_message=error_message,
        )

        # --- Step 8: Audit logging (FR-015) ---
        _log_execution(result)

        return result

    except (DirtyWorktreeError, RepositoryNotFoundError, ExecutionTimeoutError, ClaudeCodeNotFoundError) as e:
        # Known errors - re-raise
        logger.error(f"Execution error: {type(e).__name__}: {e}")
        raise

    except Exception as e:
        # Unexpected errors - wrap and return failed result
        logger.exception(f"Unexpected error during execution: {e}")
        execution_time = time.time() - start_time

        return ExecutionResult(
            request_id=request_id,
            status=ExecutionStatus.FAILED,
            instruction=request.instruction,
            files_changed=[],
            stdout="",
            stderr=str(e),
            execution_time=execution_time,
            session_id=session_id,
            timestamp=datetime.now(),
            error_message=str(e),
        )

    finally:
        # --- Step 9: Release lock (FR-017) ---
        if lock_handle:
            release_lock(lock_handle)
            logger.debug("Released lock")


def _log_execution(result: ExecutionResult) -> None:
    """
    Log execution to audit file (FR-015).

    Args:
        result: ExecutionResult to log
    """
    # For now, use Python logging. In Phase 7, could write to dedicated audit file
    logger.info(
        f"AUDIT: request_id={result.request_id} "
        f"status={result.status.value} "
        f"instruction='{result.instruction[:50]}...' "
        f"files_changed={len(result.files_changed)} "
        f"commit={result.commit_hash} "
        f"execution_time={result.execution_time:.2f}s"
    )
