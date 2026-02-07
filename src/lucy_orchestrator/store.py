from __future__ import annotations

import json
from pathlib import Path

from .exceptions import TaskNotFoundError
from .models import Task


class TaskStore:
    def __init__(self, root_dir: str | Path) -> None:
        self.root_dir = Path(root_dir)
        self.root_dir.mkdir(parents=True, exist_ok=True)

    def _task_path(self, task_id: str) -> Path:
        return self.root_dir / f"{task_id}.json"

    def save(self, task: Task) -> None:
        path = self._task_path(task.task_id)
        with path.open("w", encoding="utf-8") as handle:
            json.dump(task.to_dict(), handle, indent=2, ensure_ascii=False)

    def get(self, task_id: str) -> Task:
        path = self._task_path(task_id)
        if not path.exists():
            raise TaskNotFoundError(f"Task not found: {task_id}")

        with path.open("r", encoding="utf-8") as handle:
            data = json.load(handle)
        return Task.from_dict(data)

    def list(self) -> list[Task]:
        tasks: list[Task] = []
        for path in sorted(self.root_dir.glob("*.json")):
            with path.open("r", encoding="utf-8") as handle:
                tasks.append(Task.from_dict(json.load(handle)))
        return tasks
