"""
Unit tests for lock_manager module.

Tests file-lock based concurrency control (FR-017).
"""

import os
import pytest
import tempfile
from pathlib import Path

from cc_executor.lock_manager import acquire_lock, release_lock
from cc_executor.exceptions import ConcurrentExecutionError


@pytest.fixture
def temp_repo():
    """Create temporary directory to simulate a Git repo."""
    with tempfile.TemporaryDirectory() as tmpdir:
        yield tmpdir


def test_acquire_lock_success(temp_repo):
    """Test successful lock acquisition."""
    lock_file = acquire_lock(temp_repo, timeout=5)
    assert lock_file is not None
    assert os.path.exists(lock_file)
    release_lock(lock_file)


def test_lock_timeout(temp_repo):
    """Test lock acquisition timeout when another process holds lock."""
    # First lock succeeds
    lock1 = acquire_lock(temp_repo, timeout=5)
    
    # Second lock should timeout
    with pytest.raises(ConcurrentExecutionError):
        acquire_lock(temp_repo, timeout=1)
    
    release_lock(lock1)


def test_lock_release(temp_repo):
    """Test lock release and subsequent acquisition."""
    # Acquire and release lock
    lock1 = acquire_lock(temp_repo, timeout=5)
    release_lock(lock1)
    
    # Should be able to acquire again immediately
    lock2 = acquire_lock(temp_repo, timeout=5)
    assert lock2 is not None
    release_lock(lock2)


def test_multiple_repo_locks(temp_repo):
    """Test that locks are repo-specific (can lock different repos simultaneously)."""
    with tempfile.TemporaryDirectory() as repo2:
        # Should be able to lock two different repos at once
        lock1 = acquire_lock(temp_repo, timeout=5)
        lock2 = acquire_lock(repo2, timeout=5)
        
        assert lock1 != lock2
        
        release_lock(lock1)
        release_lock(lock2)
