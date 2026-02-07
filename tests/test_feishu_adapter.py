import unittest
import tempfile
from pathlib import Path

from lucy_orchestrator.adapters.feishu import (
    load_feishu_credentials_from_nanobot,
    parse_requirement_event,
)


class TestFeishuAdapter(unittest.TestCase):
    def test_parse_requirement_event(self) -> None:
        payload = {
            "event": {
                "sender": {"sender_id": {"open_id": "ou_1"}},
                "message": {
                    "message_id": "om_1",
                    "chat_id": "oc_1",
                    "content": '{"text":"Please add retry flow"}',
                },
            }
        }
        requirement = parse_requirement_event(payload)
        self.assertEqual(requirement.user_id, "ou_1")
        self.assertEqual(requirement.chat_id, "oc_1")
        self.assertEqual(requirement.message_id, "om_1")
        self.assertEqual(requirement.text, "Please add retry flow")

    def test_load_feishu_credentials_from_nanobot(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            config_path = Path(tmp_dir) / "config.json"
            config_path.write_text(
                """
{
  "channels": {
    "feishu": {
      "enabled": true,
      "appId": "cli_test",
      "appSecret": "secret_test"
    }
  }
}
                """.strip(),
                encoding="utf-8",
            )

            creds = load_feishu_credentials_from_nanobot(config_path)
            self.assertEqual(creds.app_id, "cli_test")
            self.assertEqual(creds.app_secret, "secret_test")
            self.assertTrue(creds.enabled)


if __name__ == "__main__":
    unittest.main()
