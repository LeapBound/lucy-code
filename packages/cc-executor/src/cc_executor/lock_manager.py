"""
File-lock based concurrency control for repository execution.

Implements FR-017: Prevent concurrent executions on the same repository.
"""

import os
from pathlib import Path
from filelock import FileLock, Timeout as FileLockTimeout

from .exceptions import ConcurrentExecutionError


# Global dict to track active locks (lock_path -> FileLock object)
_active_locks = {}


def acquire_lock(repo_path: str, timeout: int = 300) -> str:
    """
    Acquire exclusive lock for repository execution.
    
    Args:
        repo_path: Path to Git repository
        timeout: Seconds to wait for lock (default: 5 minutes)
    
    Returns:
        Path to lock file
    
    Raises:
        ConcurrentExecutionError: If lock cannot be acquired within timeout
    """
    # Create lock directory if it doesn't exist
    lock_dir = Path.home() / ".cc_executor" / "locks"
    lock_dir.mkdir(parents=True, exist_ok=True)
    
    # Generate lock file name from repo path (sanitized)
    repo_path_abs = os.path.abspath(repo_path)
    lock_name = repo_path_abs.replace(os.sep, "_").replace(":", "")
    lock_file = lock_dir / f"{lock_name}.lock"
    lock_file_str = str(lock_file)
    
    # Create lock object
    lock = FileLock(lock_file_str, timeout=timeout)
    
    # Try to acquire lock
    try:
        lock.acquire()
        _active_locks[lock_file_str] = lock
        return lock_file_str
    except FileLockTimeout:
        raise ConcurrentExecutionError(timeout=timeout)


def release_lock(lock_file: str) -> None:
    """
    Release repository execution lock.
    
    Args:
        lock_file: Path to lock file (from acquire_lock)
    """
    if lock_file not in _active_locks:
        return  # Not tracked or already released
    
    lock = _active_locks[lock_file]
    try:
        if lock.is_locked:
            lock.release()
        del _active_locks[lock_file]
    except Exception:
        pass  # Ignore errors during release
