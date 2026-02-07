from __future__ import annotations

import fnmatch

from .exceptions import PolicyViolationError
from .models import PlanConstraints


def _matches_any(path: str, patterns: list[str]) -> bool:
    return any(fnmatch.fnmatch(path, pattern) for pattern in patterns)


def enforce_file_policy(changed_files: list[str], constraints: PlanConstraints) -> None:
    if len(changed_files) > constraints.max_files_changed:
        raise PolicyViolationError(
            f"Changed files exceeded max_files_changed: {len(changed_files)} > {constraints.max_files_changed}"
        )

    for file_path in changed_files:
        normalized = file_path.replace("\\", "/")

        if constraints.forbidden_paths and _matches_any(
            normalized, constraints.forbidden_paths
        ):
            raise PolicyViolationError(f"File is forbidden by policy: {normalized}")

        if constraints.allowed_paths and not _matches_any(
            normalized, constraints.allowed_paths
        ):
            raise PolicyViolationError(f"File is outside allowed paths: {normalized}")
