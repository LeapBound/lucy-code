from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from lucy_orchestrator.worktree import WorktreeManager


class TestWorktreeManager(unittest.TestCase):
    @patch("lucy_orchestrator.worktree.subprocess.run")
    def test_create_worktree_runs_expected_command(self, mock_run) -> None:
        mock_run.side_effect = [
            SimpleNamespace(returncode=0, stderr="", stdout=""),
            SimpleNamespace(returncode=0, stderr="", stdout=""),
        ]

        with tempfile.TemporaryDirectory() as tmp_dir:
            repo_path = Path(tmp_dir)
            manager = WorktreeManager(repo_path=repo_path)
            handle = manager.create(
                task_id="task_1", base_branch="main", branch_prefix="agent"
            )

            self.assertEqual(handle.branch, "agent/task_1")
            self.assertTrue(handle.path.endswith("worktrees/task_1"))
            self.assertEqual(mock_run.call_count, 2)

            ref_args, ref_kwargs = mock_run.call_args_list[0]
            self.assertEqual(ref_args[0], ["git", "rev-parse", "--verify", "main"])
            self.assertEqual(ref_kwargs["cwd"], repo_path)

            args, kwargs = mock_run.call_args_list[1]
            self.assertEqual(
                args[0],
                [
                    "git",
                    "worktree",
                    "add",
                    "-b",
                    "agent/task_1",
                    str(repo_path / "worktrees" / "task_1"),
                    "main",
                ],
            )
            self.assertEqual(kwargs["cwd"], repo_path)

    @patch("lucy_orchestrator.worktree.subprocess.run")
    def test_create_worktree_falls_back_to_head(self, mock_run) -> None:
        mock_run.side_effect = [
            SimpleNamespace(returncode=1, stderr="bad ref", stdout=""),
            SimpleNamespace(returncode=0, stderr="", stdout=""),
        ]

        with tempfile.TemporaryDirectory() as tmp_dir:
            repo_path = Path(tmp_dir)
            manager = WorktreeManager(repo_path=repo_path)
            manager.create(task_id="task_1", base_branch="main", branch_prefix="agent")

            args, _ = mock_run.call_args_list[1]
            self.assertEqual(args[0][-1], "HEAD")

    @patch("lucy_orchestrator.worktree.subprocess.run")
    def test_remove_worktree_with_force(self, mock_run) -> None:
        mock_run.return_value = SimpleNamespace(returncode=0, stderr="")

        with tempfile.TemporaryDirectory() as tmp_dir:
            repo_path = Path(tmp_dir)
            worktrees_root = repo_path / "worktrees"
            target = worktrees_root / "task_2"
            target.mkdir(parents=True)

            manager = WorktreeManager(repo_path=repo_path)
            manager.remove(task_id="task_2", force=True)

            mock_run.assert_called_once()
            args, _ = mock_run.call_args
            self.assertEqual(
                args[0], ["git", "worktree", "remove", str(target), "--force"]
            )


if __name__ == "__main__":
    unittest.main()
