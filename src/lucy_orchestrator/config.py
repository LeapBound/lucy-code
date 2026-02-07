from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from .channels.feishu import FeishuAppCredentials
from .exceptions import OrchestratorError

DEFAULT_CONFIG_PATH = "~/.lucy-orchestrator/config.json"


@dataclass
class FeishuChannelConfig:
    enabled: bool = False
    app_id: str = ""
    app_secret: str = ""
    encrypt_key: str = ""
    verification_token: str = ""
    allow_from: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "enabled": self.enabled,
            "appId": self.app_id,
            "appSecret": self.app_secret,
            "encryptKey": self.encrypt_key,
            "verificationToken": self.verification_token,
            "allowFrom": list(self.allow_from),
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "FeishuChannelConfig":
        return cls(
            enabled=bool(data.get("enabled", False)),
            app_id=str(data.get("appId") or data.get("app_id") or ""),
            app_secret=str(data.get("appSecret") or data.get("app_secret") or ""),
            encrypt_key=str(data.get("encryptKey") or data.get("encrypt_key") or ""),
            verification_token=str(
                data.get("verificationToken") or data.get("verification_token") or ""
            ),
            allow_from=[str(item) for item in data.get("allowFrom", [])],
        )


@dataclass
class ChannelsConfig:
    feishu: FeishuChannelConfig = field(default_factory=FeishuChannelConfig)

    def to_dict(self) -> dict[str, Any]:
        return {
            "feishu": self.feishu.to_dict(),
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "ChannelsConfig":
        return cls(feishu=FeishuChannelConfig.from_dict(data.get("feishu", {})))


@dataclass
class AppConfig:
    channels: ChannelsConfig = field(default_factory=ChannelsConfig)

    def to_dict(self) -> dict[str, Any]:
        return {
            "channels": self.channels.to_dict(),
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "AppConfig":
        return cls(channels=ChannelsConfig.from_dict(data.get("channels", {})))


def default_config() -> AppConfig:
    return AppConfig()


def load_config(
    config_path: str | Path = DEFAULT_CONFIG_PATH,
    *,
    create_if_missing: bool = False,
) -> AppConfig:
    path = Path(config_path).expanduser().resolve()
    if not path.exists():
        if create_if_missing:
            config = default_config()
            save_config(config, path)
            return config
        raise OrchestratorError(f"Lucy config file not found: {path}")

    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise OrchestratorError(f"Invalid Lucy config JSON: {exc}") from exc

    if not isinstance(payload, dict):
        raise OrchestratorError("Lucy config root must be an object")
    return AppConfig.from_dict(payload)


def save_config(
    config: AppConfig, config_path: str | Path = DEFAULT_CONFIG_PATH
) -> Path:
    path = Path(config_path).expanduser().resolve()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(config.to_dict(), indent=2, ensure_ascii=False), encoding="utf-8"
    )
    return path


def init_config(
    config_path: str | Path = DEFAULT_CONFIG_PATH,
    *,
    force: bool = False,
    from_nanobot: bool = False,
    nanobot_config_path: str | Path = "~/.nanobot/config.json",
) -> Path:
    path = Path(config_path).expanduser().resolve()
    if path.exists() and not force:
        raise OrchestratorError(
            f"Lucy config already exists: {path}. Use force=True to overwrite."
        )

    config = default_config()
    if from_nanobot:
        config.channels.feishu = _load_feishu_channel_from_nanobot(nanobot_config_path)

    return save_config(config, path)


def load_feishu_credentials_from_config(
    config_path: str | Path = DEFAULT_CONFIG_PATH,
) -> FeishuAppCredentials:
    config = load_config(config_path)
    feishu = config.channels.feishu

    if not feishu.enabled:
        raise OrchestratorError(
            "Feishu channel is disabled in Lucy config. Enable channels.feishu.enabled first."
        )
    if not feishu.app_id or not feishu.app_secret:
        raise OrchestratorError(
            "Feishu credentials missing in Lucy config. Set channels.feishu.appId/appSecret."
        )

    return FeishuAppCredentials(
        app_id=feishu.app_id,
        app_secret=feishu.app_secret,
        enabled=feishu.enabled,
    )


def _load_feishu_channel_from_nanobot(
    nanobot_config_path: str | Path,
) -> FeishuChannelConfig:
    path = Path(nanobot_config_path).expanduser().resolve()
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
    if not app_id or not app_secret:
        raise OrchestratorError("Nanobot feishu config missing appId/appSecret")

    allow_from = [str(item) for item in feishu.get("allowFrom", [])]
    return FeishuChannelConfig(
        enabled=bool(feishu.get("enabled", True)),
        app_id=app_id,
        app_secret=app_secret,
        encrypt_key=str(feishu.get("encryptKey") or feishu.get("encrypt_key") or ""),
        verification_token=str(
            feishu.get("verificationToken") or feishu.get("verification_token") or ""
        ),
        allow_from=allow_from,
    )
