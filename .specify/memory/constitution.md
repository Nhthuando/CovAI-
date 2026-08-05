<!--
Sync Impact Report
- Version change: template -> 1.0.0
- Added principles: architecture compatibility, access control, secret safety,
  compatible migrations, verifiable acceptance criteria, quality gates, and
  dependency discipline.
- Added sections: Technical Constraints; Delivery Workflow.
- Removed sections: none.
- Follow-up TODO: establish the original ratification date.
-->
# CovAI Constitution

## Core Principles

### I. Existing Architecture First

Changes MUST preserve the current React 19/Vite client and Express/Prisma server
boundaries. Reuse the established `routes` -> `controllers` -> `services` flow,
Prisma persistence, Redis/BullMQ jobs, Firebase Storage, Socket.IO, and Docker
integration when applicable. A new pattern requires a documented compatibility
reason; this keeps features coherent with the operational system.

### II. Authentication and Ownership Are Mandatory

Every protected HTTP endpoint MUST use `authMiddleware` and verify `req.user.id`
against the owner of the requested project-derived resource. Socket connections
and room subscriptions MUST be authenticated and MUST NOT trust client-supplied
user IDs. Authorization is enforced server-side, regardless of frontend guards.

### III. Secrets Never Cross Boundaries

Passwords, access tokens, JWTs, encryption keys, and environment values MUST NOT
be logged, committed, returned in API responses, or embedded in client bundles.
Secrets belong in local or managed environment configuration. Stored third-party
tokens MUST remain encrypted where the existing integration supports encryption.

### IV. Backward-Compatible Data Evolution

Every Prisma schema change MUST include a reviewed migration that preserves or
explicitly transforms existing data. Migration plans MUST state rollback or
recovery steps when changes are destructive, and application code MUST tolerate
the transition state until deployment is complete.

### V. Verifiable Outcomes

Each feature specification MUST define testable acceptance criteria, including
expected authorization and error behavior where relevant. Implementation is not
complete until those criteria can be demonstrated through automated tests,
repeatable manual checks, or both.

### VI. Required Quality Gates

Before a change is declared complete, contributors MUST run the relevant client
build, server Jest tests, and `npx.cmd prisma validate` from `server/`. Failures
MUST be fixed or explicitly documented with approval. This applies even though
the repository currently has no CI workflow or backend linter.

### VII. Dependencies Need Evidence

Do not add a dependency without showing that existing project dependencies or
platform capabilities cannot meet the requirement safely and maintainably.
Document the reason, maintenance implications, and integration surface in the PR.

## Technical Constraints

The supported stack is JavaScript ES modules, React 19, Vite, Express, Prisma 7
with PostgreSQL, Redis/BullMQ, Socket.IO, Firebase Storage, and Docker Compose.
Configuration values such as `DATABASE_URL`, `JWT_SECRET`, `REDIS_URL`, Firebase
credentials, AI keys, OAuth credentials, email credentials, and `ENCRYPTION_KEY`
MUST remain outside version control.

## Delivery Workflow

Define acceptance criteria before implementation. Keep API work within the
existing route/controller/service conventions, add focused tests for changed
behavior, and review Prisma migration SQL and cascade effects. PRs MUST describe
user-visible impact, API/schema/configuration changes, and any new dependency;
UI changes MUST include screenshots when meaningful.

## Governance

This constitution supersedes conflicting repository guidance for architecture,
security, data evolution, and completion criteria. Amendments require a written
rationale, an impact assessment, and a semantic version update: MAJOR for
incompatible governance changes, MINOR for added or materially expanded rules,
and PATCH for clarifications. Reviews MUST verify compliance with these principles
and record any approved exception in the PR. `AGENTS.md` is the contributor-facing
operational guide and MUST remain aligned with this constitution.

**Version**: 1.0.0 | **Ratified**: TODO(RATIFICATION_DATE): original adoption date unknown | **Last Amended**: 2026-08-04
