"""
Integration test for User Story 1: Basic Task Execution.

Tests the complete end-to-end flow of executing a Claude Code instruction
and receiving structured results including diff and commit information.

Success Criteria (SC-001): Developer can execute a simple instruction and
receive diff + commit hash in under 30 seconds.
"""

import pytest
from unittest.mock import patch, Mock
import tempfile
from pathlib import Path
import git
import time

from cc_executor import execute_instruction, ExecutionRequest, ExecutionStatus


class TestUserStory1BasicExecution:
    """Integration tests for User Story 1: Basic Task Execution."""

    @pytest.fixture
    def test_repo(self, tmp_path):
        """Create a test Git repository with initial state."""
        repo_path = tmp_path / "integration_repo"
        repo_path.mkdir()
        repo = git.Repo.init(repo_path)

        # Setup initial repository state
        readme = repo_path / "README.md"
        readme.write_text("# Test Project\n")
        repo.index.add(["README.md"])
        repo.index.commit("Initial commit")

        # Configure Git user for commits
        repo.config_writer().set_value("user", "name", "Test User").release()
        repo.config_writer().set_value("user", "email", "test@example.com").release()

        return repo_path

    def test_basic_task_execution_full_flow(self, test_repo):
        """
        Test complete User Story 1 flow covering all 3 acceptance scenarios.

        Scenario 1: Execute instruction and receive output/diff/commit
        Scenario 2: View modified files list and diff content
        Scenario 3: Handle execution errors gracefully

        This test uses mocked Claude Code but real Git operations.
        """
        # --- Scenario 1: Successful execution ---

        request = ExecutionRequest(
            instruction="Add hello world function to main.py",
            repo_path=str(test_repo),
            timeout=30,
        )

        # Mock Claude Code execution with side effect
        def mock_claude_run(*args, **kwargs):
            # Simulate Claude Code creating file and committing
            main_file = test_repo / "main.py"
            main_file.write_text("def hello_world():\n    print('Hello, World!')\n\nif __name__ == '__main__':\n    hello_world()\n")

            repo = git.Repo(test_repo)
            repo.index.add(["main.py"])
            repo.index.commit("Add hello world function")

            # Return mock process
            mock_process = Mock()
            mock_process.returncode = 0
            mock_process.stdout = "Analyzing instruction...\nCreating main.py...\nCommitting changes..."
            mock_process.stderr = ""
            return mock_process

        with patch("cc_executor.subprocess_runner.subprocess.run", side_effect=mock_claude_run), \
             patch("cc_executor.executor.shutil.which", return_value="/usr/bin/claude"):

            start_time = time.time()
            result = execute_instruction(request)
            execution_time = time.time() - start_time

        # Verify Scenario 1: Result includes output, diff, commit
        assert result.status == ExecutionStatus.SUCCESS
        assert result.instruction == "Add hello world function to main.py"
        assert result.stdout != ""
        assert isinstance(result.stderr, str)

        # Verify Scenario 2: File list and diff content
        assert "main.py" in result.files_changed
        assert len(result.files_changed) >= 1
        assert result.diff != ""
        assert "def hello_world" in result.diff or "main.py" in result.diff
        assert result.commit_hash is not None
        assert len(result.commit_hash) == 40

        # Verify SC-001: Execution under 30 seconds (generous for testing)
        assert execution_time < 30

        # Verify audit fields are populated (FR-015)
        assert result.execution_time > 0
        assert result.timestamp is not None
        assert result.session_id is not None

        # --- Scenario 3: Error handling ---

        error_request = ExecutionRequest(
            instruction="Invalid instruction that causes failure",
            repo_path=str(test_repo),
            timeout=30,
        )

        # Mock Claude Code failure
        mock_error_process = Mock()
        mock_error_process.returncode = 1
        mock_error_process.stdout = "Attempting to process instruction..."
        mock_error_process.stderr = "Error: Unable to understand the instruction"

        with patch("cc_executor.subprocess_runner.subprocess.run", return_value=mock_error_process), \
             patch("cc_executor.executor.shutil.which", return_value="/usr/bin/claude"):

            error_result = execute_instruction(error_request)

        # Verify Scenario 3: Clear error information
        assert error_result.status == ExecutionStatus.FAILED
        assert error_result.error_message is not None
        assert "Error" in error_result.stderr or error_result.error_message is not None
        assert error_result.commit_hash is None

    def test_multiple_file_changes(self, test_repo):
        """Test handling of multiple file modifications in one execution."""

        request = ExecutionRequest(
            instruction="Create module structure with multiple files",
            repo_path=str(test_repo),
            timeout=30,
        )

        def mock_claude_run(*args, **kwargs):
            # Simulate creating multiple files
            (test_repo / "module").mkdir()
            (test_repo / "module" / "__init__.py").write_text("")
            (test_repo / "module" / "core.py").write_text("# Core module\n")
            (test_repo / "module" / "utils.py").write_text("# Utilities\n")

            repo = git.Repo(test_repo)
            repo.index.add(["module/__init__.py", "module/core.py", "module/utils.py"])
            repo.index.commit("Create module structure")

            mock_process = Mock()
            mock_process.returncode = 0
            mock_process.stdout = "Creating multiple files..."
            mock_process.stderr = ""
            return mock_process

        with patch("cc_executor.subprocess_runner.subprocess.run", side_effect=mock_claude_run), \
             patch("cc_executor.executor.shutil.which", return_value="/usr/bin/claude"):

            result = execute_instruction(request)

        # Verify multiple files are tracked
        assert result.status == ExecutionStatus.SUCCESS
        assert len(result.files_changed) >= 3
        assert any("__init__.py" in f for f in result.files_changed)
        assert any("core.py" in f for f in result.files_changed)
        assert any("utils.py" in f for f in result.files_changed)

    def test_execution_with_verbose_logging(self, test_repo):
        """Test that verbose mode captures detailed logs (FR-007)."""

        request = ExecutionRequest(
            instruction="Add logging feature",
            repo_path=str(test_repo),
            timeout=30,
            verbose=True,
        )

        mock_process = Mock()
        mock_process.returncode = 0
        mock_process.stdout = "Step 1: Analyzing...\nStep 2: Creating files...\nStep 3: Committing..."
        mock_process.stderr = ""

        with patch("cc_executor.subprocess_runner.subprocess.run", return_value=mock_process), \
             patch("cc_executor.executor.shutil.which", return_value="/usr/bin/claude"):

            # Simulate file creation
            log_file = test_repo / "logger.py"
            log_file.write_text("import logging\n")

            repo = git.Repo(test_repo)
            repo.index.add(["logger.py"])
            repo.index.commit("Add logging feature")

            result = execute_instruction(request)

        # Verify verbose output includes detailed steps
        assert result.status == ExecutionStatus.SUCCESS
        assert "Step" in result.stdout or len(result.stdout) > 0
