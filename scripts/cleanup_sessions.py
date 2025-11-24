#!/usr/bin/env python3
"""
Session Cleanup Script

This script removes expired sessions from the SQLite database.
Intended to be run as a daily cron job.

Usage:
    python scripts/cleanup_sessions.py [--days 7]

FR-016: Daily cleanup of sessions older than 7 days
"""

import argparse
import sys
from pathlib import Path

# Add parent directory to path for imports (when run as script)
sys.path.insert(0, str(Path(__file__).parent.parent / "packages" / "cc-executor" / "src"))


def main():
    parser = argparse.ArgumentParser(description="Clean up expired CC Executor sessions")
    parser.add_argument(
        "--days",
        type=int,
        default=7,
        help="Delete sessions older than this many days (default: 7)",
    )
    args = parser.parse_args()

    try:
        # Import after path setup
        from cc_executor import cleanup_expired_sessions

        deleted_count = cleanup_expired_sessions(days=args.days)
        print(f"✓ Cleaned up {deleted_count} expired session(s)")
        return 0
    except ImportError:
        print("Error: cc_executor module not installed or session_manager not implemented yet")
        print("Install with: pip install -e packages/cc-executor/")
        return 1
    except Exception as e:
        print(f"Error during cleanup: {e}")
        return 1


if __name__ == "__main__":
    sys.exit(main())
