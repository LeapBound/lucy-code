# Implementation Plan: Claude Code Executor

**Branch**: `001-cc-executor` | **Date**: 2025-11-24 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/001-cc-executor/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command. See `.specify/templates/commands/plan.md` for the execution workflow.

## Summary

This feature implements a Python library and CLI tool that automates code modification by invoking local Claude Code, capturing execution results, extracting Git diffs, and returning structured output (text/JSON/stream-JSON). Core capabilities include tool permission controls via environment variables and hook interception, session resumption via SQLite storage, execution timeout handling, Git working tree validation, and file-lock-based concurrency control to prevent repository conflicts.

Technical approach: Use subprocess to invoke `claude -p`, GitPython for diff extraction, SQLite for session persistence (7-day expiration with daily cleanup), filelock for cross-platform file locking, and Click for CLI framework. Output formats support both human-readable text and machine-parseable JSON for API integration.

## Technical Context

**Language/Version**: Python 3.11+
**Primary Dependencies**: subprocess (stdlib), GitPython, Click, filelock, pytest
**Storage**: SQLite (session data, execution history, 7-day expiration)
**Testing**: pytest (contract tests, integration tests, TDD mandatory)
**Target Platform**: Cross-platform CLI tool (Windows/Linux/macOS)
**Project Type**: Monorepo package (part of larger Lucy Code system with future API server + Android app)
**Performance Goals**: Handle 10MB diffs without memory issues, <5s overhead for subprocess invocation
**Constraints**: Must work offline (no external APIs), support Python 3.11+ (stdlib subprocess features)
**Scale/Scope**: Single-user local tool, 1-5 concurrent executions per repository (file-lock queued)

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

**Principle I - Specification-First Development**: ✅ PASS
- Spec defines 4 prioritized user stories (P1-P4) with independent acceptance criteria
- All functional requirements (FR-001 to FR-017) are testable
- Clarifications session resolved ambiguities (SQLite storage, env var hooks, default dirty-worktree policy)

**Principle II - Library-First Architecture**: ✅ PASS
- Core functionality exposed as Python library (`execute_instruction()` function)
- CLI wraps library with text in/out protocol (args → stdout, errors → stderr)
- Supports both JSON (machine) and text (human) output formats
- Single purpose: automate Claude Code invocation for code modification

**Principle III - Test-Driven Development**: ✅ PASS
- Contract tests required for `execute_instruction()` API (all 17 FRs testable)
- Integration tests required for 4 user stories (P1: basic execution, P2: JSON output, P3: tool control, P4: session resume)
- TDD workflow mandated: write tests → verify fail → implement → verify pass

**Principle IV - Iterative & Incremental Delivery**: ✅ PASS
- User stories prioritized P1-P4, each independently deliverable
- P1 (basic execution) delivers standalone value without P2-P4
- Each story has explicit acceptance criteria and "why this priority" justification
- Implementation phases: Setup → Foundational → P1 → P2 → P3 → P4 → Polish

**Principle V - Observability & Simplicity**: ✅ PASS
- Text-based I/O (subprocess stdout/stderr capture, Git diff text)
- Structured logging for all operations (verbose mode FR-007)
- No speculative features: implements only requested FRs (no web UI, no remote API)
- Complexity justified: file locking needed for concurrency, SQLite for session persistence

## Project Structure

### Documentation (this feature)

```text
specs/001-cc-executor/
├── plan.md              # This file (/speckit.plan command output)
├── research.md          # Phase 0 output (/speckit.plan command)
├── data-model.md        # Phase 1 output (/speckit.plan command)
├── quickstart.md        # Phase 1 output (/speckit.plan command)
├── contracts/           # Phase 1 output (/speckit.plan command)
│   ├── library_api.md   # Python library public interface
│   └── cli_interface.md # CLI arguments and exit codes
└── tasks.md             # Phase 2 output (/speckit.tasks command - NOT created by /speckit.plan)
```


### Source Code (repository root)

```text
packages/
├── cc-executor/                  # P1: Claude Code Executor (this feature)
│   ├── src/
│   │   └── cc_executor/
│   │       ├── __init__.py       # Public API exports
│   │       ├── models.py         # ExecutionRequest, ExecutionResult, DiffInfo, ToolConfig, Session
│   │       ├── executor.py       # Core execute_instruction() function
│   │       ├── subprocess_runner.py  # Claude Code subprocess invocation
│   │       ├── git_diff.py       # Git diff extraction via GitPython
│   │       ├── tool_control.py   # Environment variable + hook mechanism
│   │       ├── session_manager.py    # SQLite session persistence
│   │       ├── lock_manager.py   # File-lock based concurrency control
│   │       ├── output_formatter.py   # Text/JSON/stream-JSON formatters
│   │       └── cli.py            # Click-based CLI entry point
│   ├── tests/
│   │   ├── contract/
│   │   │   ├── test_library_api.py      # execute_instruction() contract
│   │   │   └── test_cli_interface.py    # CLI args/exit codes contract
│   │   ├── integration/
│   │   │   ├── test_user_story_p1.py    # Basic execution (User Story 1)
│   │   │   ├── test_user_story_p2.py    # JSON output (User Story 2)
│   │   │   ├── test_user_story_p3.py    # Tool control (User Story 3)
│   │   │   └── test_user_story_p4.py    # Session resume (User Story 4)
│   │   └── unit/
│   │       ├── test_subprocess_runner.py
│   │       ├── test_git_diff.py
│   │       ├── test_tool_control.py
│   │       ├── test_session_manager.py
│   │       ├── test_lock_manager.py
│   │       └── test_output_formatter.py
│   ├── pyproject.toml            # Package dependencies, CLI entry point
│   └── README.md                 # Package documentation
│
├── git-operations/               # P2: Future Git safety operations library
│   └── (future)
│
└── common/                       # Shared utilities (if needed in future)
    └── (future)

apps/
├── api-server/                   # P3: Future FastAPI REST API server
│   └── (future)
│
└── android/                      # P4: Future Android mobile app
    └── (future)

scripts/
└── cleanup_sessions.py           # Daily cron job for session expiration

specs/
└── 001-cc-executor/              # This feature's specification
    ├── spec.md
    ├── plan.md (this file)
    ├── research.md
    ├── data-model.md
    ├── quickstart.md
    ├── contracts/
    └── tasks.md (to be generated)
```

**Structure Decision**: Monorepo layout selected to support the larger Lucy Code ecosystem (see ROADMAP.md). This feature is implemented as `packages/cc-executor/`, a standalone library package that will be consumed by future components (P3: API server, P4: Android app). The monorepo structure enables:
- Library-First architecture (constitution principle II): Core functionality isolated in reusable packages
- Code sharing: Future packages can import `from cc_executor import execute_instruction`
- Unified versioning and testing across all Lucy Code components
- Clear separation: Libraries in `packages/`, applications in `apps/`, specs in `specs/`

The P1 package is fully self-contained with its own tests, dependencies (pyproject.toml), and documentation, allowing independent development while preparing for future integration.
## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

No violations detected. All constitution principles pass.
