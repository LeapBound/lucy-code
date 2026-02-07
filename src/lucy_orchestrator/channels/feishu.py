from __future__ import annotations

import json
import urllib.error
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from ..exceptions import OrchestratorError


@dataclass
class FeishuRequirement:
    user_id: str
    chat_id: str
    message_id: str
    text: str


@dataclass
class FeishuAppCredentials:
    app_id: str
    app_secret: str
    enabled: bool = True


def load_feishu_credentials_from_nanobot(
    config_path: str | Path = "~/.nanobot/config.json",
) -> FeishuAppCredentials:
    path = Path(config_path).expanduser().resolve()
    if not path.exists():
        raise OrchestratorError(f"Nanobot config file not found: {path}")

    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise OrchestratorError(f"Invalid Nanobot config JSON: {exc}") from exc

    channels = payload.get("channels", {}) if isinstance(payload, dict) else {}
    feishu = channels.get("feishu", {}) if isinstance(channels, dict) else {}
    if not isinstance(feishu, dict):
        raise OrchestratorError("Nanobot config does not contain channels.feishu")

    app_id = str(feishu.get("appId") or feishu.get("app_id") or "").strip()
    app_secret = str(feishu.get("appSecret") or feishu.get("app_secret") or "").strip()
    enabled = bool(feishu.get("enabled", True))

    if not app_id or not app_secret:
        raise OrchestratorError("Nanobot feishu config missing appId/appSecret")

    return FeishuAppCredentials(app_id=app_id, app_secret=app_secret, enabled=enabled)


def parse_requirement_event(payload: dict[str, Any]) -> FeishuRequirement:
    event = payload.get("event", {})
    message = event.get("message", {})
    sender = event.get("sender", {})

    content_raw = message.get("content", "{}")
    content: dict[str, Any]
    if isinstance(content_raw, str):
        content = json.loads(content_raw)
    else:
        content = dict(content_raw)

    text = str(content.get("text", "")).strip()
    if not text:
        raise OrchestratorError("Feishu event does not contain text requirement")

    sender_id = (
        sender.get("sender_id", {}).get("open_id") or sender.get("open_id") or ""
    )
    chat_id = message.get("chat_id", "")
    message_id = message.get("message_id", "")

    if not sender_id or not chat_id or not message_id:
        raise OrchestratorError(
            "Feishu event is missing sender/chat/message identifiers"
        )

    return FeishuRequirement(
        user_id=sender_id,
        chat_id=chat_id,
        message_id=message_id,
        text=text,
    )


class FeishuMessenger:
    def __init__(
        self,
        app_id: str,
        app_secret: str,
        base_url: str = "https://open.feishu.cn/open-apis",
    ) -> None:
        self.app_id = app_id
        self.app_secret = app_secret
        self.base_url = base_url.rstrip("/")

    def send_text(self, chat_id: str, text: str) -> None:
        token = self._tenant_access_token()
        payload = {
            "receive_id": chat_id,
            "msg_type": "text",
            "content": json.dumps({"text": text}, ensure_ascii=False),
        }
        response = self._request(
            method="POST",
            path="/im/v1/messages?receive_id_type=chat_id",
            payload=payload,
            token=token,
        )
        if response.get("code") != 0:
            raise OrchestratorError(f"Failed to send Feishu message: {response}")

    def _tenant_access_token(self) -> str:
        payload = {"app_id": self.app_id, "app_secret": self.app_secret}
        response = self._request(
            method="POST",
            path="/auth/v3/tenant_access_token/internal",
            payload=payload,
            token=None,
        )
        if response.get("code") != 0:
            raise OrchestratorError(f"Failed to fetch tenant token: {response}")
        token = response.get("tenant_access_token")
        if not token:
            raise OrchestratorError("Feishu token response missing tenant_access_token")
        return str(token)

    def _request(
        self,
        method: str,
        path: str,
        payload: dict[str, Any],
        token: str | None,
    ) -> dict[str, Any]:
        data = json.dumps(payload).encode("utf-8")
        request = urllib.request.Request(
            url=f"{self.base_url}{path}",
            method=method,
            data=data,
            headers={"Content-Type": "application/json; charset=utf-8"},
        )
        if token:
            request.add_header("Authorization", f"Bearer {token}")

        try:
            with urllib.request.urlopen(request, timeout=15) as response:
                body = response.read().decode("utf-8")
        except urllib.error.URLError as exc:
            raise OrchestratorError(f"Feishu request failed: {exc}") from exc

        parsed = json.loads(body)
        if not isinstance(parsed, dict):
            raise OrchestratorError("Invalid Feishu response payload")
        return parsed
