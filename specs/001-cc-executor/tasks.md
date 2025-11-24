# Implementation Tasks: Claude Code Executor

**Feature**: Claude Code Executor | **Branch**: `001-cc-executor` | **Date**: 2025-11-24

**Generated from**:
- spec.md: 4 user stories (P1-P4)
- plan.md: Monorepo structure, Python 3.11+, TDD mandatory
- data-model.md: 5 entities (ExecutionRequest, ExecutionResult, DiffInfo, ToolConfig, Session)
- contracts/library_api.md: execute_instruction() function, exceptions, session management
- contracts/cli_interface.md: 9 CLI options, 9 exit codes, 3 output formats

---

## Task Format Legend

```
- [ ] [T###] [P] [US#] Description with exact file path
```

- **Checkbox**: `- [ ]` (incomplete) or `- [x]` (complete)
- **Task ID**: T001, T002, etc. (unique identifier)
- **[P] marker**: ONLY if task is parallelizable (different files, no dependencies)
- **[US#] marker**: REQUIRED for user story phase tasks (US1, US2, US3, US4)
- **Description**: Must include exact file path relative to repo root

---

## Phase 1: Project Setup

**Goal**: Initialize monorepo package structure, dependencies, and testing framework.

### Package Structure

- [x] [T001] Create package directory structure at `packages/cc-executor/src/cc_executor/`
- [x] [T002] Create test directory structure at `packages/cc-executor/tests/` with subdirs: `contract/`, `integration/`, `unit/`
- [x] [T003] Create `packages/cc-executor/pyproject.toml` with dependencies: Click, GitPython, filelock, pytest
- [x] [T004] Create `packages/cc-executor/README.md` with package overview
- [x] [T005] Create `packages/cc-executor/src/cc_executor/__init__.py` with public API exports placeholder
- [x] [T006] Create `.gitignore` entry for `packages/cc-executor/__pycache__/`, `*.pyc`, `.pytest_cache/`

### Database and Scripts

- [x] [T007] Create `scripts/cleanup_sessions.py` stub for session cleanup cron job
- [x] [T008] Create default SQLite database path logic (FR-016) in session manager design

### Configuration

- [x] [T009] Document environment variables (CC_EXECUTOR_DB_PATH, CC_EXECUTOR_LOG_LEVEL, CC_EXECUTOR_DEFAULT_TIMEOUT) in README
- [ ] [T010] Verify Python 3.11+ is available on development machine

---

## Phase 2: Foundational Components (No User Story)

**Goal**: Implement core infrastructure components needed by all user stories.

### Data Models (Foundation)

- [x] [T011] [P] Create `packages/cc-executor/src/cc_executor/models.py` with all enums: OutputFormat, ExecutionStatus, DirtyWorktreePolicy, FileStatus, ToolMode, SessionStatus
- [x] [T012] [P] Add ExecutionRequest dataclass to `packages/cc-executor/src/cc_executor/models.py` with validation logic
- [x] [T013] [P] Add ExecutionResult dataclass to `packages/cc-executor/src/cc_executor/models.py`
- [x] [T014] [P] Add DiffInfo dataclass to `packages/cc-executor/src/cc_executor/models.py`
- [x] [T015] [P] Add ToolConfig dataclass to `packages/cc-executor/src/cc_executor/models.py` with mode derivation logic
- [x] [T016] [P] Add Session dataclass to `packages/cc-executor/src/cc_executor/models.py`

### Exception Hierarchy (Foundation)

- [x] [T017] Create `packages/cc-executor/src/cc_executor/exceptions.py` with CCExecutorError base class
- [x] [T018] Add all custom exceptions to `packages/cc-executor/src/cc_executor/exceptions.py`: ClaudeCodeNotFoundError, RepositoryNotFoundError, DirtyWorktreeError, ConcurrentExecutionError, ExecutionTimeoutError, GitError, SessionNotFoundError

### Lock Manager (Foundation - Required for FR-017)

- [x] [T019] Write unit tests for lock manager in `packages/cc-executor/tests/unit/test_lock_manager.py`: test_acquire_lock_success, test_lock_timeout, test_lock_release
- [x] [T020] Create `packages/cc-executor/src/cc_executor/lock_manager.py` with acquire_lock(), release_lock() using filelock library (FR-017)
- [x] [T021] Verify lock manager tests pass: `pytest packages/cc-executor/tests/unit/test_lock_manager.py -v`

---

## Phase 3: User Story 1 - Basic Execution (US1)

**Goal**: Implement core execution flow: invoke Claude Code, capture output, extract diffs, return results.

**Success Criteria**: Developer can execute a simple instruction and receive diff + commit hash (SC-001).

**Functional Requirements**: FR-001, FR-002, FR-003, FR-005, FR-010, FR-011, FR-012, FR-015

### Contract Tests First (TDD)

- [x] [T022] [P] [US1] Write contract test for successful execution in `packages/cc-executor/tests/contract/test_library_api.py`: test_execute_instruction_success (FR-001, FR-002, FR-003, FR-005)
- [x] [T023] [P] [US1] Write contract test for execution failure in `packages/cc-executor/tests/contract/test_library_api.py`: test_execute_instruction_failure (FR-010)
- [x] [T024] [P] [US1] Write contract test for timeout handling in `packages/cc-executor/tests/contract/test_library_api.py`: test_execute_instruction_timeout (FR-011)
- [x] [T025] [P] [US1] Write contract test for dirty worktree block in `packages/cc-executor/tests/contract/test_library_api.py`: test_dirty_worktree_block (FR-012)
- [x] [T026] [P] [US1] Write contract test for ClaudeCodeNotFoundError in `packages/cc-executor/tests/contract/test_library_api.py`: test_claude_not_found_error (FR-010)
- [x] [T027] [P] [US1] Write contract test for RepositoryNotFoundError in `packages/cc-executor/tests/contract/test_library_api.py`: test_repository_not_found_error (FR-010)

### Integration Test (TDD)

- [x] [T028] [US1] Write integration test for User Story 1 in `packages/cc-executor/tests/integration/test_user_story_p1.py`: test_basic_task_execution_full_flow (all acceptance scenarios)

### Verify Tests Fail

- [x] [T029] [US1] Run contract tests and verify they fail (TDD red phase): `pytest packages/cc-executor/tests/contract/test_library_api.py -v`
- [x] [T030] [US1] Run integration test and verify it fails (TDD red phase): `pytest packages/cc-executor/tests/integration/test_user_story_p1.py -v`

### Core Implementation

- [x] [T031] [US1] Write unit tests for subprocess runner in `packages/cc-executor/tests/unit/test_subprocess_runner.py`: test_invoke_claude_success, test_invoke_claude_timeout, test_capture_stdout_stderr
- [x] [T032] [US1] Create `packages/cc-executor/src/cc_executor/subprocess_runner.py` with invoke_claude() function using subprocess.run (FR-001, FR-002)
- [x] [T033] [US1] Add timeout mechanism to `packages/cc-executor/src/cc_executor/subprocess_runner.py` using subprocess timeout parameter (FR-011)
- [x] [T034] [US1] Add Claude Code existence check to `packages/cc-executor/src/cc_executor/subprocess_runner.py` using shutil.which() (FR-010)
- [x] [T035] [US1] Verify subprocess runner unit tests pass: `pytest packages/cc-executor/tests/unit/test_subprocess_runner.py -v`

### Git Operations

- [x] [T036] [US1] Write unit tests for git_diff module in `packages/cc-executor/tests/unit/test_git_diff.py`: test_extract_diff, test_get_commit_hash, test_list_changed_files, test_check_dirty_worktree
- [x] [T037] [US1] Create `packages/cc-executor/src/cc_executor/git_diff.py` with extract_diff() using GitPython (FR-003)
- [x] [T038] [US1] Add get_commit_hash() to `packages/cc-executor/src/cc_executor/git_diff.py` for latest commit SHA
- [x] [T039] [US1] Add list_changed_files() to `packages/cc-executor/src/cc_executor/git_diff.py` for files_changed field (FR-005)
- [x] [T040] [US1] Add check_dirty_worktree() to `packages/cc-executor/src/cc_executor/git_diff.py` for FR-012 validation
- [x] [T041] [US1] Verify git_diff unit tests pass: `pytest packages/cc-executor/tests/unit/test_git_diff.py -v`

### Main Executor Function

- [x] [T042] [US1] Create `packages/cc-executor/src/cc_executor/executor.py` with execute_instruction() function signature
- [x] [T043] [US1] Implement request validation in `packages/cc-executor/src/cc_executor/executor.py` (validate_execution_request)
- [x] [T044] [US1] Implement repository validation in `packages/cc-executor/src/cc_executor/executor.py` (check Git repo exists)
- [x] [T045] [US1] Implement dirty worktree check in `packages/cc-executor/src/cc_executor/executor.py` (FR-012: block policy)
- [x] [T046] [US1] Integrate lock_manager.acquire_lock() at start of execute_instruction() (FR-017)
- [x] [T047] [US1] Integrate subprocess_runner.invoke_claude() in execute_instruction()
- [x] [T048] [US1] Integrate git_diff.extract_diff() and related functions in execute_instruction()
- [x] [T049] [US1] Implement ExecutionResult construction with all required fields (FR-005)
- [x] [T050] [US1] Implement error handling and exception mapping in execute_instruction() (FR-010)
- [x] [T051] [US1] Implement execution logging to file for auditing (FR-015)
- [x] [T052] [US1] Release lock in finally block of execute_instruction() (FR-017)

### Basic CLI (Text Output Only)

- [x] [T053] [US1] Create `packages/cc-executor/src/cc_executor/cli.py` with Click app skeleton
- [x] [T054] [US1] Add --instruction option to `packages/cc-executor/src/cc_executor/cli.py` (required)
- [x] [T055] [US1] Add --timeout option to `packages/cc-executor/src/cc_executor/cli.py` (default 600)
- [x] [T056] [US1] Add --dirty-worktree option to `packages/cc-executor/src/cc_executor/cli.py` (default block)
- [x] [T057] [US1] Add --repo-path option to `packages/cc-executor/src/cc_executor/cli.py` (default CWD)
- [x] [T058] [US1] Implement text output formatter in `packages/cc-executor/src/cc_executor/cli.py` for ExecutionResult (FR-004: text format)
- [x] [T059] [US1] Implement exit code mapping in `packages/cc-executor/src/cc_executor/cli.py` (9 exit codes per contract)
- [x] [T060] [US1] Add CLI entry point to `packages/cc-executor/pyproject.toml`: `cc-executor = cc_executor.cli:main`

### Public API Exports

- [x] [T061] [US1] Update `packages/cc-executor/src/cc_executor/__init__.py` to export: execute_instruction, ExecutionRequest, ExecutionResult, all exceptions, all enums

### Verify TDD Green Phase

- [x] [T062] [US1] Run all contract tests and verify they pass: `pytest packages/cc-executor/tests/contract/test_library_api.py -v`
- [x] [T063] [US1] Run User Story 1 integration test and verify it passes: `pytest packages/cc-executor/tests/integration/test_user_story_p1.py -v`
- [x] [T064] [US1] Manually test CLI with simple instruction: `cc-executor --instruction "Add hello world function"`
- [x] [T065] [US1] Verify SC-001: execution completes in under 30 seconds for simple instruction

---

## Phase 4: User Story 2 - Structured Output (US2)

**Goal**: Add JSON and stream-JSON output formats for machine-parseable results.

**Success Criteria**: JSON output is 100% parseable by standard parsers (SC-004).

**Functional Requirements**: FR-004, FR-007

### Contract Tests First (TDD)

- [ ] [T066] [P] [US2] Write contract test for JSON output in `packages/cc-executor/tests/contract/test_library_api.py`: test_json_output_format (FR-004)
- [ ] [T067] [P] [US2] Write contract test for stream-JSON output in `packages/cc-executor/tests/contract/test_library_api.py`: test_stream_json_output_format (FR-004)
- [ ] [T068] [P] [US2] Write contract test for verbose logging in `packages/cc-executor/tests/contract/test_library_api.py`: test_verbose_logging (FR-007)
- [ ] [T069] [P] [US2] Write CLI contract test for JSON output in `packages/cc-executor/tests/contract/test_cli_interface.py`: test_cli_json_output
- [ ] [T070] [P] [US2] Write CLI contract test for JSON parseability in `packages/cc-executor/tests/contract/test_cli_interface.py`: test_json_is_parseable (SC-004)

### Integration Test (TDD)

- [ ] [T071] [US2] Write integration test for User Story 2 in `packages/cc-executor/tests/integration/test_user_story_p2.py`: test_structured_output_json (all acceptance scenarios)

### Verify Tests Fail

- [ ] [T072] [US2] Run new contract tests and verify they fail (TDD red phase): `pytest packages/cc-executor/tests/contract/ -k "json or verbose" -v`
- [ ] [T073] [US2] Run integration test and verify it fails (TDD red phase): `pytest packages/cc-executor/tests/integration/test_user_story_p2.py -v`

### Implementation

- [ ] [T074] [US2] Write unit tests for output formatter in `packages/cc-executor/tests/unit/test_output_formatter.py`: test_format_text, test_format_json, test_format_stream_json
- [ ] [T075] [US2] Create `packages/cc-executor/src/cc_executor/output_formatter.py` with format_as_text() function
- [ ] [T076] [US2] Add format_as_json() to `packages/cc-executor/src/cc_executor/output_formatter.py` with proper datetime serialization (FR-004)
- [ ] [T077] [US2] Add format_as_stream_json() to `packages/cc-executor/src/cc_executor/output_formatter.py` for NDJSON format (FR-004)
- [ ] [T078] [US2] Add verbose logging integration to `packages/cc-executor/src/cc_executor/executor.py` using Python logging module (FR-007)
- [ ] [T079] [US2] Verify output formatter unit tests pass: `pytest packages/cc-executor/tests/unit/test_output_formatter.py -v`

### CLI Integration

- [ ] [T080] [US2] Add --output-format option to `packages/cc-executor/src/cc_executor/cli.py` (choices: text, json, stream-json)
- [ ] [T081] [US2] Add --verbose flag to `packages/cc-executor/src/cc_executor/cli.py`
- [ ] [T082] [US2] Integrate output_formatter module in `packages/cc-executor/src/cc_executor/cli.py` based on --output-format
- [ ] [T083] [US2] Update `packages/cc-executor/src/cc_executor/__init__.py` to export OutputFormat enum

### Verify TDD Green Phase

- [ ] [T084] [US2] Run all contract tests and verify they pass: `pytest packages/cc-executor/tests/contract/ -k "json or verbose" -v`
- [ ] [T085] [US2] Run User Story 2 integration test and verify it passes: `pytest packages/cc-executor/tests/integration/test_user_story_p2.py -v`
- [ ] [T086] [US2] Manually test CLI with JSON output: `cc-executor --instruction "test" --output-format json | jq .`
- [ ] [T087] [US2] Verify SC-004: JSON output is parseable by Python json.loads() and jq

---

## Phase 5: User Story 3 - Tool Control (US3)

**Goal**: Implement tool permission restrictions via environment variables and hook mechanism.

**Success Criteria**: Tool restrictions are 100% enforced (SC-007).

**Functional Requirements**: FR-006

### Contract Tests First (TDD)

- [ ] [T088] [P] [US3] Write contract test for allowed_tools whitelist in `packages/cc-executor/tests/contract/test_library_api.py`: test_allowed_tools_whitelist (FR-006)
- [ ] [T089] [P] [US3] Write contract test for disallowed_tools blacklist in `packages/cc-executor/tests/contract/test_library_api.py`: test_disallowed_tools_blacklist (FR-006)
- [ ] [T090] [P] [US3] Write contract test for tool restriction enforcement in `packages/cc-executor/tests/contract/test_library_api.py`: test_tool_restriction_enforcement (SC-007)
- [ ] [T091] [P] [US3] Write CLI contract test for --allowed-tools in `packages/cc-executor/tests/contract/test_cli_interface.py`: test_cli_allowed_tools
- [ ] [T092] [P] [US3] Write CLI contract test for --disallowed-tools in `packages/cc-executor/tests/contract/test_cli_interface.py`: test_cli_disallowed_tools
- [ ] [T093] [P] [US3] Write CLI contract test for mutual exclusion in `packages/cc-executor/tests/contract/test_cli_interface.py`: test_cli_tool_options_mutual_exclusion

### Integration Test (TDD)

- [ ] [T094] [US3] Write integration test for User Story 3 in `packages/cc-executor/tests/integration/test_user_story_p3.py`: test_tool_permission_control (all acceptance scenarios)

### Verify Tests Fail

- [ ] [T095] [US3] Run new contract tests and verify they fail (TDD red phase): `pytest packages/cc-executor/tests/contract/ -k "tool" -v`
- [ ] [T096] [US3] Run integration test and verify it fails (TDD red phase): `pytest packages/cc-executor/tests/integration/test_user_story_p3.py -v`

### Implementation

- [ ] [T097] [US3] Write unit tests for tool_control module in `packages/cc-executor/tests/unit/test_tool_control.py`: test_set_tool_env_vars, test_validate_tool_config, test_hook_mechanism
- [ ] [T098] [US3] Create `packages/cc-executor/src/cc_executor/tool_control.py` with set_tool_env_vars() function (FR-006)
- [ ] [T099] [US3] Add validate_tool_config() to `packages/cc-executor/src/cc_executor/tool_control.py` for ToolConfig validation
- [ ] [T100] [US3] Research and document hook mechanism for tool interception in `packages/cc-executor/src/cc_executor/tool_control.py` (FR-006: advisory mode)
- [ ] [T101] [US3] Implement environment variable setting (CLAUDE_ALLOWED_TOOLS, CLAUDE_DISALLOWED_TOOLS) in tool_control module
- [ ] [T102] [US3] Verify tool_control unit tests pass: `pytest packages/cc-executor/tests/unit/test_tool_control.py -v`

### Executor Integration

- [ ] [T103] [US3] Integrate tool_control.set_tool_env_vars() in `packages/cc-executor/src/cc_executor/executor.py` before subprocess invocation
- [ ] [T104] [US3] Add ToolConfig derivation logic in `packages/cc-executor/src/cc_executor/executor.py` from ExecutionRequest

### CLI Integration

- [ ] [T105] [US3] Add --allowed-tools option to `packages/cc-executor/src/cc_executor/cli.py` (comma-separated)
- [ ] [T106] [US3] Add --disallowed-tools option to `packages/cc-executor/src/cc_executor/cli.py` (comma-separated)
- [ ] [T107] [US3] Add mutual exclusion validation in `packages/cc-executor/src/cc_executor/cli.py` for tool options (exit code 2)
- [ ] [T108] [US3] Update `packages/cc-executor/src/cc_executor/__init__.py` to export ToolConfig, ToolMode

### Verify TDD Green Phase

- [ ] [T109] [US3] Run all contract tests and verify they pass: `pytest packages/cc-executor/tests/contract/ -k "tool" -v`
- [ ] [T110] [US3] Run User Story 3 integration test and verify it passes: `pytest packages/cc-executor/tests/integration/test_user_story_p3.py -v`
- [ ] [T111] [US3] Manually test CLI with tool restrictions: `cc-executor --instruction "test" --allowed-tools "Read,Write,Edit"`
- [ ] [T112] [US3] Verify SC-007: Tool restrictions are enforced (check environment variables are set)

---

## Phase 6: User Story 4 - Session Resume (US4)

**Goal**: Implement session persistence via SQLite for multi-turn conversations.

**Success Criteria**: Session resume success rate 95% (SC-005), sessions expire after 7 days (FR-016).

**Functional Requirements**: FR-008, FR-009, FR-016

### Contract Tests First (TDD)

- [ ] [T113] [P] [US4] Write contract test for session creation in `packages/cc-executor/tests/contract/test_library_api.py`: test_session_creation (FR-008)
- [ ] [T114] [P] [US4] Write contract test for session resume in `packages/cc-executor/tests/contract/test_library_api.py`: test_session_resume (FR-008)
- [ ] [T115] [P] [US4] Write contract test for continue_last in `packages/cc-executor/tests/contract/test_library_api.py`: test_continue_last_session (FR-009)
- [ ] [T116] [P] [US4] Write contract test for SessionNotFoundError in `packages/cc-executor/tests/contract/test_library_api.py`: test_session_not_found_error
- [ ] [T117] [P] [US4] Write contract test for get_session() in `packages/cc-executor/tests/contract/test_library_api.py`: test_get_session_function
- [ ] [T118] [P] [US4] Write contract test for list_sessions() in `packages/cc-executor/tests/contract/test_library_api.py`: test_list_sessions_function
- [ ] [T119] [P] [US4] Write contract test for cleanup_expired_sessions() in `packages/cc-executor/tests/contract/test_library_api.py`: test_cleanup_expired_sessions (FR-016)
- [ ] [T120] [P] [US4] Write CLI contract test for --resume in `packages/cc-executor/tests/contract/test_cli_interface.py`: test_cli_resume_option
- [ ] [T121] [P] [US4] Write CLI contract test for --continue in `packages/cc-executor/tests/contract/test_cli_interface.py`: test_cli_continue_option
- [ ] [T122] [P] [US4] Write CLI contract test for session mutual exclusion in `packages/cc-executor/tests/contract/test_cli_interface.py`: test_cli_session_options_mutual_exclusion

### Integration Test (TDD)

- [ ] [T123] [US4] Write integration test for User Story 4 in `packages/cc-executor/tests/integration/test_user_story_p4.py`: test_session_resume_multi_turn (all acceptance scenarios)

### Verify Tests Fail

- [ ] [T124] [US4] Run new contract tests and verify they fail (TDD red phase): `pytest packages/cc-executor/tests/contract/ -k "session" -v`
- [ ] [T125] [US4] Run integration test and verify it fails (TDD red phase): `pytest packages/cc-executor/tests/integration/test_user_story_p4.py -v`

### SQLite Schema

- [ ] [T126] [US4] Create SQLite schema in `packages/cc-executor/src/cc_executor/session_manager.py`: sessions table, conversation_messages table, executions table (per data-model.md)
- [ ] [T127] [US4] Implement database initialization logic in session_manager (create tables if not exist)
- [ ] [T128] [US4] Document schema and foreign key policy (no FK constraints per global instruction) in code comments

### Session Manager Implementation

- [ ] [T129] [US4] Write unit tests for session_manager in `packages/cc-executor/tests/unit/test_session_manager.py`: test_create_session, test_get_session, test_update_session, test_list_sessions, test_cleanup_expired
- [ ] [T130] [US4] Implement create_session() in `packages/cc-executor/src/cc_executor/session_manager.py` (FR-008)
- [ ] [T131] [US4] Implement get_session() in `packages/cc-executor/src/cc_executor/session_manager.py` (FR-008)
- [ ] [T132] [US4] Implement update_session() in `packages/cc-executor/src/cc_executor/session_manager.py` (update last_accessed, conversation_history)
- [ ] [T133] [US4] Implement list_sessions() in `packages/cc-executor/src/cc_executor/session_manager.py` with filtering (FR-009)
- [ ] [T134] [US4] Implement cleanup_expired_sessions() in `packages/cc-executor/src/cc_executor/session_manager.py` (FR-016: 7-day expiration)
- [ ] [T135] [US4] Implement persist_execution() in `packages/cc-executor/src/cc_executor/session_manager.py` to log ExecutionResult to database (FR-015)
- [ ] [T136] [US4] Verify session_manager unit tests pass: `pytest packages/cc-executor/tests/unit/test_session_manager.py -v`

### Executor Integration

- [ ] [T137] [US4] Integrate session_manager in `packages/cc-executor/src/cc_executor/executor.py`: handle resume_session_id
- [ ] [T138] [US4] Integrate session_manager in `packages/cc-executor/src/cc_executor/executor.py`: handle continue_last
- [ ] [T139] [US4] Add session creation logic at start of execute_instruction() if no resume/continue
- [ ] [T140] [US4] Add session update logic at end of execute_instruction() (update last_accessed, append to conversation_history)
- [ ] [T141] [US4] Add execution persistence logic in execute_instruction() (call persist_execution)

### CLI Integration

- [ ] [T142] [US4] Add --resume option to `packages/cc-executor/src/cc_executor/cli.py` (session ID string)
- [ ] [T143] [US4] Add --continue flag to `packages/cc-executor/src/cc_executor/cli.py`
- [ ] [T144] [US4] Add mutual exclusion validation in `packages/cc-executor/src/cc_executor/cli.py` for session options (exit code 2)
- [ ] [T145] [US4] Update `packages/cc-executor/src/cc_executor/__init__.py` to export Session, SessionStatus, get_session, list_sessions, cleanup_expired_sessions

### Cleanup Script

- [ ] [T146] [US4] Implement `scripts/cleanup_sessions.py` as CLI-invokable script calling cleanup_expired_sessions()
- [ ] [T147] [US4] Add usage instructions for cron job setup to `packages/cc-executor/README.md` (FR-016)

### Verify TDD Green Phase

- [ ] [T148] [US4] Run all contract tests and verify they pass: `pytest packages/cc-executor/tests/contract/ -k "session" -v`
- [ ] [T149] [US4] Run User Story 4 integration test and verify it passes: `pytest packages/cc-executor/tests/integration/test_user_story_p4.py -v`
- [ ] [T150] [US4] Manually test CLI with session resume: create session, then resume with second instruction
- [ ] [T151] [US4] Manually test session cleanup script: `python scripts/cleanup_sessions.py`
- [ ] [T152] [US4] Verify SC-005: Session resume works consistently (run integration test 20 times, expect 19+ passes)

---

## Phase 7: Polish and Final Validation

**Goal**: Complete remaining functional requirements, edge case handling, and full system testing.

### Edge Case Handling

- [ ] [T153] [P] Add stash policy implementation to `packages/cc-executor/src/cc_executor/git_diff.py`: stash_changes(), restore_stash() (FR-012)
- [ ] [T154] [P] Add allow policy validation to `packages/cc-executor/src/cc_executor/executor.py` (FR-012)
- [ ] [T155] [P] Write unit test for large diff handling in `packages/cc-executor/tests/unit/test_git_diff.py`: test_large_diff_10mb (SC-002)
- [ ] [T156] [P] Add memory-efficient diff handling to `packages/cc-executor/src/cc_executor/git_diff.py` (streaming or chunking for SC-002)
- [ ] [T157] [P] Write unit test for special character handling in `packages/cc-executor/tests/unit/test_subprocess_runner.py`: test_special_characters_in_instruction (Edge Cases)
- [ ] [T158] [P] Write unit test for concurrent execution in `packages/cc-executor/tests/unit/test_lock_manager.py`: test_concurrent_execution_queue (FR-017, Edge Cases)

### CLI Contract Tests

- [ ] [T159] [P] Write CLI contract test for all exit codes in `packages/cc-executor/tests/contract/test_cli_interface.py`: test_cli_exit_codes (9 exit codes)
- [ ] [T160] [P] Write CLI contract test for help text in `packages/cc-executor/tests/contract/test_cli_interface.py`: test_cli_help_text
- [ ] [T161] [P] Write CLI contract test for environment variable overrides in `packages/cc-executor/tests/contract/test_cli_interface.py`: test_cli_env_var_overrides
- [ ] [T162] [P] Write CLI contract test for large output in `packages/cc-executor/tests/contract/test_cli_interface.py`: test_cli_large_output_10mb (SC-002)

### Error Message Improvements

- [ ] [T163] Add clear error messages for all exception types in `packages/cc-executor/src/cc_executor/exceptions.py` (SC-003)
- [ ] [T164] Add actionable error messages to CLI output in `packages/cc-executor/src/cc_executor/cli.py` (SC-003)
- [ ] [T165] Write test for error message clarity in `packages/cc-executor/tests/contract/test_library_api.py`: test_error_message_clarity (SC-003)

### Documentation

- [ ] [T166] [P] Update `packages/cc-executor/README.md` with installation instructions (pip install)
- [ ] [T167] [P] Update `packages/cc-executor/README.md` with usage examples for all 4 user stories
- [ ] [T168] [P] Update `packages/cc-executor/README.md` with CLI reference (all 9 options)
- [ ] [T169] [P] Update `packages/cc-executor/README.md` with library API reference (execute_instruction signature)
- [ ] [T170] [P] Update `packages/cc-executor/README.md` with exit code reference table
- [ ] [T171] [P] Update `packages/cc-executor/README.md` with troubleshooting section (common errors)

### Full System Testing

- [ ] [T172] Run all contract tests: `pytest packages/cc-executor/tests/contract/ -v`
- [ ] [T173] Run all integration tests: `pytest packages/cc-executor/tests/integration/ -v`
- [ ] [T174] Run all unit tests: `pytest packages/cc-executor/tests/unit/ -v`
- [ ] [T175] Run full test suite with coverage: `pytest packages/cc-executor/tests/ --cov=cc_executor --cov-report=html`
- [ ] [T176] Verify test coverage is at least 90% for all modules

### Success Criteria Validation

- [ ] [T177] [P] Validate SC-001: Execute simple instruction in under 30 seconds
- [ ] [T178] [P] Validate SC-002: Handle 10MB diff without memory issues (load test)
- [ ] [T179] [P] Validate SC-003: 90% of error cases have clear messages (error message audit)
- [ ] [T180] [P] Validate SC-004: JSON output 100% parseable (test with Python json + jq)
- [ ] [T181] [P] Validate SC-005: Session resume 95% success rate (run 20 times)
- [ ] [T182] [P] Validate SC-006: Timeout mechanism accurate within ±5 seconds (timeout accuracy test)
- [ ] [T183] [P] Validate SC-007: Tool restrictions 100% enforced (security test)
- [ ] [T184] [P] Validate SC-008: All executions logged to audit file (log file inspection)

### Final Integration

- [ ] [T185] Install package locally: `pip install -e packages/cc-executor/`
- [ ] [T186] Manually test all 4 user story scenarios end-to-end with installed CLI
- [ ] [T187] Test on Windows (primary development platform per env context)
- [ ] [T188] Document any platform-specific issues in README.md

---

## Dependencies and Execution Strategy

### Phase Dependencies (Sequential)

```
Phase 1 (Setup)
    ↓
Phase 2 (Foundational)
    ↓
Phase 3 (US1: Basic Execution) ← MUST complete before other user stories
    ↓
Phase 4 (US2: Structured Output) ← Can parallelize with Phase 5 & 6
Phase 5 (US3: Tool Control)     ← Can parallelize with Phase 4 & 6
Phase 6 (US4: Session Resume)   ← Can parallelize with Phase 4 & 5
    ↓
Phase 7 (Polish)
```

### Parallel Execution Opportunities

**Phase 2** (Foundational): Tasks T011-T016 can be done in parallel (different dataclasses, [P] marker)

**Phase 3** (US1):
- Contract tests T022-T027 can be written in parallel ([P] marker)
- Unit test writing can be parallelized (T031, T036 different modules)

**Phase 4** (US2):
- Contract tests T066-T070 can be written in parallel ([P] marker)

**Phase 5** (US3):
- Contract tests T088-T093 can be written in parallel ([P] marker)

**Phase 6** (US4):
- Contract tests T113-T122 can be written in parallel ([P] marker)

**Phase 7** (Polish):
- Edge case tests T153-T158 can be done in parallel ([P] marker)
- CLI contract tests T159-T162 can be done in parallel ([P] marker)
- Documentation updates T166-T171 can be done in parallel ([P] marker)
- Success criteria validation T177-T184 can be done in parallel ([P] marker)

### Cross-Phase Parallelization

**After Phase 3 (US1) completes**, Phases 4, 5, and 6 can execute in parallel:
- Phase 4 (US2) modifies: `output_formatter.py`, `cli.py` (output handling)
- Phase 5 (US3) modifies: `tool_control.py`, `executor.py` (tool config), `cli.py` (tool options)
- Phase 6 (US4) modifies: `session_manager.py`, `executor.py` (session logic), `cli.py` (session options)

**Conflict zones**: `executor.py` and `cli.py` are touched by multiple phases. Recommend sequential execution within each file or careful merge coordination.

### MVP Strategy

**MVP = Phase 1 + Phase 2 + Phase 3 (US1 only)**
- Delivers basic execution capability (FR-001 through FR-005, FR-010, FR-011, FR-012, FR-015, FR-017)
- Provides text output and core CLI
- Estimated tasks: T001-T065 (65 tasks)
- Can ship and get feedback before P2-P4

**Incremental Releases**:
- MVP: US1 (basic execution)
- v0.2: MVP + US2 (JSON output)
- v0.3: v0.2 + US3 (tool control)
- v1.0: v0.3 + US4 (session resume) + Polish

---

## Task Statistics

- **Total Tasks**: 188
- **Phase 1 (Setup)**: 10 tasks
- **Phase 2 (Foundational)**: 11 tasks
- **Phase 3 (US1)**: 44 tasks
- **Phase 4 (US2)**: 22 tasks
- **Phase 5 (US3)**: 25 tasks
- **Phase 6 (US4)**: 40 tasks
- **Phase 7 (Polish)**: 36 tasks

**Parallelizable Tasks**: 82 tasks marked with [P]
**User Story Tasks**: 131 tasks (US1: 44, US2: 22, US3: 25, US4: 40)

**Estimated Effort** (assuming 1 task = 15-30 minutes):
- MVP (US1): 65 tasks × 20 min avg = 21.7 hours
- Full Feature: 188 tasks × 20 min avg = 62.7 hours

---

## Test Coverage Requirements

| Category | Required Coverage | Test Location |
|----------|------------------|---------------|
| Contract Tests | 100% of FR-001 to FR-017 | `tests/contract/test_library_api.py`, `tests/contract/test_cli_interface.py` |
| Integration Tests | 4 user stories × 3 scenarios | `tests/integration/test_user_story_p1.py` through `test_user_story_p4.py` |
| Unit Tests | 90%+ line coverage | `tests/unit/` (6 modules) |
| Edge Cases | All 7 edge cases from spec.md | Various unit tests in Phase 7 |
| Success Criteria | All 8 SC-001 through SC-008 | Validation tests in Phase 7 |

---

## Notes

1. **TDD Workflow**: For each user story phase, write contract tests first (red), then integration test (red), then implement (green). This is constitutionally mandated.

2. **Parallelization**: Tasks marked [P] are parallelizable if you have multiple developers or can context-switch efficiently. Non-[P] tasks have dependencies.

3. **File Conflicts**: Be careful with `executor.py` and `cli.py` in Phases 4-6 as they're modified by multiple user stories.

4. **Database Schema**: SQLite schema is created in T126-T128 but no foreign key constraints per global instruction.

5. **Testing Environment**: All tests should use temporary Git repositories and SQLite databases (in-memory or temp files) to avoid polluting development environment.

6. **Windows Platform**: Per env context, this is Windows-first development. Ensure filelock library is cross-platform tested.

7. **Claude Code Dependency**: All tests requiring Claude Code should mock subprocess calls or use fixture-based testing to avoid requiring actual Claude Code installation during CI/CD.

---

## Completion Checklist

After completing all tasks:

- [ ] All 188 tasks marked as complete
- [ ] All contract tests pass (100% of FRs)
- [ ] All integration tests pass (4 user stories)
- [ ] All unit tests pass (90%+ coverage)
- [ ] All success criteria validated (SC-001 through SC-008)
- [ ] README.md complete with examples
- [ ] Package installable via pip
- [ ] CLI works on Windows platform
- [ ] All edge cases handled
- [ ] Session cleanup script functional

**Ready for**: Merge to main branch, tag v1.0.0, publish to PyPI (optional)
