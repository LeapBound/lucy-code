"""
Unit tests for git_diff module.

Tests Git operations: diff extraction, commit hash retrieval, file listing, worktree checks.
"""

import pytest
from pathlib import Path
import git

from cc_executor.git_diff import (
    extract_diff,
    get_commit_hash,
    list_changed_files,
    check_dirty_worktree,
)
from cc_executor.exceptions import GitError, DirtyWorktreeError


class TestGitDiff:
    """Unit tests for Git diff operations."""

    @pytest.fixture
    def git_repo(self, tmp_path):
        """Create a test Git repository."""
        repo_path = tmp_path / "test_repo"
        repo_path.mkdir()
        repo = git.Repo.init(repo_path)

        # Configure user
        repo.config_writer().set_value("user", "name", "Test User").release()
        repo.config_writer().set_value("user", "email", "test@example.com").release()

        # Initial commit
        test_file = repo_path / "test.txt"
        test_file.write_text("initial")
        repo.index.add(["test.txt"])
        repo.index.commit("Initial commit")

        return repo_path

    def test_extract_diff(self, git_repo):
        """Test extracting Git diff from repository."""
        # Create a new commit
        new_file = git_repo / "new.py"
        new_file.write_text("print('hello')")

        repo = git.Repo(git_repo)
        repo.index.add(["new.py"])
        repo.index.commit("Add new file")

        # Extract diff
        diff = extract_diff(str(git_repo))

        assert diff != ""
        assert "new.py" in diff
        assert "print" in diff or "hello" in diff

    def test_get_commit_hash(self, git_repo):
        """Test retrieving latest commit hash."""
        commit_hash = get_commit_hash(str(git_repo))

        assert commit_hash is not None
        assert len(commit_hash) == 40  # SHA-1 length
        assert commit_hash.isalnum()

    def test_list_changed_files(self, git_repo):
        """Test listing files changed in latest commit."""
        # Create multiple files
        file1 = git_repo / "file1.py"
        file2 = git_repo / "file2.py"
        file1.write_text("code1")
        file2.write_text("code2")

        repo = git.Repo(git_repo)
        repo.index.add(["file1.py", "file2.py"])
        repo.index.commit("Add files")

        # List changed files
        files = list_changed_files(str(git_repo))

        assert len(files) >= 2
        assert "file1.py" in files
        assert "file2.py" in files

    def test_check_dirty_worktree(self, git_repo):
        """Test detecting uncommitted changes."""
        # Clean worktree should not raise
        dirty_files = check_dirty_worktree(str(git_repo))
        assert len(dirty_files) == 0

        # Create uncommitted file
        dirty_file = git_repo / "uncommitted.txt"
        dirty_file.write_text("not committed")

        dirty_files = check_dirty_worktree(str(git_repo))
        assert len(dirty_files) > 0
        assert "uncommitted.txt" in " ".join(dirty_files)

    def test_extract_diff_no_commits(self, tmp_path):
        """Test extract_diff with repository that has no commits yet."""
        empty_repo = tmp_path / "empty_repo"
        empty_repo.mkdir()
        git.Repo.init(empty_repo)

        # Should handle gracefully (empty diff or specific behavior)
        diff = extract_diff(str(empty_repo))
        assert isinstance(diff, str)  # Should return empty string or handle gracefully

    def test_get_commit_hash_no_commits(self, tmp_path):
        """Test get_commit_hash with repository that has no commits yet."""
        empty_repo = tmp_path / "empty_repo"
        empty_repo.mkdir()
        git.Repo.init(empty_repo)

        commit_hash = get_commit_hash(str(empty_repo))
        assert commit_hash is None  # No commits yet

    def test_check_dirty_worktree_with_staged_changes(self, git_repo):
        """Test dirty worktree detection includes staged but uncommitted changes."""
        # Create and stage a file
        staged_file = git_repo / "staged.txt"
        staged_file.write_text("staged content")

        repo = git.Repo(git_repo)
        repo.index.add(["staged.txt"])

        dirty_files = check_dirty_worktree(str(git_repo))
        assert len(dirty_files) > 0
