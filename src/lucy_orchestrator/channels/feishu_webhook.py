from __future__ import annotations

import json
import threading
from dataclasses import dataclass
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import TYPE_CHECKING, Any

from ..exceptions import OrchestratorError
from .feishu import FeishuMessenger, parse_requirement_event

if TYPE_CHECKING:
    from ..orchestrator import Orchestrator


@dataclass
class FeishuWebhookSettings:
    repo_name: str
    base_branch: str = "main"
    worktree_path: str | None = None
    auto_clarify: bool = True
    auto_run_on_approve: bool = False
    auto_provision_worktree: bool = False
    repo_path: str | None = None
    worktrees_root: str | None = None
    branch_prefix: str = "agent"
    send_reply: bool = True
    allow_from: list[str] | None = None
    verification_token: str | None = None


class ProcessedMessageStore:
    def __init__(
        self, file_path: str | Path = ".orchestrator/feishu_seen_messages.json"
    ) -> None:
        self.file_path = Path(file_path)
        self._lock = threading.Lock()
        self._seen: set[str] = set()
        self._load()

    def contains(self, message_id: str) -> bool:
        with self._lock:
            return message_id in self._seen

    def add(self, message_id: str) -> None:
        with self._lock:
            if message_id in self._seen:
                return
            self._seen.add(message_id)
            self._persist()

    def _load(self) -> None:
        if not self.file_path.exists():
            return
        try:
            payload = json.loads(self.file_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            return
        if not isinstance(payload, list):
            return
        self._seen = {str(item) for item in payload}

    def _persist(self) -> None:
        self.file_path.parent.mkdir(parents=True, exist_ok=True)
        data = sorted(self._seen)
        self.file_path.write_text(
            json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8"
        )


class FeishuWebhookProcessor:
    def __init__(
        self,
        orchestrator: "Orchestrator",
        settings: FeishuWebhookSettings,
        messenger: FeishuMessenger | None = None,
        processed_store: ProcessedMessageStore | None = None,
    ) -> None:
        self.orchestrator = orchestrator
        self.settings = settings
        self.messenger = messenger
        self.processed_store = processed_store or ProcessedMessageStore()

    def process_payload(self, payload: dict[str, Any]) -> tuple[int, dict[str, Any]]:
        event_type = self._event_type(payload)
        if payload.get("type") == "url_verification":
            challenge = str(payload.get("challenge", ""))
            if not challenge:
                return HTTPStatus.BAD_REQUEST, {"error": "missing challenge"}
            return HTTPStatus.OK, {"challenge": challenge}

        if event_type and event_type != "im.message.receive_v1":
            return HTTPStatus.OK, {
                "status": "ignored",
                "reason": f"unsupported_event_type:{event_type}",
            }

        try:
            requirement = parse_requirement_event(payload)
        except OrchestratorError as exc:
            return HTTPStatus.BAD_REQUEST, {"error": str(exc)}

        if (
            self.settings.allow_from
            and requirement.user_id not in self.settings.allow_from
        ):
            return HTTPStatus.OK, {
                "status": "ignored",
                "reason": "sender_not_allowed",
                "user_id": requirement.user_id,
            }

        if self.processed_store.contains(requirement.message_id):
            return HTTPStatus.OK, {
                "status": "duplicate",
                "message_id": requirement.message_id,
            }

        try:
            task, reply_text = self.orchestrator.process_feishu_message(
                requirement=requirement,
                repo_name=self.settings.repo_name,
                base_branch=self.settings.base_branch,
                worktree_path=self.settings.worktree_path,
                auto_clarify=self.settings.auto_clarify,
                auto_run_on_approve=self.settings.auto_run_on_approve,
                auto_provision_worktree=self.settings.auto_provision_worktree,
                repo_path=self.settings.repo_path,
                worktrees_root=self.settings.worktrees_root,
                branch_prefix=self.settings.branch_prefix,
            )
        except Exception as exc:
            return HTTPStatus.INTERNAL_SERVER_ERROR, {
                "status": "error",
                "reason": "orchestrator_failed",
                "error": str(exc),
            }

        reply_sent = False
        if self.settings.send_reply and self.messenger is not None:
            try:
                self.messenger.send_text(requirement.chat_id, reply_text)
                reply_sent = True
            except Exception as exc:
                return HTTPStatus.INTERNAL_SERVER_ERROR, {
                    "status": "error",
                    "reason": "reply_send_failed",
                    "error": str(exc),
                    "task_id": task.task_id,
                }

        self.processed_store.add(requirement.message_id)
        return HTTPStatus.OK, {
            "status": "ok",
            "task_id": task.task_id,
            "task_state": task.state.value,
            "reply_sent": reply_sent,
        }

    def validate_token(self, payload: dict[str, Any]) -> bool:
        expected = self.settings.verification_token
        if not expected:
            return True

        token = payload.get("token")
        if not token:
            header = payload.get("header", {})
            if isinstance(header, dict):
                token = header.get("token")

        return str(token or "") == expected

    @staticmethod
    def _event_type(payload: dict[str, Any]) -> str:
        header = payload.get("header", {})
        if not isinstance(header, dict):
            return ""
        return str(header.get("event_type", ""))


def serve_feishu_webhook(
    processor: FeishuWebhookProcessor,
    *,
    host: str = "0.0.0.0",
    port: int = 18791,
) -> None:
    class _Handler(BaseHTTPRequestHandler):
        def do_GET(self) -> None:  # noqa: N802
            if self.path == "/health":
                self._json_response(HTTPStatus.OK, {"status": "ok"})
                return
            self._json_response(HTTPStatus.NOT_FOUND, {"error": "not_found"})

        def do_POST(self) -> None:  # noqa: N802
            content_length = self.headers.get("Content-Length", "0")
            try:
                body_bytes = self.rfile.read(int(content_length))
            except ValueError:
                self._json_response(
                    HTTPStatus.BAD_REQUEST, {"error": "invalid content length"}
                )
                return

            try:
                payload = json.loads(body_bytes.decode("utf-8"))
            except json.JSONDecodeError:
                self._json_response(HTTPStatus.BAD_REQUEST, {"error": "invalid json"})
                return

            if not isinstance(payload, dict):
                self._json_response(
                    HTTPStatus.BAD_REQUEST, {"error": "payload must be object"}
                )
                return

            if not processor.validate_token(payload):
                self._json_response(
                    HTTPStatus.FORBIDDEN, {"error": "invalid verification token"}
                )
                return

            code, response_payload = processor.process_payload(payload)
            self._json_response(code, response_payload)

        def log_message(self, format: str, *args: Any) -> None:  # noqa: A003
            return

        def _json_response(self, status: int, payload: dict[str, Any]) -> None:
            body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

    server = ThreadingHTTPServer((host, port), _Handler)
    try:
        server.serve_forever()
    finally:
        server.server_close()
