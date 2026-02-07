from __future__ import annotations

import argparse
import json
from pathlib import Path

from .adapters.opencode import OpenCodeCLIClient, StubOpenCodeClient
from .channels.feishu import FeishuMessenger, parse_requirement_event
from .channels.feishu_webhook import (
    FeishuWebhookProcessor,
    FeishuWebhookSettings,
    ProcessedMessageStore,
    serve_feishu_webhook,
)
from .config import (
    DEFAULT_CONFIG_PATH,
    init_config,
    load_config,
    load_feishu_credentials_from_config,
)
from .intent import (
    HybridIntentClassifier,
    OpenCodeIntentClassifier,
    RuleBasedIntentClassifier,
)
from .models import RepoContext, TaskSource
from .orchestrator import Orchestrator
from .store import TaskStore


def _print_json(payload: dict[str, object]) -> None:
    print(json.dumps(payload, indent=2, ensure_ascii=False))


def _build_orchestrator(args: argparse.Namespace) -> Orchestrator:
    store = TaskStore(args.store_dir)
    if args.opencode_mode == "cli":
        opencode_client = OpenCodeCLIClient(
            artifact_root=args.artifact_dir,
            command=args.opencode_command,
            use_docker=args.opencode_use_docker,
            docker_image=args.opencode_docker_image,
            workspace=args.workspace,
            timeout=args.opencode_timeout,
            plan_agent=args.opencode_plan_agent,
            build_agent=args.opencode_build_agent,
        )
    else:
        opencode_client = StubOpenCodeClient(artifact_root=args.artifact_dir)

    intent_classifier = _build_intent_classifier(args)

    return Orchestrator(
        store=store,
        opencode_client=opencode_client,
        report_dir=args.report_dir,
        intent_classifier=intent_classifier,
    )


def _build_intent_classifier(args: argparse.Namespace):
    rule_classifier = RuleBasedIntentClassifier()
    llm_classifier = None
    if args.intent_mode in {"llm", "hybrid"} and args.opencode_mode == "cli":
        llm_classifier = OpenCodeIntentClassifier(
            command=args.opencode_command,
            timeout=args.opencode_timeout,
            use_docker=args.opencode_use_docker,
            docker_image=args.opencode_docker_image,
            workspace=args.workspace,
            agent=args.intent_agent,
        )

    if args.intent_mode == "rules":
        return rule_classifier
    if args.intent_mode == "llm":
        if llm_classifier is None:
            return rule_classifier
        return llm_classifier

    return HybridIntentClassifier(
        rule_classifier=rule_classifier,
        llm_classifier=llm_classifier,
        llm_threshold=args.intent_confidence_threshold,
    )


def _handle_create(orchestrator: Orchestrator, args: argparse.Namespace) -> None:
    task = orchestrator.create_task(
        title=args.title,
        description=args.description,
        source=TaskSource(
            type="feishu",
            user_id=args.user_id,
            chat_id=args.chat_id,
            message_id=args.message_id,
        ),
        repo=RepoContext(
            name=args.repo_name,
            base_branch=args.base_branch,
            worktree_path=args.worktree_path,
        ),
    )
    _print_json(task.to_dict())


def _handle_ingest_feishu(orchestrator: Orchestrator, args: argparse.Namespace) -> None:
    payload = json.loads(Path(args.payload_file).read_text(encoding="utf-8"))
    requirement = parse_requirement_event(payload)
    task = orchestrator.create_task_from_requirement(
        requirement=requirement,
        repo_name=args.repo_name,
        base_branch=args.base_branch,
        worktree_path=args.worktree_path,
    )
    _print_json(task.to_dict())


def _handle_feishu_message(
    orchestrator: Orchestrator, args: argparse.Namespace
) -> None:
    payload = json.loads(Path(args.payload_file).read_text(encoding="utf-8"))
    requirement = parse_requirement_event(payload)
    task, reply_text = orchestrator.process_feishu_message(
        requirement=requirement,
        repo_name=args.repo_name,
        base_branch=args.base_branch,
        worktree_path=args.worktree_path,
        auto_clarify=not args.no_auto_clarify,
        auto_run_on_approve=args.auto_run_on_approve,
        auto_provision_worktree=args.auto_provision_worktree,
        repo_path=args.repo_path,
        worktrees_root=args.worktrees_root,
        branch_prefix=args.branch_prefix,
    )

    sent = False
    if args.send_reply:
        credentials = load_feishu_credentials_from_config(args.config)
        messenger = FeishuMessenger(
            app_id=credentials.app_id,
            app_secret=credentials.app_secret,
        )
        messenger.send_text(requirement.chat_id, reply_text)
        sent = True

    _print_json(
        {
            "task_id": task.task_id,
            "state": task.state.value,
            "chat_id": requirement.chat_id,
            "reply_text": reply_text,
            "reply_sent": sent,
        }
    )


