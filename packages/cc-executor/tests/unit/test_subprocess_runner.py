"""
Unit tests for subprocess_runner module.

Tests Claude Code invocation, stdout/stderr capture, timeout handling.
"""

import pytest
from unittest.mock import Mock, patch
import subprocess

from cc_executor.subprocess_runner import invoke_claude
from cc_executor.exceptions import ClaudeCodeNotFoundError, ExecutionTimeoutError


class TestSubprocessRunner:
    """Unit tests for subprocess runner functions."""

    def test_invoke_claude_success(self):
        """Test successful Claude Code invocation with output capture."""
        mock_process = Mock()
        mock_process.returncode = 0
        mock_process.stdout = "Task completed successfully"
        mock_process.stderr = ""

        with patch("cc_executor.subprocess_runner.subprocess.run", return_value=mock_process), \
             patch("cc_executor.subprocess_runner.shutil.which", return_value="/usr/bin/claude"):

            stdout, stderr, returncode = invoke_claude(
                instruction="Add hello function",
                repo_path="/test/repo",
                timeout=30,
            )

        assert returncode == 0
        assert stdout == "Task completed successfully"
        assert stderr == ""

    def test_invoke_claude_timeout(self):
        """Test timeout mechanism raises ExecutionTimeoutError."""
        with patch("cc_executor.subprocess_runner.subprocess.run") as mock_run, \
             patch("cc_executor.subprocess_runner.shutil.which", return_value="/usr/bin/claude"):

            mock_run.side_effect = subprocess.TimeoutExpired("claude", 1)

            with pytest.raises(ExecutionTimeoutError) as exc_info:
                invoke_claude(
                    instruction="Long task",
                    repo_path="/test/repo",
                    timeout=1,
                )

            assert exc_info.value.timeout == 1

    def test_capture_stdout_stderr(self):
        """Test stdout and stderr are properly captured."""
        mock_process = Mock()
        mock_process.returncode = 1
        mock_process.stdout = "Processing..."
        mock_process.stderr = "Warning: Something went wrong"

        with patch("cc_executor.subprocess_runner.subprocess.run", return_value=mock_process), \
             patch("cc_executor.subprocess_runner.shutil.which", return_value="/usr/bin/claude"):

            stdout, stderr, returncode = invoke_claude(
                instruction="Test instruction",
                repo_path="/test/repo",
                timeout=30,
            )

        assert returncode == 1
        assert stdout == "Processing..."
        assert stderr == "Warning: Something went wrong"

    def test_claude_not_found(self):
        """Test ClaudeCodeNotFoundError when claude command not available."""
        with patch("cc_executor.subprocess_runner.shutil.which", return_value=None):
            with pytest.raises(ClaudeCodeNotFoundError):
                invoke_claude(
                    instruction="Any instruction",
                    repo_path="/test/repo",
                    timeout=30,
                )

    def test_invoke_claude_with_special_characters(self):
        """Test handling of special characters in instruction."""
        mock_process = Mock()
        mock_process.returncode = 0
        mock_process.stdout = "Success"
        mock_process.stderr = ""

        with patch("cc_executor.subprocess_runner.subprocess.run", return_value=mock_process) as mock_run, \
             patch("cc_executor.subprocess_runner.shutil.which", return_value="/usr/bin/claude"):

            instruction = 'Add function with "quotes" and \'apostrophes\''
            invoke_claude(
                instruction=instruction,
                repo_path="/test/repo",
                timeout=30,
            )

            # Verify subprocess.run was called with proper escaping
            assert mock_run.called
            call_args = mock_run.call_args
            assert instruction in str(call_args)
