# AI Test Framework Recommendation Design

## Goal

Recommend Jest or Vitest for a project snapshot using transparent, deterministic
evidence, explain the recommendation, and let the project owner persist a
framework selection for that snapshot.

## Scope

The feature analyses project type, package metadata, declared dependencies,
existing test configuration/files, and a bounded static sample of source code.
It returns scored Jest and Vitest candidates with evidence and human-readable
reasons. It adds a dashboard panel and APIs for viewing the analysis and saving
the user's explicit choice.

The feature does not install packages, mutate user source/configuration, change
test-runner commands, or alter existing behaviour when no selection exists.

## Analysis

Analysis is local and deterministic. It reads the root `package.json`, config
files, test scripts and the existing normalised framework detector result. A
bounded source scan excludes generated directories and inspects at most 200
source files / 1 MiB total for imports and structural signals.

Project type is classified as `frontend`, `backend`, `fullstack`, `library`, or
`unknown`. Vite, React, Vue, Next, Express, Nest and conventional client/server
directory layouts are evidence; conflicting client and server evidence produces
`fullstack`.

Each candidate receives a breakdown for dependency, script, configuration,
existing test files, project compatibility and source evidence. Existing tests,
explicit commands and configuration outweigh generic ecosystem preferences.
Vitest receives compatibility credit for Vite-centric frontend projects; Jest
receives credit for Node/backend and existing Jest ecosystems. A deterministic
tie is resolved to the framework with more existing test files, then Jest for
backward compatibility. Every score contribution becomes an explanation item.

## Persistence and API

`ProjectSnapshot` receives nullable fields:

- `frameworkRecommendationJson`: the versioned recommendation response;
- `selectedTestingFramework`: `jest` or `vitest` chosen by the owner.

`GET /api/projects/:id/test-framework-recommendation?snapshotId=` resolves an
owned, ready snapshot, recomputes the analysis, persists the recommendation and
returns it. `PUT /api/projects/:id/test-framework-selection` accepts
`{ snapshotId, framework }`, verifies ownership, limits the value to Jest or
Vitest, and saves it on that snapshot. A selection may name a framework not yet
installed, but the response explicitly returns `requiresInstallation: true`;
the system never installs it automatically.

## Dashboard and Compatibility

A compact dashboard panel loads the recommendation for the active snapshot,
shows project type, ranked candidates and evidence, and exposes Jest/Vitest
selection controls. Saving is optimistic only after the API accepts it. Loading
and save errors remain local to the panel.

AI test generation reads the selected framework from its job snapshot. When a
valid selection exists it instructs the prompt builder to use that framework;
otherwise it preserves the existing Jest/Vitest fallback. Coverage, E2E runner,
existing detection endpoints and current test-generation request contracts stay
unchanged.

## Failure and Verification

Malformed or missing package/source files produce diagnostics rather than a
500 response. An unavailable snapshot yields 404/409 according to existing
project scope conventions. Invalid selection yields 400 and foreign project or
snapshot access yields 404.

Tests cover classification, scoring, explanation, malformed input, selection
ownership/validation, snapshot persistence, prompt selection fallback, and the
dashboard's loading/selection/error states. Prisma validation and the full
server suite run after implementation; UI build and lint run for the dashboard
change.