def _handle_feishu_webhook(
    orchestrator: Orchestrator, args: argparse.Namespace
) -> None:
    messenger = None
    if args.send_reply:
        credentials = load_feishu_credentials_from_config(args.config)
        messenger = FeishuMessenger(
            app_id=credentials.app_id,
            app_secret=credentials.app_secret,
        )

    config = load_config(args.config)
    feishu_channel = config.channels.feishu
    allow_from = feishu_channel.allow_from
    if args.allow_from:
        allow_from = [item.strip() for item in args.allow_from if item.strip()]

    settings = FeishuWebhookSettings(
        repo_name=args.repo_name,
        base_branch=args.base_branch,
        worktree_path=args.worktree_path,
        auto_clarify=not args.no_auto_clarify,
        auto_run_on_approve=args.auto_run_on_approve,
        auto_provision_worktree=args.auto_provision_worktree,
        repo_path=args.repo_path,
        worktrees_root=args.worktrees_root,
        branch_prefix=args.branch_prefix,
        send_reply=args.send_reply,
        allow_from=allow_from,
        verification_token=feishu_channel.verification_token or None,
    )

    processed_store = ProcessedMessageStore(args.processed_store)
    processor = FeishuWebhookProcessor(
        orchestrator=orchestrator,
        settings=settings,
        messenger=messenger,
        processed_store=processed_store,
    )

    _print_json(
        {
            "status": "starting",
            "host": args.host,
            "port": args.port,
            "send_reply": args.send_reply,
            "auto_provision_worktree": args.auto_provision_worktree,
        }
    )
    serve_feishu_webhook(
        processor,
        host=args.host,
        port=args.port,
    )


def _handle_config_init(_orchestrator: Orchestrator, args: argparse.Namespace) -> None:
    path = init_config(
        config_path=args.config,
        force=args.force,
        from_nanobot=args.from_nanobot,
        nanobot_config_path=args.nanobot_config,
    )
    _print_json(
        {
            "config_path": str(path),
            "from_nanobot": args.from_nanobot,
        }
    )


def _handle_config_show(_orchestrator: Orchestrator, args: argparse.Namespace) -> None:
    config = load_config(args.config)
    payload = config.to_dict()
    feishu = payload.get("channels", {}).get("feishu", {})
    if isinstance(feishu, dict) and feishu.get("appSecret"):
        secret = str(feishu["appSecret"])
        feishu["appSecret"] = "***" + secret[-4:] if len(secret) >= 4 else "***"

    _print_json(
        {
            "config_path": str(Path(args.config).expanduser().resolve()),
            "config": payload,
        }
    )


def _handle_clarify(orchestrator: Orchestrator, args: argparse.Namespace) -> None:
    task = orchestrator.clarify_task(args.task_id)
    _print_json(task.to_dict())


def _handle_approve(orchestrator: Orchestrator, args: argparse.Namespace) -> None:
    task = orchestrator.approve_task(args.task_id, approved_by=args.by)
    _print_json(task.to_dict())


def _handle_approval_message(
    orchestrator: Orchestrator, args: argparse.Namespace
) -> None:
    task = orchestrator.handle_approval_message(
        task_id=args.task_id,
        user_id=args.user_id,
        text=args.text,
    )
    _print_json(task.to_dict())


def _handle_run(orchestrator: Orchestrator, args: argparse.Namespace) -> None:
    task = orchestrator.run_task(args.task_id)
    _print_json(task.to_dict())


def _handle_worktree_create(
    orchestrator: Orchestrator, args: argparse.Namespace
) -> None:
    task = orchestrator.provision_worktree(
        task_id=args.task_id,
        repo_path=args.repo_path,
        worktrees_root=args.worktrees_root,
        branch_prefix=args.branch_prefix,
    )
    _print_json(task.to_dict())


def _handle_worktree_remove(
    orchestrator: Orchestrator, args: argparse.Namespace
) -> None:
    task = orchestrator.cleanup_worktree(
        task_id=args.task_id,
        repo_path=args.repo_path,
        worktrees_root=args.worktrees_root,
        force=args.force,
    )
    _print_json(task.to_dict())


