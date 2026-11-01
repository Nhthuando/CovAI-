# AI Trustworthiness Evaluation — implementation contract

Approved scope: external project chatbot/agent, Knowledge Q&A, Usage Guidance and Action/Tool Execution. Gemini is an optional evaluator, not the default target. Source: C1SE.30 Proposal v1.2, FR-08–FR-16 and NFR-03/07/08.

## Confirmed decisions

- Public HTTPS JSON targets only; configurable JSON Pointer mappings, no executable adapters supplied by users.
- Target owns its agent loop and calls COVAI's authenticated gateway. Gateway executes stateful mocks only, never production tools.
- Project owner confirms ground truth and scoring. Published profiles and target configurations are immutable versions.
- Gemini generation and judging require separate, explicit profile consent. No silent model fallback.
- Weights are proposed, not approved automatically. Owner supplies overall and semantic thresholds.
- Missing required evidence prevents PASS. Serious violations block PASS regardless of average. Execution completion and evaluation verdict are separate.
- Evidence scope is COVAI_GATEWAY_ONLY; hidden activity in a remote target cannot be certified absent.

## Modules and dependencies

1. Additive Prisma schema, API contracts, owner authorization and disabled-by-default feature flag.
2. Knowledge ingestion (text/Markdown/JSON/YAML/text PDF/snapshot source), draft profiles, benchmark and owner approval.
3. HTTPS adapter, DNS-pinned SSRF policy, scoped gateway tokens, confirmation grants and transactional stateful mock tools.
4. Durable Redis runner, persisted leases/attempts, cancellation, evidence and deterministic scoring.
5. Opt-in structured Gemini judgments, benchmark proposals and separate human calibration reviews.
6. Integrated workspace navigation, targets/profiles/runs/evidence/comparison, JSON/PDF reports.
7. Security, migration, recovery, API and browser regression tests; rollout behind feature flag.

## Evaluation lifecycle

Register target → ingest sources → prepare/review cases, rules, mock tools and scoring → publish profile version → choose target/profile versions → create durable run → execute isolated case sessions → capture gateway calls and answers → score → freeze report → human review/comparison.

Core data models: AiEvaluationTarget, TargetVersion, Credential, KnowledgeSource, Profile, ProfileVersion, TestCase, Run, CaseResult, Attempt, ToolCall, ConfirmationGrant, CriterionResult, Evidence and HumanReview (all use the AiEvaluation prefix).

Management API: `/api/projects/:projectId/ai-evaluations`. Gateway: `/api/ai-evaluation-gateway/sessions/:sessionId/{tool-calls,confirmation-requests}`. Gateway token is not a user JWT; only its hash is persisted.

## Safety and result contracts

- Same call ID/payload returns cached result; conflicting payload is rejected. Distinct IDs with a duplicate business key cannot repeat a state transition.
- Confirmation grants bind session/tool/canonical arguments and are single-use. Benchmark approval is not action consent.
- No shell, JavaScript, SQL, network, remote schemas or arbitrary regex in mock definitions.
- Close gateway on completion/cancel/timeout. Worker recovery never blindly repeats a dispatched request.
- Strict queue mode for evaluation: Redis failures return an error; no in-process fallback.
- Criterion states: PASSED, FAILED, NOT_EVALUATED, NOT_APPLICABLE, INSUFFICIENT_EVIDENCE, ERROR.
- Availability, completeness and provenance are separate. Missing trace is not an empty complete trace.
- Binary rules score 100/0; semantic scores require a rubric. Partial averages are labeled and accompanied by completeness. No scored criteria means null.
- Freeze target/profile/source/adapter/rule/judge metadata. Comparable rankings require compatible manifests.
- Secrets never enter queue payloads, report exports, browser storage or judge prompts.

## Validation and delivery

Jest unit/contract tests; Supertest ownership/gateway/API tests; disposable PostgreSQL-compatible migration and transactional tests; Playwright workspace flow; client build/lint; regression for existing jobs/chat/project deletion. No live Gemini requirement in CI. Test artifacts must not modify imported project storage.

Feature remains disabled until migrations, public gateway URL, encryption key and Redis are configured. Migration is additive; rollback disables new work rather than deleting evaluation history. See `ai-trustworthiness-integration.md` for runnable contracts and operational instructions.
