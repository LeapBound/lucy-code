"""
Contract tests for library API (execute_instruction function).

Tests verify the core contract between consumers and the cc_executor library:
- Function signature and parameters
- Return type and structure
- Exception types and conditions
- Functional requirements FR-001 through FR-012, FR-015

These tests use mocks to avoid requiring actual Claude Code installation.
"""

import pytest
from unittest.mock import Mock, patch, MagicMock
from datetime import datetime
from pathlib import Path
import tempfile
import os
import git

from cc_executor.models import (
    ExecutionRequest,
    ExecutionResult,
    ExecutionStatus,
    OutputFormat,
    DirtyWorktreePolicy,
)
from cc_executor.exceptions import (
    ClaudeCodeNotFoundError,
    RepositoryNotFoundError,
    DirtyWorktreeError,
    ExecutionTimeoutError,
)


class TestLibraryAPIContract:
    """Contract tests for execute_instruction() function."""

    @pytest.fixture
    def temp_git_repo(self, tmp_path):
        """Create a temporary Git repository for testing."""
        repo_path = tmp_path / "test_repo"
        repo_path.mkdir()
        repo = git.Repo.init(repo_path)

        # Initial commit
        test_file = repo_path / "test.txt"
        test_file.write_text("initial content")
        repo.index.add(["test.txt"])
        repo.index.commit("Initial commit")

        return repo_path

    def test_execute_instruction_success(self, temp_git_repo):
        """
        Test successful execution with all output fields populated.

        Contract: FR-001, FR-002, FR-003, FR-005
        - Invokes Claude Code with instruction
        - Captures stdout/stderr
        - Extracts Git diff and commit hash
        - Returns ExecutionResult with all required fields
        """
        from cc_executor import execute_instruction

        request = ExecutionRequest(
            instruction="Add hello world function",
            repo_path=str(temp_git_repo),
            timeout=30,
        )

        # Create a side effect that simulates Claude Code creating a commit
        def mock_claude_run(*args, **kwargs):
            # Simulate Claude Code creating file and committing
            repo = git.Repo(temp_git_repo)
            test_file = temp_git_repo / "hello.py"
            test_file.write_text("def hello():\n    print('Hello World')\n")
            repo.index.add(["hello.py"])
            repo.index.commit("Add hello world function")

            # Return mock process result
            mock_process = Mock()
            mock_process.returncode = 0
            mock_process.stdout = "Claude Code output: Task completed successfully"
            mock_process.stderr = ""
            return mock_process

        with patch("cc_executor.subprocess_runner.subprocess.run", side_effect=mock_claude_run), \
             patch("cc_executor.executor.shutil.which", return_value="/usr/bin/claude"):

            result = execute_instruction(request)

        # Verify contract: ExecutionResult with all required fields
        assert isinstance(result, ExecutionResult)
        assert result.status == ExecutionStatus.SUCCESS
        assert result.instruction == "Add hello world function"
        assert isinstance(result.files_changed, list)
        assert "hello.py" in result.files_changed
        assert result.stdout != ""
        assert isinstance(result.stderr, str)
        assert result.execution_time > 0
        assert result.session_id is not None
        assert isinstance(result.timestamp, datetime)
        assert result.diff != ""
        assert result.commit_hash is not None
        assert len(result.commit_hash) == 40  # Git SHA-1 length
        assert result.error_message is None

    def test_execute_instruction_failure(self, temp_git_repo):
        """
        Test execution failure handling.

        Contract: FR-010
        - Captures errors from Claude Code
        - Returns ExecutionResult with failed status
        - Populates error_message field
        """
        from cc_executor import execute_instruction

        request = ExecutionRequest(
            instruction="Invalid instruction that will fail",
            repo_path=str(temp_git_repo),
            timeout=30,
        )

        # Mock subprocess call that fails
        mock_process = Mock()
        mock_process.returncode = 1
        mock_process.stdout = "Attempting to execute..."
        mock_process.stderr = "Error: Unable to understand instruction"

        with patch("cc_executor.subprocess_runner.subprocess.run", return_value=mock_process), \
             patch("cc_executor.executor.shutil.which", return_value="/usr/bin/claude"):

            result = execute_instruction(request)

        # Verify contract: Failed execution result
        assert isinstance(result, ExecutionResult)
        assert result.status == ExecutionStatus.FAILED
        assert result.error_message is not None
        assert "Error" in result.error_message or "Error" in result.stderr
        assert result.execution_time > 0
        assert result.commit_hash is None  # No commit on failure

    def test_execute_instruction_timeout(self, temp_git_repo):
        """
        Test timeout mechanism.

        Contract: FR-011
        - Enforces configured timeout
        - Raises ExecutionTimeoutError
        - Returns TIMEOUT status (or raises exception)
        """
        from cc_executor import execute_instruction

        request = ExecutionRequest(
            instruction="Long running task",
            repo_path=str(temp_git_repo),
            timeout=1,  # 1 second timeout
        )

        # Mock subprocess call that times out
        import subprocess

        with patch("cc_executor.subprocess_runner.subprocess.run") as mock_run, \
             patch("cc_executor.executor.shutil.which", return_value="/usr/bin/claude"):

            mock_run.side_effect = subprocess.TimeoutExpired("claude", 1)

            # Contract allows either exception or TIMEOUT status result
            try:
                result = execute_instruction(request)
                assert result.status == ExecutionStatus.TIMEOUT
                assert result.error_message is not None
            except ExecutionTimeoutError as e:
                assert e.timeout == 1

    def test_dirty_worktree_block(self, temp_git_repo):
        """
        Test dirty worktree blocking policy.

        Contract: FR-012
        - Checks Git working tree before execution
        - Raises DirtyWorktreeError when policy is BLOCK
        - Error message lists affected files
        """
        from cc_executor import execute_instruction

        # Create uncommitted changes
        dirty_file = temp_git_repo / "dirty.txt"
        dirty_file.write_text("uncommitted content")

        request = ExecutionRequest(
            instruction="Add feature",
            repo_path=str(temp_git_repo),
            dirty_worktree=DirtyWorktreePolicy.BLOCK,
        )

        with pytest.raises(DirtyWorktreeError) as exc_info:
            execute_instruction(request)

        # Verify contract: Exception with file list
        assert isinstance(exc_info.value.files, list)
        assert len(exc_info.value.files) > 0

    def test_claude_not_found_error(self, temp_git_repo):
        """
        Test Claude Code not installed scenario.

        Contract: FR-010
        - Checks for 'claude' command availability
        - Raises ClaudeCodeNotFoundError with helpful message
        """
        from cc_executor import execute_instruction

        request = ExecutionRequest(
            instruction="Any instruction",
            repo_path=str(temp_git_repo),
        )

        # Mock shutil.which to return None (command not found)
        # Need to patch both in executor (early check) and subprocess_runner
        with patch("cc_executor.executor.shutil.which", return_value=None):
            with pytest.raises(ClaudeCodeNotFoundError) as exc_info:
                execute_instruction(request)

            # Verify contract: Clear error message
            assert "Claude Code" in str(exc_info.value)
            assert "not found" in str(exc_info.value)

    def test_repository_not_found_error(self):
        """
        Test invalid repository path handling.

        Contract: FR-010
        - Validates repo_path is a Git repository
        - Raises RepositoryNotFoundError with path info
        """
        from cc_executor import execute_instruction

        invalid_path = "/nonexistent/path/to/repo"

        request = ExecutionRequest(
            instruction="Any instruction",
            repo_path=invalid_path,
        )

        with pytest.raises(RepositoryNotFoundError) as exc_info:
            execute_instruction(request)

        # Verify contract: Exception includes path
        assert exc_info.value.path == invalid_path
        assert "Git repository" in str(exc_info.value)
