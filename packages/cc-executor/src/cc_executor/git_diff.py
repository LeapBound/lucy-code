"""
Git diff extraction and worktree management.

Implements FR-003 (extract diff), FR-012 (dirty worktree check).
"""

import git
from typing import List, Optional
from pathlib import Path

from .exceptions import GitError, DirtyWorktreeError, RepositoryNotFoundError


def extract_diff(repo_path: str, commits: int = 1) -> str:
    """
    Extract Git diff from repository.

    Args:
        repo_path: Path to Git repository
        commits: Number of recent commits to include in diff (default 1)

    Returns:
        Combined diff text for all changes

    Raises:
        RepositoryNotFoundError: If path is not a Git repository
        GitError: If diff extraction fails
    """
    try:
        repo = git.Repo(repo_path)
    except git.exc.InvalidGitRepositoryError:
        raise RepositoryNotFoundError(repo_path)

    try:
        # Get diff from the latest commit
        if len(list(repo.iter_commits())) == 0:
            # No commits yet, return empty diff
            return ""

        # Get the latest commit
        latest_commit = repo.head.commit

        if len(list(repo.iter_commits())) == 1:
            # First commit - show diff against empty tree
            diff = latest_commit.diff(git.NULL_TREE, create_patch=True)
        else:
            # Subsequent commits - diff against parent
            parent = latest_commit.parents[0] if latest_commit.parents else git.NULL_TREE
            diff = parent.diff(latest_commit, create_patch=True)

        # Combine all diffs into single string
        diff_text = ""
        for diff_item in diff:
            if diff_item.diff:
                diff_text += diff_item.diff.decode('utf-8', errors='replace') + "\n"

        return diff_text

    except Exception as e:
        raise GitError("extract_diff", str(e))


def get_commit_hash(repo_path: str) -> Optional[str]:
    """
    Get the latest commit hash.

    Args:
        repo_path: Path to Git repository

    Returns:
        Commit SHA-1 hash (40 characters) or None if no commits

    Raises:
        RepositoryNotFoundError: If path is not a Git repository
        GitError: If operation fails
    """
    try:
        repo = git.Repo(repo_path)
    except git.exc.InvalidGitRepositoryError:
        raise RepositoryNotFoundError(repo_path)

    try:
        if len(list(repo.iter_commits())) == 0:
            return None

        return repo.head.commit.hexsha

    except Exception as e:
        raise GitError("get_commit_hash", str(e))


def list_changed_files(repo_path: str) -> List[str]:
    """
    List files changed in the latest commit.

    Args:
        repo_path: Path to Git repository

    Returns:
        List of file paths relative to repository root

    Raises:
        RepositoryNotFoundError: If path is not a Git repository
        GitError: If operation fails
    """
    try:
        repo = git.Repo(repo_path)
    except git.exc.InvalidGitRepositoryError:
        raise RepositoryNotFoundError(repo_path)

    try:
        if len(list(repo.iter_commits())) == 0:
            return []

        latest_commit = repo.head.commit

        if len(list(repo.iter_commits())) == 1:
            # First commit - all files are "changed"
            diff = latest_commit.diff(git.NULL_TREE)
        else:
            # Subsequent commits - diff against parent
            parent = latest_commit.parents[0] if latest_commit.parents else git.NULL_TREE
            diff = parent.diff(latest_commit)

        # Extract file paths
        changed_files = []
        for diff_item in diff:
            # Handle both a_path (deleted) and b_path (added/modified)
            if diff_item.b_path:
                changed_files.append(diff_item.b_path)
            elif diff_item.a_path:
                changed_files.append(diff_item.a_path)

        return changed_files

    except Exception as e:
        raise GitError("list_changed_files", str(e))


def check_dirty_worktree(repo_path: str) -> List[str]:
    """
    Check for uncommitted changes in the working tree.

    Args:
        repo_path: Path to Git repository

    Returns:
        List of files with uncommitted changes (empty if clean)

    Raises:
        RepositoryNotFoundError: If path is not a Git repository
        GitError: If operation fails
    """
    try:
        repo = git.Repo(repo_path)
    except git.exc.InvalidGitRepositoryError:
        raise RepositoryNotFoundError(repo_path)

    try:
        # Get list of modified files (unstaged and staged)
        dirty_files = []

        # Untracked files
        dirty_files.extend(repo.untracked_files)

        # Modified but unstaged
        dirty_files.extend([item.a_path for item in repo.index.diff(None)])

        # Staged but uncommitted
        dirty_files.extend([item.a_path for item in repo.index.diff("HEAD")])

        return list(set(dirty_files))  # Remove duplicates

    except Exception as e:
        # If HEAD doesn't exist yet (no commits), repo is "clean" for our purposes
        if "HEAD" in str(e):
            return []
        raise GitError("check_dirty_worktree", str(e))