def _handle_show(orchestrator: Orchestrator, args: argparse.Namespace) -> None:
    task = orchestrator.store.get(args.task_id)
    _print_json(task.to_dict())


def _handle_list(orchestrator: Orchestrator, _args: argparse.Namespace) -> None:
    tasks = orchestrator.store.list()
    payload = {
        "count": len(tasks),
        "tasks": [
            {
                "task_id": task.task_id,
                "title": task.title,
                "state": task.state.value,
                "updated_at": task.updated_at,
            }
            for task in tasks
        ],
    }
    _print_json(payload)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Lucy Orchestrator CLI")
    parser.add_argument("--config", default=DEFAULT_CONFIG_PATH)
    parser.add_argument("--store-dir", default=".orchestrator/tasks")
    parser.add_argument("--artifact-dir", default=".orchestrator/artifacts")
    parser.add_argument("--report-dir", default=".orchestrator/reports")
    parser.add_argument("--workspace", default=str(Path.cwd()))
    parser.add_argument("--opencode-mode", choices=["stub", "cli"], default="stub")
    parser.add_argument("--opencode-command", default="opencode")
    parser.add_argument("--opencode-timeout", type=int, default=900)
    parser.add_argument("--opencode-use-docker", action="store_true")
    parser.add_argument("--opencode-docker-image", default="nanobot-opencode")
    parser.add_argument("--opencode-plan-agent", default="plan")
    parser.add_argument("--opencode-build-agent", default="build")
    parser.add_argument(
        "--intent-mode", choices=["rules", "llm", "hybrid"], default="hybrid"
    )
    parser.add_argument("--intent-agent", default="plan")
    parser.add_argument("--intent-confidence-threshold", type=float, default=0.8)

    subparsers = parser.add_subparsers(dest="command", required=True)

    create_cmd = subparsers.add_parser("create", help="Create a task")
    create_cmd.add_argument("--title", required=True)
    create_cmd.add_argument("--description", required=True)
    create_cmd.add_argument("--chat-id", required=True)
    create_cmd.add_argument("--user-id", required=True)
    create_cmd.add_argument("--message-id", default="manual-message")
    create_cmd.add_argument("--repo-name", default="repository")
    create_cmd.add_argument("--base-branch", default="main")
    create_cmd.add_argument("--worktree-path", default=str(Path.cwd()))
    create_cmd.set_defaults(handler=_handle_create)

    ingest_cmd = subparsers.add_parser(
        "ingest-feishu", help="Create task from Feishu payload file"
    )
    ingest_cmd.add_argument("--payload-file", required=True)
    ingest_cmd.add_argument("--repo-name", default="repository")
    ingest_cmd.add_argument("--base-branch", default="main")
    ingest_cmd.add_argument("--worktree-path", default=str(Path.cwd()))
    ingest_cmd.set_defaults(handler=_handle_ingest_feishu)

    feishu_message_cmd = subparsers.add_parser(
        "feishu-message",
        help="Process one Feishu message payload and optionally send reply",
    )
    feishu_message_cmd.add_argument("--payload-file", required=True)
    feishu_message_cmd.add_argument("--repo-name", default="repository")
    feishu_message_cmd.add_argument("--base-branch", default="main")
    feishu_message_cmd.add_argument("--worktree-path", default=str(Path.cwd()))
    feishu_message_cmd.add_argument("--repo-path", default=str(Path.cwd()))
    feishu_message_cmd.add_argument("--worktrees-root")
    feishu_message_cmd.add_argument("--branch-prefix", default="agent")
    feishu_message_cmd.add_argument("--auto-provision-worktree", action="store_true")
    feishu_message_cmd.add_argument("--no-auto-clarify", action="store_true")
    feishu_message_cmd.add_argument("--auto-run-on-approve", action="store_true")
    feishu_message_cmd.add_argument("--send-reply", action="store_true")
    feishu_message_cmd.set_defaults(handler=_handle_feishu_message)

    feishu_webhook_cmd = subparsers.add_parser(
        "serve-feishu-webhook",
        help="Run Feishu webhook HTTP server",
    )
    feishu_webhook_cmd.add_argument("--host", default="0.0.0.0")
    feishu_webhook_cmd.add_argument("--port", type=int, default=18791)
    feishu_webhook_cmd.add_argument("--repo-name", default="repository")
    feishu_webhook_cmd.add_argument("--base-branch", default="main")
    feishu_webhook_cmd.add_argument("--worktree-path", default=str(Path.cwd()))
    feishu_webhook_cmd.add_argument("--repo-path", default=str(Path.cwd()))
    feishu_webhook_cmd.add_argument("--worktrees-root")
    feishu_webhook_cmd.add_argument("--branch-prefix", default="agent")
    feishu_webhook_cmd.add_argument("--auto-provision-worktree", action="store_true")
    feishu_webhook_cmd.add_argument("--no-auto-clarify", action="store_true")
    feishu_webhook_cmd.add_argument("--auto-run-on-approve", action="store_true")
    feishu_webhook_cmd.add_argument("--send-reply", action="store_true")
    feishu_webhook_cmd.add_argument(
        "--allow-from",
        nargs="*",
        default=[],
        help="Optional allowlist of sender open_id values",
    )
    feishu_webhook_cmd.add_argument(
        "--processed-store",
        default=".orchestrator/feishu_seen_messages.json",
    )
    feishu_webhook_cmd.set_defaults(handler=_handle_feishu_webhook)

    config_init_cmd = subparsers.add_parser(
        "config-init",
        help="Initialize Lucy config file",
    )
    config_init_cmd.add_argument("--force", action="store_true")
    config_init_cmd.add_argument("--from-nanobot", action="store_true")
    config_init_cmd.add_argument("--nanobot-config", default="~/.nanobot/config.json")
    config_init_cmd.set_defaults(handler=_handle_config_init)

    config_show_cmd = subparsers.add_parser(
        "config-show",
        help="Show Lucy config with secrets redacted",
    )
    config_show_cmd.set_defaults(handler=_handle_config_show)

    clarify_cmd = subparsers.add_parser(
        "clarify", help="Generate clarification and plan"
    )
    clarify_cmd.add_argument("--task-id", required=True)
    clarify_cmd.set_defaults(handler=_handle_clarify)

    approve_cmd = subparsers.add_parser("approve", help="Approve task")
    approve_cmd.add_argument("--task-id", required=True)
    approve_cmd.add_argument("--by", required=True)
    approve_cmd.set_defaults(handler=_handle_approve)

    approval_message_cmd = subparsers.add_parser(
        "approval-message",
        help="Classify approval intent from natural language message",
    )
    approval_message_cmd.add_argument("--task-id", required=True)
    approval_message_cmd.add_argument("--user-id", required=True)
    approval_message_cmd.add_argument("--text", required=True)
    approval_message_cmd.set_defaults(handler=_handle_approval_message)

    run_cmd = subparsers.add_parser("run", help="Run approved task")
    run_cmd.add_argument("--task-id", required=True)
    run_cmd.set_defaults(handler=_handle_run)

    worktree_create_cmd = subparsers.add_parser(
        "worktree-create", help="Create and attach task worktree"
    )
    worktree_create_cmd.add_argument("--task-id", required=True)
    worktree_create_cmd.add_argument("--repo-path", default=str(Path.cwd()))
    worktree_create_cmd.add_argument("--worktrees-root")
    worktree_create_cmd.add_argument("--branch-prefix", default="agent")
    worktree_create_cmd.set_defaults(handler=_handle_worktree_create)

    worktree_remove_cmd = subparsers.add_parser(
        "worktree-remove", help="Remove task worktree"
    )
    worktree_remove_cmd.add_argument("--task-id", required=True)
    worktree_remove_cmd.add_argument("--repo-path", default=str(Path.cwd()))
    worktree_remove_cmd.add_argument("--worktrees-root")
    worktree_remove_cmd.add_argument("--force", action="store_true")
    worktree_remove_cmd.set_defaults(handler=_handle_worktree_remove)

    show_cmd = subparsers.add_parser("show", help="Show task details")
    show_cmd.add_argument("--task-id", required=True)
    show_cmd.set_defaults(handler=_handle_show)

    list_cmd = subparsers.add_parser("list", help="List tasks")
    list_cmd.set_defaults(handler=_handle_list)

    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    orchestrator = _build_orchestrator(args)

    if args.command in {"ingest-feishu", "feishu-message"}:
        payload_path = Path(args.payload_file)
        if not payload_path.exists():
            parser.error(f"payload file does not exist: {payload_path}")

    args.handler(orchestrator, args)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
