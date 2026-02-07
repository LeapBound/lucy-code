from __future__ import annotations

import json
import re
import socket
import subprocess
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Protocol

from ..exceptions import OpenCodeInvocationError
from ..models import (
    Plan,
    PlanConstraints,
    PlanStep,
    StepStatus,
    StepType,
    Task,
    utc_now_iso,
)


@dataclass
class ClarifyResult:
    summary: str
    plan: Plan
    usage: dict[str, int] = field(default_factory=dict)
    raw_text: str = ""


@dataclass
class BuildExecutionResult:
    changed_files: list[str]
    diff_path: str
    output_text: str = ""
    usage: dict[str, int] = field(default_factory=dict)


@dataclass
class TestExecutionResult:
    command: str
    exit_code: int
    log_path: str
    duration_ms: int

    def to_dict(self) -> dict[str, object]:
        return {
            "command": self.command,
            "exit_code": self.exit_code,
            "log_path": self.log_path,
            "duration_ms": self.duration_ms,
        }


@dataclass
class OpenCodeRunResult:
    agent: str
    returncode: int
    events: list[dict[str, Any]] = field(default_factory=list)
    text: str = ""
    usage: dict[str, int] = field(default_factory=dict)
    stderr: str = ""
    error: str | None = None

    @property
    def success(self) -> bool:
        return self.returncode == 0 and self.error is None


class OpenCodeClient(Protocol):
    def clarify(self, task: Task) -> ClarifyResult:
        raise NotImplementedError

    def build(self, task: Task) -> BuildExecutionResult:
        raise NotImplementedError

    def run_test(self, task: Task, command: str) -> TestExecutionResult:
        raise NotImplementedError


