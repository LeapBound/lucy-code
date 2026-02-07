from __future__ import annotations

import subprocess
from dataclasses import dataclass
from pathlib import Path

from .exceptions import WorktreeError


@dataclass
class WorktreeHandle:
    branch: str
    path: str


class WorktreeManager:
    def __init__(
        self, repo_path: str | Path, worktrees_root: str | Path | None = None
    ) -> None:
        self.repo_path = Path(repo_path)
        root = Path(worktrees_root) if worktrees_root else self.repo_path / "worktrees"
        self.worktrees_root = root

    def create(
        self, task_id: str, base_branch: str = "main", branch_prefix: str = "agent"
    ) -> WorktreeHandle:
        branch_name = f"{branch_prefix}/{task_id}"
        target_path = self.worktrees_root / task_id

        if target_path.exists():
            raise WorktreeError(f"Worktree already exists: {target_path}")

        base_ref = base_branch if self._ref_exists(base_branch) else "HEAD"
        self.worktrees_root.mkdir(parents=True, exist_ok=True)
        self._run(
            ["git", "worktree", "add", "-b", branch_name, str(target_path), base_ref]
        )
        return WorktreeHandle(branch=branch_name, path=str(target_path))

    def remove(self, task_id: str, force: bool = False) -> None:
        target_path = self.worktrees_root / task_id
        if not target_path.exists():
            return

        command = ["git", "worktree", "remove", str(target_path)]
        if force:
            command.append("--force")
        self._run(command)

    def _run(self, command: list[str]) -> None:
        result = self._run_capture(command)
        if result.returncode != 0:
            raise WorktreeError(
                result.stderr.strip() or f"Command failed: {' '.join(command)}"
            )

    def _ref_exists(self, ref: str) -> bool:
        result = self._run_capture(["git", "rev-parse", "--verify", ref])
        return result.returncode == 0

    def _run_capture(self, command: list[str]):
        return subprocess.run(
            command,
            cwd=self.repo_path,
            capture_output=True,
            text=True,
            check=False,
        )
