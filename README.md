# Lucy Orchestrator

Lucy Orchestrator is a Feishu-first coding agent scheduler built around OpenCode execution.

It treats OpenCode as a worker, while the orchestrator owns state, approval, policy, retries, and result reporting.

## Core Design

- Feishu is the human interface for requirements, clarification, approval, and status feedback.
- The orchestrator is the control plane: task state machine, policy gates, and execution lifecycle.
- OpenCode is the execution plane: clarify, build, and test operations.
- Worktree + container isolation is the default execution model.

## Task States

```
NEW -> CLARIFYING -> WAIT_APPROVAL -> RUNNING -> TESTING -> DONE
                                          \-> FAILED
FAILED -> RUNNING (retry)
```

Guard rails:

- RUNNING requires explicit approval and no open required questions.
- TESTING requires an existing diff artifact.
- DONE requires a generated test report.

## Project Layout

```
src/lucy_orchestrator/
  channels/            # Channel integrations (Feishu etc.)
  adapters/            # OpenCode integration boundaries
  cli.py               # Command-line entrypoint
  config.py            # Local config schema and loader
  exceptions.py        # Domain exceptions
  models.py            # Typed task/plan models
  orchestrator.py      # Main orchestration workflow
  plan.py              # Plan validation rules
  policy.py            # Path whitelist/blacklist policy checks
  state_machine.py     # State transitions and guards
  store.py             # JSON-backed task persistence
  worktree.py          # Git worktree manager
tests/
```

## Quickstart

```bash
python -m venv .venv
source .venv/bin/activate
pip install -e .
PYTHONPATH=src python -m unittest discover -s tests -p 'test_*.py'
```

Create and execute one task in local stub mode:

```bash
lucy-orchestrator create \
  --title "Add retry policy" \
  --description "Implement retry guard for failed tasks" \
  --chat-id "oc_xxx" \
  --user-id "ou_xxx"

lucy-orchestrator worktree-create --task-id <TASK_ID> --repo-path /path/to/repo
lucy-orchestrator clarify --task-id <TASK_ID>
lucy-orchestrator approval-message --task-id <TASK_ID> --user-id "ou_xxx" --text "同意，开始吧"
lucy-orchestrator run --task-id <TASK_ID>
lucy-orchestrator show --task-id <TASK_ID>
```

Initialize your own Lucy config (recommended first step):

```bash
lucy-orchestrator config-init --from-nanobot
lucy-orchestrator config-show
```

Config example is available at `examples/lucy_config.json`.

Process a real Feishu event payload and optionally send a reply using `~/.lucy-orchestrator/config.json` credentials:

```bash
lucy-orchestrator feishu-message \
  --payload-file examples/feishu_message_event.json \
  --repo-name lucy-code \
  --auto-provision-worktree \
  --repo-path /path/to/repo \
  --send-reply
```

Run a real Feishu webhook server:

```bash
lucy-orchestrator serve-feishu-webhook \
  --host 0.0.0.0 \
  --port 18791 \
  --repo-name lucy-code \
  --auto-provision-worktree \
  --repo-path /path/to/repo \
  --send-reply
```

Run with real OpenCode CLI mode:

```bash
lucy-orchestrator --opencode-mode cli --workspace /path/to/worktree clarify --task-id <TASK_ID>
lucy-orchestrator --opencode-mode cli --workspace /path/to/worktree run --task-id <TASK_ID>
```

Run OpenCode and tests in Docker with task worktree mounted:

```bash
lucy-orchestrator \
  --opencode-mode cli \
  --opencode-use-docker \
  --opencode-docker-image nanobot-opencode \
  --workspace /path/to/worktree \
  run --task-id <TASK_ID>
```

## Feishu + OpenCode Integration Notes

- `channels/feishu.py` handles Feishu event parsing and message sending.
- `channels/feishu_webhook.py` provides webhook processor/server with dedupe and verification token support.
- `config.py` manages Lucy local config at `~/.lucy-orchestrator/config.json`.
- `adapters/opencode.py` includes both a `StubOpenCodeClient` and `OpenCodeCLIClient`.
- `OpenCodeCLIClient` parses JSONL events, extracts usage/errors, mounts worktree into Docker when enabled, and writes raw agent logs to `.orchestrator/artifacts`.
- `intent.py` supports rules + optional LLM intent classification (`approve/reject/clarify/unknown`) for natural-language approval messages.
