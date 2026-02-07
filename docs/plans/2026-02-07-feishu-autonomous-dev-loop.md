# Feishu Autonomous Development Loop Implementation Plan

## 1. Objective

Enable Lucy Orchestrator to engage in natural Feishu conversations for software development tasks, supporting a complete autonomous workflow from requirement intake through code delivery.

- **Pre-task Phase**: Don't immediately create task when user just asks questions
- **Natural Approval**: Support natural language approval (instead of rigid "approve/reject")  
- **Self-healing Execution**: Auto-retry cycles with human escalation at limits
- **Docker Isolation**: Git worktree per task, execution in containerized environment
- **Fly-to-PR Flow**: Complete development loop from Feishu message to GitHub PR

## 2. Constraints & Parameters

- **Repository**: `/home/git_home/nova-service-all-in-one`
- **Base Branch**: `master`
- **Retry Limit**: 5 cycles before escalation
- **Auto-PR**: Disabled by default (require manual confirmation)
- **Change Scope**: Full repo (no path restrictions)
- **Test Strategy**: Leverage existing Nova service API regression tests

## 3. End-to-End Flow

### 3.1 Draft Phase (No Immediate Task Creation)
- User sends message to Feishu bot
- System detects ambiguity (not explicit `需求:` or `/task`)
- Store message as "draft" with intention unknown
- Ask: "Are you hoping I'll treat this as a development task to work on?"
- Options:
  - Natural affirmatives ("好，帮我做 / 继续 / 开始") → Create task
  - Natural negatives ("算了 / 不用 / 取消") → Clear draft
  - Ambiguous continuation → Append to draft

### 3.2 Intent Confirmation (Natural Language)
- If user confirms intent → Create task with repo context
- If user rejects → Clear draft and inform
- If ambiguous → Append to draft and continue conversation

### 3.3 Clarification Loop (Step-by-step)
- For each required question in generated plan:
  - Ask one-by-one in natural language
  - Accept direct answer as response
  - Mark question as answered and proceed to next
- Once all questions answered → Transition to approval phase

### 3.4 Approval Phase (Natural Request)
- Instead of "Reply APPROVE/REJECT", ask:
  - "I'm ready to start working on this. Should I proceed or pause?"
  - Accept natural responses like "continue/do it/start" or "pause/stop/cancel"
- On approval → Auto-provision worktree and begin execution

### 3.5 Execution Loop (Autonomous)
- Run OpenCode build step in worktree
- Execute Nova service API regression tests
- If tests fail → Attempt auto-fix (max 5 rounds)
- If successful → Generate diff and prepare summary
- If all rounds fail → Escalate to user for decision

### 3.6 Completion Phase
- On success: Provide summary and ask "Shall I create a PR?"
- On failure: Provide error summary and ask for next action

## 4. State Machine Transitions

```
DRAFT -> INTENT_CONFIRM -> TASK_CREATED -> CLARIFYING -> WAIT_APPROVAL -> RUNNING -> TESTING -> DONE
  |                              |              |              |               |         |
  |                              |              |              |               |         +-> FAILED_RETRYABLE
  |                              |              |              |               |                   |
  |                              |              |              |               |                   +-> ESCALATE_MANUAL
  |                              |              |              |               |
  +-> CLEAR_DRAFT                |              |              |               +-> FAILED_FINAL
                                 |              |              |
                                 |              |              +-> REJECT_TASK
                                 |              |
                                 |              +-> ANSWER_QUESTION -> WAIT_APPROVAL
                                 |
                                 +-> CREATE_TASK
```

### 4.1 Gate Conditions
- **CLARIFYING**: Requires OpenCode plan generation success
- **WAIT_APPROVAL**: Requires all required questions answered
- **RUNNING**: Requires approval granted + worktree provisioned
- **TESTING**: Requires diff artifact generated
- **DONE**: Requires test report success

## 5. Feishu Interaction Guidelines

### 5.1 Natural Language Patterns
- **Affirmative**: `["继续", "开始", "好，帮我做", "就按这个", "是的", "ok", "yes"]`
- **Negative**: `["算了", "不用", "取消", "暂停", "先别", "不要"]`
- **Clarify**: Contextual answers to plan questions
- **Escalation**: `"?"`, `"为什么"`, `"怎么"`

### 5.2 Message Length Constraints
- Keep responses under 500 chars (Fly friendly)
- Use progressive disclosure for complex information
- Always include actionable next-step text

## 6. Testing Strategy

### 6.1 Nova Service Integration
- Identify existing API regression test commands from `nova-service-all-in-one` structure
- Use containerized execution to isolate test environment
- Run tests against task-level worktree

### 6.2 Auto-Fix Loop
- Attempt code modifications based on test failure logs
- Validate fix by re-running failing tests
- Cap retry attempts to prevent infinite loops

## 7. Failure Handling

### 7.1 Retry Mechanism
- Max 5 retry cycles per task
- Each cycle includes: code fix → test run → evaluation
- After 5 failures → Escalate to user for decision

### 7.2 Manual Escalation Triggers
- Continuous test failures after 5 rounds
- Critical errors (git conflicts, disk space, permissions)
- Missing required approvals past deadline

## 8. Security & Isolation

### 8.1 Git Worktree Per Task
- Isolate changes using `git worktree add -b task/<id>`
- Run all operations within worktree boundary
- Clean up worktree after completion/failure

### 8.2 Docker Execution Boundary
- Mount only task worktree into container
- Run OpenCode and tests in containerized environment
- Prevent access to global repo or host system

## 9. Milestone Plan

### M1: Documentation & Conversation Layer
- [ ] Create docs/plans directory structure
- [ ] Write this implementation plan
- [ ] Implement Feishu conversation state manager
- [ ] Update Orchestrator with draft/intent logic

### M2: Natural Approval & Clarification
- [ ] Replace rigid approval with natural language
- [ ] Implement step-by-step clarification flow
- [ ] Add intent classifier for user responses

### M3: Execution & Auto-Retry
- [ ] Integrate Docker execution layer
- [ ] Implement test-and-fix loop
- [ ] Add retry escalation mechanism

### M4: Completion & Delivery
- [ ] Finalize PR workflow
- [ ] Add failure recovery mechanisms
- [ ] End-to-end integration testing

## 10. Definition of Done

### 10.1 Functional Requirements
- [ ] User can ask question without immediate task creation
- [ ] Natural language approval works (no rigid approve/reject)
- [ ] Auto-fix loop runs up to 5 times before escalation
- [ ] Successful tasks produce diffs and ask for PR creation
- [ ] Failed tasks escalate to human for decision

### 10.2 Non-functional Requirements  
- [ ] All operations isolated per task worktree
- [ ] Docker containers only access task worktree
- [ ] Conversation state preserved during failures
- [ ] User interactions stay within Feishu message constraints

### 10.3 Quality Requirements
- [ ] All existing tests continue to pass
- [ ] New functionality covered by unit tests
- [ ] Documentation updated comprehensively
- [ ] Performance impact acceptable for interactive flow