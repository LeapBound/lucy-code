from __future__ import annotations

import json
import re
import subprocess
from dataclasses import dataclass
from enum import Enum
from pathlib import Path
from typing import Any, Protocol

from .exceptions import OpenCodeInvocationError
from .models import Task


class ApprovalIntent(str, Enum):
    APPROVE = "approve"
    REJECT = "reject"
    CLARIFY = "clarify"
    UNKNOWN = "unknown"


@dataclass
class IntentResult:
    intent: ApprovalIntent
    confidence: float
    reason: str = ""
    raw: dict[str, Any] | None = None


class IntentClassifier(Protocol):
    def classify(self, text: str, task: Task | None = None) -> IntentResult:
        raise NotImplementedError


class RuleBasedIntentClassifier:
    _approve_patterns = [
        r"^/approve$",
        r"\bapprove(d)?\b",
        r"\bgo\s+ahead\b",
        r"\bship\s+it\b",
        r"\bok\b",
        r"\bokay\b",
        r"\blgtm\b",
        r"同意",
        r"通过",
        r"可以开始",
        r"开始吧",
        r"开干",
        r"没问题",
    ]

    _reject_patterns = [
        r"^/reject$",
        r"\breject\b",
        r"\bdecline\b",
        r"\bcancel\b",
        r"\bhold\b",
        r"\bnot\s+now\b",
        r"不同意",
        r"拒绝",
        r"先别",
        r"不要",
        r"取消",
        r"停止",
        r"停下",
    ]

    _clarify_patterns = [
        r"\?",
        r"为什么",
        r"能不能",
        r"是否",
        r"请解释",
        r"再确认",
    ]

    def classify(self, text: str, task: Task | None = None) -> IntentResult:
        normalized = self._normalize(text)
        if not normalized:
            return IntentResult(
                intent=ApprovalIntent.UNKNOWN,
                confidence=0.0,
                reason="empty message",
            )

        if self._match_any(normalized, self._reject_patterns):
            return IntentResult(
                intent=ApprovalIntent.REJECT,
                confidence=0.95,
                reason="matched reject rule",
            )

        if self._match_any(normalized, self._approve_patterns):
            return IntentResult(
                intent=ApprovalIntent.APPROVE,
                confidence=0.95,
                reason="matched approve rule",
            )

        if self._match_any(normalized, self._clarify_patterns):
            return IntentResult(
                intent=ApprovalIntent.CLARIFY,
                confidence=0.6,
                reason="matched clarify rule",
            )

        return IntentResult(
            intent=ApprovalIntent.UNKNOWN,
            confidence=0.2,
            reason="no rule matched",
        )

    @staticmethod
    def _normalize(text: str) -> str:
        return re.sub(r"\s+", " ", text.strip().lower())

    @staticmethod
    def _match_any(text: str, patterns: list[str]) -> bool:
        return any(re.search(pattern, text, re.IGNORECASE) for pattern in patterns)


