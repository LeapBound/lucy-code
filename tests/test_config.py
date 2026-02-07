from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from lucy_orchestrator.config import (
    init_config,
    load_config,
    load_feishu_credentials_from_config,
)


class TestConfig(unittest.TestCase):
    def test_init_config_creates_file(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            config_path = Path(tmp_dir) / "lucy.json"
            init_config(config_path=config_path)

            self.assertTrue(config_path.exists())
            config = load_config(config_path)
            self.assertFalse(config.channels.feishu.enabled)

    def test_init_config_from_nanobot_imports_feishu(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            nanobot_path = Path(tmp_dir) / "nanobot.json"
            nanobot_path.write_text(
                json.dumps(
                    {
                        "channels": {
                            "feishu": {
                                "enabled": True,
                                "appId": "cli_test",
                                "appSecret": "secret_test",
                                "verificationToken": "verify123",
                                "allowFrom": ["ou_1", "ou_2"],
                            }
                        }
                    }
                ),
                encoding="utf-8",
            )

            config_path = Path(tmp_dir) / "lucy.json"
            init_config(
                config_path=config_path,
                from_nanobot=True,
                nanobot_config_path=nanobot_path,
            )

            creds = load_feishu_credentials_from_config(config_path)
            self.assertEqual(creds.app_id, "cli_test")
            self.assertEqual(creds.app_secret, "secret_test")
            self.assertTrue(creds.enabled)

            config = load_config(config_path)
            self.assertEqual(config.channels.feishu.verification_token, "verify123")
            self.assertEqual(config.channels.feishu.allow_from, ["ou_1", "ou_2"])


if __name__ == "__main__":
    unittest.main()
