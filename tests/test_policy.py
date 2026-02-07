import unittest

from lucy_orchestrator.exceptions import PolicyViolationError
from lucy_orchestrator.models import PlanConstraints
from lucy_orchestrator.policy import enforce_file_policy


class TestPolicy(unittest.TestCase):
    def test_policy_accepts_allowed_paths(self) -> None:
        constraints = PlanConstraints(
            allowed_paths=["src/**", "tests/**"],
            forbidden_paths=["secrets/**"],
            max_files_changed=5,
        )
        enforce_file_policy(["src/service.py", "tests/test_service.py"], constraints)

    def test_policy_rejects_forbidden_path(self) -> None:
        constraints = PlanConstraints(
            allowed_paths=["src/**", "tests/**", "secrets/**"],
            forbidden_paths=["secrets/**"],
            max_files_changed=5,
        )

        with self.assertRaises(PolicyViolationError):
            enforce_file_policy(["secrets/token.txt"], constraints)

    def test_policy_rejects_outside_allowlist(self) -> None:
        constraints = PlanConstraints(
            allowed_paths=["src/**"],
            forbidden_paths=[],
            max_files_changed=5,
        )

        with self.assertRaises(PolicyViolationError):
            enforce_file_policy(["docs/readme.md"], constraints)

    def test_policy_rejects_excessive_changes(self) -> None:
        constraints = PlanConstraints(
            allowed_paths=["src/**"],
            forbidden_paths=[],
            max_files_changed=1,
        )

        with self.assertRaises(PolicyViolationError):
            enforce_file_policy(["src/a.py", "src/b.py"], constraints)


if __name__ == "__main__":
    unittest.main()