class OpenCodeIntentClassifier:
    def __init__(
        self,
        *,
        command: str = "opencode",
        timeout: int = 120,
        use_docker: bool = False,
        docker_image: str = "nanobot-opencode",
        workspace: str | Path | None = None,
        agent: str = "plan",
    ) -> None:
        self.command = command
        self.timeout = timeout
        self.use_docker = use_docker
        self.docker_image = docker_image
        self.workspace = (
            str(Path(workspace).expanduser().resolve()) if workspace else None
        )
        self.agent = agent

    def classify(self, text: str, task: Task | None = None) -> IntentResult:
        workspace = self._resolve_workspace(task)
        prompt = self._build_prompt(text=text, task=task)
        command = [
            self.command,
            "run",
            "--agent",
            self.agent,
            "--format",
            "json",
            prompt,
        ]

        if self.use_docker:
            command = [
                "docker",
                "run",
                "--rm",
                "-v",
                f"{workspace}:/workspace",
                "-w",
                "/workspace",
                self.docker_image,
                *command,
            ]
            cwd = None
        else:
            cwd = workspace

        try:
            completed = subprocess.run(
                command,
                cwd=cwd,
                capture_output=True,
                text=True,
                check=False,
                timeout=self.timeout,
            )
        except FileNotFoundError as exc:
            raise OpenCodeInvocationError(
                f"OpenCode intent classifier command not found: {exc}"
            ) from exc
        except subprocess.TimeoutExpired as exc:
            raise OpenCodeInvocationError(
                f"OpenCode intent classifier timed out after {self.timeout}s"
            ) from exc

        if completed.returncode != 0:
            stderr = (completed.stderr or "").strip()
            raise OpenCodeInvocationError(
                f"OpenCode intent classifier failed: {stderr or completed.returncode}"
            )

        output_text = self._extract_text(completed.stdout)
        payload = self._extract_json(output_text)
        if not payload:
            raise OpenCodeInvocationError(
                "OpenCode intent classifier did not return valid JSON payload"
            )

        raw_intent = str(payload.get("intent", "unknown")).lower()
        try:
            intent = ApprovalIntent(raw_intent)
        except ValueError:
            intent = ApprovalIntent.UNKNOWN

        confidence = self._clamp_confidence(payload.get("confidence", 0.5))
        reason = str(payload.get("reason", "model-classified"))
        return IntentResult(
            intent=intent, confidence=confidence, reason=reason, raw=payload
        )

    def _resolve_workspace(self, task: Task | None) -> str:
        if task and task.repo.worktree_path:
            path = Path(task.repo.worktree_path).expanduser().resolve()
            if path.exists():
                return str(path)

        if self.workspace:
            return self.workspace

        return str(Path.cwd())

    def _build_prompt(self, text: str, task: Task | None = None) -> str:
        task_context = ""
        if task is not None:
            task_context = (
                f"task_id={task.task_id}\n"
                f"task_state={task.state.value}\n"
                f"task_title={task.title}\n"
            )

        return (
            "Classify the user message intent for approval workflow. "
            "Return strict JSON only.\n"
            "Allowed intents: approve, reject, clarify, unknown.\n"
            'Output schema: {"intent":"approve|reject|clarify|unknown","confidence":0.0,'
            '"reason":"short reason"}.\n'
            f"{task_context}"
            f"user_message={text}"
        )

    @staticmethod
    def _extract_text(raw_stdout: str) -> str:
        chunks: list[str] = []
        for line in raw_stdout.splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                payload = json.loads(line)
            except json.JSONDecodeError:
                continue
            if not isinstance(payload, dict):
                continue
            if payload.get("type") == "text":
                part = payload.get("part")
                if isinstance(part, dict) and isinstance(part.get("text"), str):
                    chunks.append(part["text"])

        if chunks:
            return "".join(chunks).strip()

        return raw_stdout.strip()

    @staticmethod
    def _extract_json(text: str) -> dict[str, Any] | None:
        candidate = text.strip()
        if not candidate:
            return None

        try:
            parsed = json.loads(candidate)
            return parsed if isinstance(parsed, dict) else None
        except json.JSONDecodeError:
            pass

        match = re.search(r"\{.*\}", candidate, re.DOTALL)
        if not match:
            return None

        try:
            parsed = json.loads(match.group(0))
            return parsed if isinstance(parsed, dict) else None
        except json.JSONDecodeError:
            return None

    @staticmethod
    def _clamp_confidence(value: Any) -> float:
        try:
            numeric = float(value)
        except (TypeError, ValueError):
            numeric = 0.0
        if numeric < 0:
            return 0.0
        if numeric > 1:
            return 1.0
        return numeric


class HybridIntentClassifier:
    def __init__(
        self,
        rule_classifier: IntentClassifier | None = None,
        llm_classifier: IntentClassifier | None = None,
        llm_threshold: float = 0.8,
    ) -> None:
        self.rule_classifier = rule_classifier or RuleBasedIntentClassifier()
        self.llm_classifier = llm_classifier
        self.llm_threshold = llm_threshold

    def classify(self, text: str, task: Task | None = None) -> IntentResult:
        rule_result = self.rule_classifier.classify(text, task)
        if rule_result.intent != ApprovalIntent.UNKNOWN:
            return rule_result

        if not self.llm_classifier:
            return rule_result

        llm_result = self.llm_classifier.classify(text, task)
        if llm_result.confidence >= self.llm_threshold:
            return llm_result

        return IntentResult(
            intent=ApprovalIntent.UNKNOWN,
            confidence=max(rule_result.confidence, llm_result.confidence),
            reason="llm confidence below threshold",
            raw=llm_result.raw,
        )
