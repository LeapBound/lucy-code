<!--
Sync Impact Report:
Version: 0.0.0 → 1.0.0
Change Type: Initial constitution ratification

Modified Principles:
- NEW: I. Specification-First Development
- NEW: II. Library-First Architecture
- NEW: III. Test-Driven Development (NON-NEGOTIABLE)
- NEW: IV. Iterative & Incremental Delivery
- NEW: V. Observability & Simplicity

Added Sections:
- Core Principles (all 5 principles)
- Quality Standards
- Development Workflow
- Governance

Templates Status:
✅ plan-template.md - Constitution Check section aligns with principles
✅ spec-template.md - User scenario structure supports iterative delivery
✅ tasks-template.md - Phase structure supports TDD and incremental delivery
⚠ agent-file-template.md - Reviewed, no constitution-specific updates needed
⚠ checklist-template.md - Reviewed, no constitution-specific updates needed

Follow-up TODOs: None
-->

# Lucy Code Constitution

## Core Principles

### I. Specification-First Development

Every feature begins with a written specification that captures user scenarios,
functional requirements, and success criteria before any implementation starts.
Specifications must be independently testable and prioritized to enable incremental
delivery. Ambiguous requirements must be explicitly marked with "NEEDS CLARIFICATION"
and resolved before proceeding to implementation.

**Rationale**: Clear specifications prevent scope creep, enable parallel work, and
ensure all stakeholders understand what will be built. They serve as the contract
between user needs and technical implementation.

### II. Library-First Architecture

Every feature must be developed as a standalone library with:
- Self-contained, independently testable components
- Clear, documented interfaces and contracts
- CLI exposure of core functionality (text in/out protocol: stdin/args → stdout, errors → stderr)
- Support for both JSON and human-readable output formats

Libraries must have a clear, singular purpose. No organizational-only libraries are permitted.

**Rationale**: Library-first design enforces modularity, reusability, and testability.
CLI interfaces ensure debuggability and enable both human interaction and programmatic
integration without tight coupling.

### III. Test-Driven Development (NON-NEGOTIABLE)

TDD is mandatory. The Red-Green-Refactor cycle must be strictly followed:
1. Write tests first based on specifications
2. Obtain user approval of test scenarios
3. Verify tests fail (Red)
4. Implement minimum code to pass tests (Green)
5. Refactor for clarity and performance (Refactor)

Contract tests are required for:
- New library public interfaces
- Changes to existing contracts
- Inter-service communication
- Shared schemas and data models

Integration tests are required for user journeys spanning multiple components.

**Rationale**: TDD ensures code correctness, prevents regressions, and produces
living documentation. It catches integration issues early and enables confident
refactoring. Tests-first prevents writing untestable code and keeps implementation
focused on requirements.

### IV. Iterative & Incremental Delivery

Features must be broken into independent, prioritized user stories (P1, P2, P3...)
where each story:
- Delivers standalone value (MVP-capable)
- Can be developed, tested, and deployed independently
- Has explicit acceptance criteria
- Has a clear "why this priority" justification

Implementation follows phases: Setup → Foundational → User Stories (by priority) → Polish.
After completing each user story, validate independently before proceeding.

**Rationale**: Incremental delivery enables early feedback, reduces integration risk,
and allows pivoting based on user response. Each story checkpoint provides a natural
deployment boundary and demonstrates progress.

### V. Observability & Simplicity

All components must be observable and simple:
- Text-based I/O ensures easy debugging and inspection
- Structured logging required for all operations (info, error, debug levels)
- Avoid over-engineering: implement only requested functionality
- No speculative features or unnecessary abstractions
- YAGNI (You Aren't Gonna Need It) rigorously applied
- Complexity must be justified against simpler alternatives

**Rationale**: Observability enables rapid debugging and production monitoring.
Simplicity reduces maintenance burden, onboarding time, and defect surface area.
Every abstraction must earn its place by solving a real, current problem.

## Quality Standards

All code must meet these non-negotiable quality gates:

- **Security**: No OWASP Top 10 vulnerabilities (XSS, SQL injection, command injection, etc.)
- **Testing**: Contract tests for public interfaces, integration tests for user journeys
- **Documentation**: Public APIs documented with examples; quickstart.md validated
- **Code Review**: All changes reviewed for constitution compliance
- **Error Handling**: Validate at system boundaries (user input, external APIs); trust internal contracts
- **Versioning**: Semantic versioning (MAJOR.MINOR.PATCH) for all libraries

## Development Workflow

1. **Feature Request** → Create specification (spec.md) with user scenarios and requirements
2. **Planning** → Generate implementation plan (plan.md) with architecture decisions
3. **Task Breakdown** → Create dependency-ordered tasks (tasks.md) grouped by user story
4. **Implementation** → For each user story (in priority order):
   - Write tests first (verify they fail)
   - Implement minimum code to pass tests
   - Validate story independently
   - Commit and move to next story
5. **Integration** → Validate all stories work together
6. **Polish** → Documentation, performance, cross-cutting concerns
7. **Review** → Constitution compliance check before merge

## Governance

This constitution supersedes all other development practices and policies. All pull
requests, code reviews, and technical decisions must verify compliance with these
principles.

### Amendment Process

Constitution changes require:
1. Documented rationale for the change
2. Impact analysis across all templates and workflows
3. Stakeholder review and approval
4. Migration plan for existing features if needed
5. Semantic versioning increment:
   - MAJOR: Backward-incompatible principle removals or redefinitions
   - MINOR: New principles or materially expanded guidance
   - PATCH: Clarifications, wording, non-semantic refinements

### Complexity Justification

Any deviation from these principles (e.g., adding a 4th project when 3 exist,
introducing abstractions without clear need) must be explicitly justified in the
implementation plan with:
- Why the complexity is needed
- What simpler alternative was rejected and why

### Review Cadence

Constitution compliance must be verified at:
- Every pull request (automated and manual checks)
- Quarterly retrospectives (are principles serving the project?)
- Major milestone reviews (before releases)

**Version**: 1.0.0 | **Ratified**: 2025-11-24 | **Last Amended**: 2025-11-24