class OpenCodeCLIClient:
    def __init__(
        self,
        *,
        artifact_root: str | Path = ".orchestrator/artifacts",
        driver: str = "sdk",
        command: str = "opencode",
        use_docker: bool = False,
        docker_image: str = "nanobot-opencode",
        workspace: str | Path | None = None,
        timeout: int = 900,
        plan_agent: str = "plan",
        build_agent: str = "build",
        node_command: str = "node",
        sdk_script: str | Path = "scripts/opencode_sdk_bridge.mjs",
        sdk_base_url: str | None = None,
        sdk_hostname: str = "127.0.0.1",
        sdk_port: int = 0,
        sdk_timeout_ms: int = 5000,
    ) -> None:
        self.artifact_root = Path(artifact_root)
        self.artifact_root.mkdir(parents=True, exist_ok=True)

        self.driver = driver
        self.command = command
        self.use_docker = use_docker
        self.docker_image = docker_image
        self.workspace = self._normalize_workspace(workspace)
        self.timeout = timeout
        self.plan_agent = plan_agent
        self.build_agent = build_agent
        self.node_command = node_command
        self.sdk_script = sdk_script
        self.sdk_base_url = sdk_base_url
        self.sdk_hostname = sdk_hostname
        self.sdk_port = sdk_port
        self.sdk_timeout_ms = sdk_timeout_ms

    def clarify(self, task: Task) -> ClarifyResult:
        prompt = self._build_plan_prompt(task)
        run_result = self._run_agent(
            agent=self.plan_agent,
            prompt=prompt,
            task_id=task.task_id,
            workspace=self._resolve_workspace(task),
        )
        if not run_result.success:
            raise OpenCodeInvocationError(
                run_result.error or "OpenCode plan phase failed without error details"
            )

        payload = self._extract_json_object(run_result.text)
        if payload is None:
            payload = self._extract_first_json_object_from_events(run_result.events)
        if payload is None:
            raise OpenCodeInvocationError(
                "OpenCode plan output is not valid JSON. "
                "Ensure plan agent returns strict JSON payload."
            )

        summary, plan_payload = self._extract_summary_and_plan(payload)
        plan = self._plan_from_payload(plan_payload, task)

        return ClarifyResult(
            summary=summary,
            plan=plan,
            usage=run_result.usage,
            raw_text=run_result.text,
        )

    def build(self, task: Task) -> BuildExecutionResult:
        workspace = self._resolve_workspace(task)
        prompt = self._build_build_prompt(task)
        run_result = self._run_agent(
            agent=self.build_agent,
            prompt=prompt,
            task_id=task.task_id,
            workspace=workspace,
        )
        if not run_result.success:
            raise OpenCodeInvocationError(
                run_result.error or "OpenCode build phase failed without error details"
            )

        changed_files = self._collect_changed_files(workspace)
        diff_path = self._write_diff_artifact(task.task_id, workspace)
        return BuildExecutionResult(
            changed_files=changed_files,
            diff_path=str(diff_path),
            output_text=run_result.text,
            usage=run_result.usage,
        )

    def run_test(self, task: Task, command: str) -> TestExecutionResult:
        workspace = self._resolve_workspace(task)
        start = time.monotonic()
        exit_code = 1
        stdout = ""
        stderr = ""

        if self.use_docker:
            run_command = [
                "docker",
                "run",
                "--rm",
                "-v",
                f"{workspace}:/workspace",
                "-w",
                "/workspace",
                self.docker_image,
                "/bin/sh",
                "-lc",
                command,
            ]
            shell_mode = False
        else:
            run_command = command
            shell_mode = True

        try:
            completed = subprocess.run(
                run_command,
                cwd=workspace,
                shell=shell_mode,
                capture_output=True,
                text=True,
                check=False,
                timeout=self.timeout,
            )
            exit_code = completed.returncode
            stdout = completed.stdout
            stderr = completed.stderr
        except FileNotFoundError as exc:
            exit_code = 127
            stderr = f"Command executable not found: {exc}"
        except subprocess.TimeoutExpired as exc:
            exit_code = 124
            timeout_stdout = exc.stdout or ""
            timeout_stderr = exc.stderr or ""
            if isinstance(timeout_stdout, bytes):
                stdout = timeout_stdout.decode("utf-8", errors="replace")
            else:
                stdout = str(timeout_stdout)

            if isinstance(timeout_stderr, bytes):
                stderr_text = timeout_stderr.decode("utf-8", errors="replace")
            else:
                stderr_text = str(timeout_stderr)
            stderr = f"{stderr_text}\nCommand timed out after {self.timeout}s"
        except Exception as exc:
            exit_code = 1
            stderr = f"Command execution failed: {exc}"

        duration_ms = int((time.monotonic() - start) * 1000)
        log_path = self.artifact_root / f"{task.task_id}_test.log"
        log_payload = {
            "task_id": task.task_id,
            "workspace": workspace,
            "command": command,
            "exit_code": exit_code,
            "duration_ms": duration_ms,
            "stdout": stdout,
            "stderr": stderr,
        }
        log_path.write_text(
            json.dumps(log_payload, indent=2, ensure_ascii=False), encoding="utf-8"
        )

        return TestExecutionResult(
            command=command,
            exit_code=exit_code,
            log_path=str(log_path),
            duration_ms=duration_ms,
        )

    def _run_agent(
        self,
        *,
        agent: str,
        prompt: str,
        task_id: str,
        workspace: str,
    ) -> OpenCodeRunResult:
        driver = self.driver.lower().strip()
        if driver == "sdk" and not self.use_docker:
            return self._run_agent_sdk(
                agent=agent,
                prompt=prompt,
                task_id=task_id,
                workspace=workspace,
            )

        return self._run_agent_cli(
            agent=agent,
            prompt=prompt,
            task_id=task_id,
            workspace=workspace,
        )

    def _run_agent_cli(
        self,
        *,
        agent: str,
        prompt: str,
        task_id: str,
        workspace: str,
    ) -> OpenCodeRunResult:
        opencode_command = [
            self.command,
            "run",
            "--agent",
            agent,
            "--format",
            "json",
            prompt,
        ]

        if self.use_docker:
            workspace_path = Path(workspace)
            if not workspace_path.exists():
                return OpenCodeRunResult(
                    agent=agent,
                    returncode=1,
                    error=f"OpenCode workspace directory not found: '{workspace}'",
                )
            command = [
                "docker",
                "run",
                "--rm",
                "-v",
                f"{workspace}:/workspace",
                "-w",
                "/workspace",
                self.docker_image,
                *opencode_command,
            ]
            cwd = None
        else:
            command = opencode_command
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
        except FileNotFoundError:
            if self.use_docker:
                message = "Docker executable not found in PATH"
            else:
                message = f"OpenCode CLI not found: '{self.command}'"
            return OpenCodeRunResult(agent=agent, returncode=127, error=message)
        except subprocess.TimeoutExpired:
            return OpenCodeRunResult(
                agent=agent,
                returncode=124,
                error=f"OpenCode CLI timed out after {self.timeout}s",
            )
        except Exception as exc:
            return OpenCodeRunResult(
                agent=agent,
                returncode=1,
                error=f"Unexpected error calling OpenCode CLI: {exc}",
            )

        events = self._parse_jsonl_events(completed.stdout)
        text = self._extract_text_from_events(events)
        usage = self._extract_usage(events)
        error: str | None = None

        if completed.returncode != 0:
            error = self._extract_error_text(events, completed.stderr)
            if not error:
                error = f"OpenCode exited with status {completed.returncode}"

        result = OpenCodeRunResult(
            agent=agent,
            returncode=completed.returncode,
            events=events,
            text=text,
            usage=usage,
            stderr=completed.stderr,
            error=error,
        )
        self._write_agent_log(
            task_id=task_id,
            command=command,
            workspace=workspace,
            run_result=result,
            stdout=completed.stdout,
        )
        return result

    def _run_agent_sdk(
        self,
        *,
        agent: str,
        prompt: str,
        task_id: str,
        workspace: str,
    ) -> OpenCodeRunResult:
        script_path = self._resolve_sdk_script_path()
        if not script_path.exists():
            return OpenCodeRunResult(
                agent=agent,
                returncode=1,
                error=(
                    f"OpenCode SDK bridge script not found: {script_path}. "
                    "Run npm install and keep scripts/opencode_sdk_bridge.mjs in repo."
                ),
            )

        payload = {
            "agent": agent,
            "prompt": prompt,
            "workspace": workspace,
            "sessionTitle": f"lucy-{task_id}-{agent}",
            "baseUrl": self.sdk_base_url,
            "hostname": self.sdk_hostname,
            "port": self._resolve_sdk_port(),
            "timeoutMs": self.sdk_timeout_ms,
        }
        command = [self.node_command, str(script_path)]

        try:
            completed = subprocess.run(
                command,
                cwd=workspace,
                input=json.dumps(payload, ensure_ascii=False),
                capture_output=True,
                text=True,
                check=False,
                timeout=self.timeout,
            )
        except FileNotFoundError:
            return OpenCodeRunResult(
                agent=agent,
                returncode=127,
                error=f"Node executable not found: '{self.node_command}'",
            )
        except subprocess.TimeoutExpired:
            return OpenCodeRunResult(
                agent=agent,
                returncode=124,
                error=f"OpenCode SDK bridge timed out after {self.timeout}s",
            )
        except Exception as exc:
            return OpenCodeRunResult(
                agent=agent,
                returncode=1,
                error=f"Unexpected error calling OpenCode SDK bridge: {exc}",
            )

        parsed = self._safe_json_loads(completed.stdout.strip())
        if not isinstance(parsed, dict):
            message = (
                completed.stderr.strip() or "Invalid JSON from OpenCode SDK bridge"
            )
            return OpenCodeRunResult(
                agent=agent,
                returncode=completed.returncode or 1,
                stderr=completed.stderr,
                error=message,
            )

        if not parsed.get("ok"):
            error_message = str(
                parsed.get("error") or "OpenCode SDK bridge returned failure"
            )
            details = parsed.get("details")
            if details:
                error_message = f"{error_message}: {details}"
            return OpenCodeRunResult(
                agent=agent,
                returncode=completed.returncode or 1,
                stderr=completed.stderr,
                error=error_message,
            )

        parts = parsed.get("parts")
        events: list[dict[str, Any]] = []
        if isinstance(parts, list):
            for part in parts:
                if isinstance(part, dict):
                    events.append({"type": part.get("type"), "part": part})

        text = str(parsed.get("text") or self._extract_text_from_events(events))
        usage_raw = parsed.get("usage")
        usage = (
            usage_raw if isinstance(usage_raw, dict) else self._extract_usage(events)
        )

        result = OpenCodeRunResult(
            agent=agent,
            returncode=0,
            events=events,
            text=text,
            usage={k: self._safe_int(v) for k, v in usage.items()},
            stderr=completed.stderr,
            error=None,
        )
        self._write_agent_log(
            task_id=task_id,
            command=command,
            workspace=workspace,
            run_result=result,
            stdout=completed.stdout,
        )
        return result

    def _resolve_sdk_script_path(self) -> Path:
        script_path = Path(self.sdk_script).expanduser()
        if script_path.is_absolute():
            return script_path

        repo_root = Path(__file__).resolve().parents[3]
        return (repo_root / script_path).resolve()

    def _resolve_sdk_port(self) -> int:
        if self.sdk_port > 0:
            return self.sdk_port

        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            sock.bind((self.sdk_hostname, 0))
            return int(sock.getsockname()[1])

    def _write_agent_log(
        self,
        *,
        task_id: str,
        command: list[str],
        workspace: str,
        run_result: OpenCodeRunResult,
        stdout: str,
    ) -> None:
        log_path = self.artifact_root / f"{task_id}_{run_result.agent}.json"
        payload = {
            "task_id": task_id,
            "agent": run_result.agent,
            "timestamp": utc_now_iso(),
            "workspace": workspace,
            "command": command,
            "returncode": run_result.returncode,
            "usage": run_result.usage,
            "error": run_result.error,
            "text": run_result.text,
            "events": run_result.events,
            "stdout": stdout,
            "stderr": run_result.stderr,
        }
        log_path.write_text(
            json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8"
        )

    def _build_plan_prompt(self, task: Task) -> str:
        task_text = task.description.strip() or task.title.strip()
        return (
            "You are the plan agent for a coding orchestrator. "
            "Return STRICT JSON only, no markdown, no prose.\n\n"
            "Required top-level format:\n"
            "{\n"
            '  "summary": "short summary",\n'
            '  "plan": {\n'
            '    "plan_id": "string",\n'
            '    "task_id": "string",\n'
            '    "version": 1,\n'
            '    "goal": "string",\n'
            '    "assumptions": ["string"],\n'
            '    "constraints": {\n'
            '      "allowed_paths": ["glob"],\n'
            '      "forbidden_paths": ["glob"],\n'
            '      "max_files_changed": 20\n'
            "    },\n"
            '    "questions": [\n'
            '      {"id":"q1","question":"...","required":true,"status":"open"}\n'
            "    ],\n"
            '    "steps": [\n'
            '      {"id":"s1","type":"code","title":"...","status":"pending"},\n'
            '      {"id":"s2","type":"test","title":"...","command":"pytest -q","status":"pending"}\n'
            "    ],\n"
            '    "approval_gate": {"required_before_run": true, "required_before_commit": true},\n'
            '    "metadata": {"created_at": "ISO-8601", "created_by": "opencode-plan-agent"}\n'
            "  }\n"
            "}\n\n"
            f"task_id={task.task_id}\n"
            f"base_branch={task.repo.base_branch}\n"
            f"request={task_text}"
        )

    def _build_build_prompt(self, task: Task) -> str:
        plan_payload = task.plan.to_dict() if task.plan else {}
        return (
            "Execute implementation according to this approved plan. "
            "Return concise final execution notes as plain text.\n\n"
            f"task_id={task.task_id}\n"
            f"request={task.description or task.title}\n"
            f"plan={json.dumps(plan_payload, ensure_ascii=False)}"
        )

    def _resolve_workspace(self, task: Task) -> str:
        workspace = task.repo.worktree_path or self.workspace
        if not workspace:
            raise OpenCodeInvocationError(
                "Workspace is required. Set task.repo.worktree_path or OpenCodeCLIClient(workspace=...)"
            )
        path = Path(workspace).expanduser().resolve()
        if not path.exists():
            raise OpenCodeInvocationError(f"Workspace directory not found: {path}")
        return str(path)

    @staticmethod
    def _normalize_workspace(workspace: str | Path | None) -> str | None:
        if workspace is None:
            return None
        return str(Path(workspace).expanduser().resolve())

    def _collect_changed_files(self, workspace: str) -> list[str]:
        status_output = self._run_git(
            ["git", "status", "--porcelain"],
            workspace=workspace,
            failure_message="Failed to read git status after build",
        )
        changed: set[str] = set()
        for raw_line in status_output.splitlines():
            line = raw_line.strip("\n")
            if len(line) < 4:
                continue
            entry = line[3:].strip()
            if " -> " in entry:
                entry = entry.split(" -> ", 1)[1].strip()
            if entry:
                changed.add(entry)
        return sorted(changed)

    def _write_diff_artifact(self, task_id: str, workspace: str) -> Path:
        unstaged = self._run_git(
            ["git", "diff"],
            workspace=workspace,
            failure_message="Failed to collect unstaged diff",
        )
        staged = self._run_git(
            ["git", "diff", "--cached"],
            workspace=workspace,
            failure_message="Failed to collect staged diff",
        )
        status = self._run_git(
            ["git", "status", "--short"],
            workspace=workspace,
            failure_message="Failed to collect status summary",
        )

        parts: list[str] = []
        if unstaged:
            parts.append("# Unstaged Diff\n")
            parts.append(unstaged)
        if staged:
            parts.append("# Staged Diff\n")
            parts.append(staged)
        if status:
            parts.append("# Working Tree Status\n")
            parts.append(status)
        if not parts:
            parts.append("# No git diff/status output produced")

        diff_path = self.artifact_root / f"{task_id}.diff"
        diff_path.write_text("\n\n".join(parts), encoding="utf-8")
        return diff_path

    def _run_git(
        self, command: list[str], *, workspace: str, failure_message: str
    ) -> str:
        completed = subprocess.run(
            command,
            cwd=workspace,
            capture_output=True,
            text=True,
            check=False,
            timeout=self.timeout,
        )
        if completed.returncode != 0:
            stderr = completed.stderr.strip() or completed.stdout.strip()
            raise OpenCodeInvocationError(f"{failure_message}: {stderr}")
        return completed.stdout.strip()

    def _extract_summary_and_plan(
        self, payload: dict[str, Any]
    ) -> tuple[str, dict[str, Any]]:
        if "plan" in payload and isinstance(payload.get("plan"), dict):
            summary = str(
                payload.get("summary") or "Plan generated by OpenCode"
            ).strip()
            return summary or "Plan generated by OpenCode", dict(payload["plan"])

        summary = str(payload.get("summary") or "Plan generated by OpenCode").strip()
        return summary or "Plan generated by OpenCode", payload

    def _plan_from_payload(self, payload: dict[str, Any], task: Task) -> Plan:
        constraints_payload = payload.get("constraints", {})
        allowed_paths = constraints_payload.get("allowed_paths") or [
            "src/**",
            "tests/**",
            "README.md",
        ]
        forbidden_paths = constraints_payload.get("forbidden_paths") or [
            ".git/**",
            "secrets/**",
        ]
        max_files_changed = int(constraints_payload.get("max_files_changed", 20))

        steps_payload = payload.get("steps")
        normalized_steps = self._normalize_steps(steps_payload)
        if not normalized_steps:
            normalized_steps = [
                {
                    "id": "s1",
                    "type": "code",
                    "title": "Implement required changes",
                    "status": StepStatus.PENDING.value,
                },
                {
                    "id": "s2",
                    "type": "test",
                    "title": "Run tests",
                    "command": "pytest -q",
                    "status": StepStatus.PENDING.value,
                },
            ]

        questions_payload = payload.get("questions")
        normalized_questions = self._normalize_questions(questions_payload)

        approval_gate = payload.get("approval_gate", {})
        metadata = payload.get("metadata", {})

        plan_dict = {
            "plan_id": str(payload.get("plan_id") or f"plan_{task.task_id}_v1"),
            "task_id": str(payload.get("task_id") or task.task_id),
            "version": int(payload.get("version", 1)),
            "goal": str(payload.get("goal") or task.description or task.title),
            "assumptions": list(payload.get("assumptions", [])),
            "constraints": {
                "allowed_paths": [str(item) for item in allowed_paths],
                "forbidden_paths": [str(item) for item in forbidden_paths],
                "max_files_changed": max_files_changed,
            },
            "questions": normalized_questions,
            "steps": normalized_steps,
            "approval_gate": {
                "required_before_run": bool(
                    approval_gate.get("required_before_run", True)
                ),
                "required_before_commit": bool(
                    approval_gate.get("required_before_commit", True)
                ),
            },
            "metadata": {
                "created_at": str(metadata.get("created_at") or utc_now_iso()),
                "created_by": str(metadata.get("created_by") or "opencode-plan-agent"),
            },
        }
        return Plan.from_dict(plan_dict)

    def _normalize_questions(self, payload: Any) -> list[dict[str, Any]]:
        if not isinstance(payload, list):
            return []
        output: list[dict[str, Any]] = []
        for idx, item in enumerate(payload, start=1):
            if not isinstance(item, dict):
                continue
            status_raw = str(item.get("status", "open")).lower()
            status = "answered" if status_raw == "answered" else "open"
            output.append(
                {
                    "id": str(item.get("id") or f"q{idx}"),
                    "question": str(item.get("question") or ""),
                    "required": bool(item.get("required", True)),
                    "status": status,
                    "answer": item.get("answer"),
                }
            )
        return output

    def _normalize_steps(self, payload: Any) -> list[dict[str, Any]]:
        if not isinstance(payload, list):
            return []

        output: list[dict[str, Any]] = []
        has_code = False
        has_test = False

        for idx, item in enumerate(payload, start=1):
            if not isinstance(item, dict):
                continue
            step_type_raw = str(item.get("type", "code")).lower()
            step_type = (
                StepType.TEST.value
                if step_type_raw == StepType.TEST.value
                else StepType.CODE.value
            )
            status_raw = str(item.get("status", StepStatus.PENDING.value)).lower()
            status = (
                status_raw
                if status_raw in {state.value for state in StepStatus}
                else StepStatus.PENDING.value
            )

            command = item.get("command")
            if step_type == StepType.TEST.value and not (
                isinstance(command, str) and command.strip()
            ):
                command = "pytest -q"

            normalized = {
                "id": str(item.get("id") or f"s{idx}"),
                "type": step_type,
                "title": str(item.get("title") or f"Step {idx}"),
                "command": command if isinstance(command, str) else None,
                "status": status,
            }
            output.append(normalized)

            if step_type == StepType.CODE.value:
                has_code = True
            if step_type == StepType.TEST.value:
                has_test = True

        if output and not has_code:
            output.insert(
                0,
                {
                    "id": "s_code",
                    "type": StepType.CODE.value,
                    "title": "Implement required changes",
                    "command": None,
                    "status": StepStatus.PENDING.value,
                },
            )
        if output and not has_test:
            output.append(
                {
                    "id": "s_test",
                    "type": StepType.TEST.value,
                    "title": "Run tests",
                    "command": "pytest -q",
                    "status": StepStatus.PENDING.value,
                }
            )

        return output

    def _parse_jsonl_events(self, raw_stdout: str) -> list[dict[str, Any]]:
        events: list[dict[str, Any]] = []
        for line in raw_stdout.splitlines():
            line = line.strip()
            if not line:
                continue
            parsed = self._safe_json_loads(line)
            if isinstance(parsed, dict):
                events.append(parsed)
        return events

    def _extract_text_from_events(self, events: list[dict[str, Any]]) -> str:
        chunks: list[str] = []
        for event in events:
            if event.get("type") != "text":
                continue
            part = event.get("part")
            if not isinstance(part, dict):
                continue
            text = part.get("text")
            if isinstance(text, str):
                chunks.append(text)

        if chunks:
            return "".join(chunks).strip()

        candidate_keys = ["final_output", "output", "content", "text", "message"]
        for event in reversed(events):
            for key in candidate_keys:
                value = event.get(key)
                if isinstance(value, str) and value.strip():
                    return value.strip()
            part = event.get("part")
            if isinstance(part, dict):
                for key in ("text", "content", "message"):
                    value = part.get(key)
                    if isinstance(value, str) and value.strip():
                        return value.strip()

        return ""

    def _extract_usage(self, events: list[dict[str, Any]]) -> dict[str, int]:
        prompt_tokens = 0
        completion_tokens = 0
        total_tokens = 0
        has_tokens = False

        for event in events:
            part = event.get("part")
            if not isinstance(part, dict):
                continue
            tokens = part.get("tokens")
            if not isinstance(tokens, dict):
                continue

            has_tokens = True
            prompt = self._safe_int(
                tokens.get("input_tokens")
                or tokens.get("prompt_tokens")
                or tokens.get("input")
            )
            completion = self._safe_int(
                tokens.get("output_tokens")
                or tokens.get("completion_tokens")
                or tokens.get("output")
            )
            total = self._safe_int(tokens.get("total_tokens") or tokens.get("total"))
            if total == 0:
                total = prompt + completion

            prompt_tokens += prompt
            completion_tokens += completion
            total_tokens += total

        if has_tokens:
            return {
                "prompt_tokens": prompt_tokens,
                "completion_tokens": completion_tokens,
                "total_tokens": total_tokens,
            }

        for event in reversed(events):
            usage = event.get("usage")
            if not isinstance(usage, dict):
                continue

            prompt = self._safe_int(
                usage.get("input_tokens")
                or usage.get("prompt_tokens")
                or usage.get("input")
            )
            completion = self._safe_int(
                usage.get("output_tokens")
                or usage.get("completion_tokens")
                or usage.get("output")
            )
            total = self._safe_int(usage.get("total_tokens") or usage.get("total"))
            if total == 0:
                total = prompt + completion

            return {
                "prompt_tokens": prompt,
                "completion_tokens": completion,
                "total_tokens": total,
            }

        return {}

    def _extract_error_text(self, events: list[dict[str, Any]], stderr: str) -> str:
        for event in reversed(events):
            event_type = str(event.get("type") or "")
            if event_type in {"error", "fatal", "step_error"}:
                message = self._extract_error_message(event)
                if message:
                    return message

            if event.get("is_error") is True:
                message = self._extract_error_message(event)
                if message:
                    return message

            message = self._extract_error_message(event)
            if message and event_type not in {"text", "step_finish"}:
                return message

        stderr_lines = [line.strip() for line in stderr.splitlines() if line.strip()]
        return stderr_lines[-1] if stderr_lines else ""

    def _extract_error_message(self, event: dict[str, Any]) -> str:
        error = event.get("error")
        if isinstance(error, str) and error.strip():
            return error.strip()
        if isinstance(error, dict):
            message = error.get("message")
            if isinstance(message, str) and message.strip():
                return message.strip()

        part = event.get("part")
        if isinstance(part, dict):
            for key in ("error", "message"):
                value = part.get(key)
                if isinstance(value, str) and value.strip():
                    return value.strip()
                if isinstance(value, dict):
                    nested = value.get("message")
                    if isinstance(nested, str) and nested.strip():
                        return nested.strip()

        message = event.get("message")
        if isinstance(message, str) and message.strip():
            return message.strip()
        return ""

    def _extract_json_object(self, text: str) -> dict[str, Any] | None:
        if not text:
            return None

        candidate = text.strip()
        fence_match = re.match(
            r"^```(?:json)?\s*\n?(.*)\n?```\s*$", candidate, re.IGNORECASE | re.DOTALL
        )
        if fence_match:
            candidate = fence_match.group(1).strip()

        parsed = self._safe_json_loads(candidate)
        if isinstance(parsed, dict):
            return parsed

        decoder = json.JSONDecoder()
        for match in re.finditer(r"\{", candidate):
            start = match.start()
            try:
                obj, _ = decoder.raw_decode(candidate[start:])
            except json.JSONDecodeError:
                continue
            if isinstance(obj, dict):
                return obj

        return None

    def _extract_first_json_object_from_events(
        self, events: list[dict[str, Any]]
    ) -> dict[str, Any] | None:
        for event in reversed(events):
            for key in ("output", "text", "message", "content"):
                value = event.get(key)
                if isinstance(value, str):
                    parsed = self._extract_json_object(value)
                    if parsed is not None:
                        return parsed
            part = event.get("part")
            if isinstance(part, dict):
                for key in ("text", "content", "message"):
                    value = part.get(key)
                    if isinstance(value, str):
                        parsed = self._extract_json_object(value)
                        if parsed is not None:
                            return parsed
        return None

    @staticmethod
    def _safe_json_loads(text: str) -> Any | None:
        try:
            return json.loads(text)
        except json.JSONDecodeError:
            return None

    @staticmethod
    def _safe_int(value: Any) -> int:
        if value is None:
            return 0
        try:
            return int(value)
        except (TypeError, ValueError):
            return 0


class HandlerOpenCodeClient:
    def __init__(
        self,
        clarify_handler,
        build_handler,
        test_handler,
    ) -> None:
        self._clarify_handler = clarify_handler
        self._build_handler = build_handler
        self._test_handler = test_handler

    def clarify(self, task: Task) -> ClarifyResult:
        result = self._clarify_handler(task)
        if not isinstance(result, ClarifyResult):
            raise OpenCodeInvocationError("clarify handler must return ClarifyResult")
        return result

    def build(self, task: Task) -> BuildExecutionResult:
        result = self._build_handler(task)
        if not isinstance(result, BuildExecutionResult):
            raise OpenCodeInvocationError(
                "build handler must return BuildExecutionResult"
            )
        return result

    def run_test(self, task: Task, command: str) -> TestExecutionResult:
        result = self._test_handler(task, command)
        if not isinstance(result, TestExecutionResult):
            raise OpenCodeInvocationError(
                "test handler must return TestExecutionResult"
            )
        return result
