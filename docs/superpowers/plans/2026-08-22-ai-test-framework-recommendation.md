# AI Test Framework Recommendation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax.

**Goal:** Give each project snapshot an explainable Jest/Vitest recommendation and a persisted owner-selected framework that AI test generation can honor without changing existing fallback behavior.

**Architecture:** A pure analyzer reads package metadata and a bounded source sample to classify the project and score each framework. A service owns snapshot authorization, recommendation persistence and selection validation. The project API exposes read/select routes, while a dashboard panel invokes them; AI jobs read the selected value only when present.

**Tech Stack:** Node.js ES modules, Express, Prisma/PostgreSQL, React 19/Vite, Jest 29.

## Global Constraints

- Support Jest and Vitest only.
- Scan at most 200 source files and 1 MiB total; exclude generated/dependency directories.
- Never install packages or mutate uploaded project files/configuration.
- Selection is stored per ProjectSnapshot and may be unavailable to runners until the user installs that framework.
- Preserve existing AI test-generation fallback when a snapshot has no valid selection.
- Do not stage or modify the pre-existing Cypress AI-generation changes or client package-lock.

---

### Task 1: Persist recommendation and user selection

**Files:**
- Modify: server/prisma/schema.prisma
- Create: server/prisma/migrations/<timestamp>_add_framework_recommendation/migration.sql
- Modify: server/src/services/analysisResponse.service.js
- Test: server/src/tests/analysisResponse.test.js

**Interfaces:**
- Adds nullable ProjectSnapshot.frameworkRecommendationJson and ProjectSnapshot.selectedTestingFramework.
- snapshotResponse exposes frameworkRecommendation and selectedTestingFramework.

- [ ] **Step 1: Write failing snapshot response test**

~~~js
expect(snapshotResponse({
  id: "snapshot-1",
  selectedTestingFramework: "vitest",
  frameworkRecommendationJson: JSON.stringify({ version: 1, recommendedFramework: "vitest" }),
})).toMatchObject({
  selectedTestingFramework: "vitest",
  frameworkRecommendation: { version: 1, recommendedFramework: "vitest" },
});
~~~

- [ ] **Step 2: Confirm test fails**

Run: npm.cmd test --prefix server -- analysisResponse.test.js

Expected: FAIL because fields are unavailable.

- [ ] **Step 3: Add fields, migration, and safe parsing**

~~~prisma
model ProjectSnapshot {
  // existing fields
  frameworkRecommendationJson String?
  selectedTestingFramework    String?
}
~~~

~~~js
export const snapshotResponse = (snapshot) => ({
  // existing response fields
  frameworkRecommendation: parseJson(snapshot.frameworkRecommendationJson),
  selectedTestingFramework: snapshot.selectedTestingFramework || null,
});
~~~

Create an additive migration only: two nullable TEXT columns.

- [ ] **Step 4: Verify**

Run: npx.cmd prisma validate from server; npm.cmd test --prefix server -- analysisResponse.test.js

Expected: schema and test pass.

- [ ] **Step 5: Commit**

~~~bash
git add server/prisma server/src/services/analysisResponse.service.js server/src/tests/analysisResponse.test.js
git commit -m "feat: persist framework recommendation"
~~~

### Task 2: Classify projects and score frameworks deterministically

**Files:**
- Create: server/src/services/frameworkRecommendationAnalyzer.service.js
- Test: server/src/tests/frameworkRecommendationAnalyzer.service.test.js

**Interfaces:**
- Produces analyzeFrameworkRecommendation(rootDir) -> { version, projectType, recommendedFramework, candidates, explanation, diagnostics, analyzedAt }.
- Candidate shape: { framework, score, detected, installed, requiresInstallation, evidence }.

- [ ] **Step 1: Write failing analysis fixtures**

~~~js
it("recommends Vitest for a Vite React source tree", () => {
  const result = analyzeFrameworkRecommendation(fixture({
    "package.json": JSON.stringify({ dependencies: { react: "^19", vite: "^6" } }),
    "src/main.jsx": "import React from 'react'; import { defineConfig } from 'vite';",
  }));
  expect(result).toMatchObject({ projectType: "frontend", recommendedFramework: "vitest" });
  expect(result.candidates.find((item) => item.framework === "vitest").score)
    .toBeGreaterThan(result.candidates.find((item) => item.framework === "jest").score);
});

it("keeps Jest when existing Jest script, dependency and tests outweigh generic Vite signals", () => {
  const result = analyzeFrameworkRecommendation(jestFixture);
  expect(result.recommendedFramework).toBe("jest");
  expect(result.explanation.join(" ")).toContain("existing");
});
~~~

- [ ] **Step 2: Confirm tests fail**

Run: npm.cmd test --prefix server -- frameworkRecommendationAnalyzer.service.test.js

Expected: FAIL because analyzer is absent.

- [ ] **Step 3: Implement bounded evidence collection and scoring**

~~~js
export const analyzeFrameworkRecommendation = (rootDir) => {
  const packageInfo = readPackage(rootDir);
  const sourceEvidence = scanSourceEvidence(rootDir, { maxFiles: 200, maxBytes: 1024 * 1024 });
  const projectType = classifyProject(packageInfo, sourceEvidence);
  const candidates = ["jest", "vitest"].map((framework) =>
    scoreFramework({ framework, packageInfo, sourceEvidence, projectType }));
  const recommendedFramework = selectCandidate(candidates);
  return buildRecommendation({ projectType, candidates, recommendedFramework, diagnostics: packageInfo.diagnostics });
};
~~~

Award explicit dependency/script/config/test-file evidence before project-type preferences. Detect Vite/React/Vue/Next/Express/Nest and client/server layouts. Each score contribution must create an evidence object with code, weight, message and source. Return diagnostics for malformed package/source reads instead of throwing.

- [ ] **Step 4: Verify**

Run: npm.cmd test --prefix server -- frameworkRecommendationAnalyzer.service.test.js

Expected: PASS for Vite frontend, Node backend, fullstack, existing tests overriding preference, malformed package, and source scan bound.

- [ ] **Step 5: Commit**

~~~bash
git add server/src/services/frameworkRecommendationAnalyzer.service.js server/src/tests/frameworkRecommendationAnalyzer.service.test.js
git commit -m "feat: analyze framework recommendations"
~~~

### Task 3: Authorize, persist, and expose recommendation/selection APIs

**Files:**
- Create: server/src/services/frameworkRecommendation.service.js
- Modify: server/src/controllers/project.controller.js
- Modify: server/src/routes/project.route.js
- Test: server/src/tests/frameworkRecommendation.service.test.js
- Test: server/src/tests/projectFrameworkRecommendation.route.test.js

**Interfaces:**
- GET /api/projects/:id/test-framework-recommendation?snapshotId=<optional>.
- PUT /api/projects/:id/test-framework-selection body { snapshotId, framework }.
- Produces a response containing recommendation, selectedTestingFramework, and selection.requiresInstallation.

- [ ] **Step 1: Write failing ownership and selection tests**

~~~js
await expect(selectTestingFramework({
  projectId: "project-1", snapshotId: "snapshot-1", userId: "owner-1", framework: "vitest",
})).resolves.toMatchObject({
  selectedTestingFramework: "vitest",
  requiresInstallation: true,
});

await expect(selectTestingFramework({
  projectId: "project-1", snapshotId: "foreign-snapshot", userId: "owner-1", framework: "jest",
})).rejects.toMatchObject({ statusCode: 404 });
~~~

- [ ] **Step 2: Confirm tests fail**

Run: npm.cmd test --prefix server -- frameworkRecommendation.service.test.js projectFrameworkRecommendation.route.test.js

Expected: FAIL because service and routes are absent.

- [ ] **Step 3: Implement service/controller/routes**

~~~js
export const getFrameworkRecommendation = async ({ projectId, snapshotId, userId }) => {
  const snapshot = await resolveOwnedSnapshot({ projectId, snapshotId, userId });
  const recommendation = analyzeFrameworkRecommendation(snapshot.rootDir);
  await prisma.projectSnapshot.update({
    where: { id: snapshot.id },
    data: { frameworkRecommendationJson: JSON.stringify(recommendation) },
  });
  return { ...recommendation, selectedTestingFramework: snapshot.selectedTestingFramework || null };
};

export const selectTestingFramework = async ({ projectId, snapshotId, userId, framework }) => {
  if (!["jest", "vitest"].includes(framework)) throw new ServiceError("framework must be jest or vitest", 400);
  const recommendation = await getFrameworkRecommendation({ projectId, snapshotId, userId });
  await prisma.projectSnapshot.update({ where: { id: snapshotId }, data: { selectedTestingFramework: framework } });
  return { ...recommendation, selectedTestingFramework: framework,
    selection: { requiresInstallation: !candidateFor(recommendation, framework).installed } };
};
~~~

Use resolveLatestOwnedProjectSnapshot when snapshotId is omitted. Convert ServiceError to existing controller response format. Do not add queue jobs.

- [ ] **Step 4: Verify**

Run: npm.cmd test --prefix server -- frameworkRecommendation.service.test.js projectFrameworkRecommendation.route.test.js

Expected: PASS for latest snapshot resolution, selection persistence, bad framework, foreign ownership, unavailable snapshot, and API status codes.

- [ ] **Step 5: Commit**

~~~bash
git add server/src/services/frameworkRecommendation.service.js server/src/controllers/project.controller.js server/src/routes/project.route.js server/src/tests/frameworkRecommendation.service.test.js server/src/tests/projectFrameworkRecommendation.route.test.js
git commit -m "feat: expose framework recommendations"
~~~

### Task 4: Honor selected framework in AI test generation

**Files:**
- Modify: server/src/services/aiTestsJob.service.js
- Modify: server/src/services/aiPromptBuilder.service.js
- Test: server/src/tests/aiTestsJob.frameworkSelection.test.js
- Test: server/src/tests/aiPromptBuilder.test.js

**Interfaces:**
- buildFinalPrompt(payload, { mode, hasJest, hasVitest, selectedFramework }) honors selectedFramework when it equals jest or vitest.
- No selection preserves current hasVitest/hasJest behavior.

- [ ] **Step 1: Write failing prompt tests**

~~~js
expect(includeTestingInstructions("FULL", [], {
  hasJest: true, hasVitest: true, selectedFramework: "jest",
})).toContain("using the **Jest** framework");

expect(includeTestingInstructions("FULL", [], {
  hasJest: true, hasVitest: true,
})).toContain("using the **Vitest** framework");
~~~

- [ ] **Step 2: Confirm tests fail**

Run: npm.cmd test --prefix server -- aiPromptBuilder.test.js aiTestsJob.frameworkSelection.test.js

Expected: FAIL because selectedFramework is ignored.

- [ ] **Step 3: Read selection from the job snapshot and pass it through**

~~~js
const snapshot = await prisma.projectSnapshot.findUnique({
  where: { id: snapshotId }, select: { selectedTestingFramework: true },
});
const selectedFramework = ["jest", "vitest"].includes(snapshot?.selectedTestingFramework)
  ? snapshot.selectedTestingFramework : null;
const finalPrompt = buildFinalPrompt(payload, { mode, hasJest, hasVitest, selectedFramework });
~~~

Update prompt selection with selectedFramework first, then keep existing fallback unchanged.

- [ ] **Step 4: Verify**

Run: npm.cmd test --prefix server -- aiPromptBuilder.test.js aiTestsJob.frameworkSelection.test.js

Expected: PASS for Jest override, Vitest override, invalid persisted value ignored, and no-selection fallback.

- [ ] **Step 5: Commit**

~~~bash
git add server/src/services/aiTestsJob.service.js server/src/services/aiPromptBuilder.service.js server/src/tests/aiTestsJob.frameworkSelection.test.js server/src/tests/aiPromptBuilder.test.js
git commit -m "feat: honor selected test framework"
~~~

### Task 5: Add dashboard recommendation and selection panel

**Files:**
- Create: client/src/components/dashboard/FrameworkRecommendationPanel.jsx
- Modify: client/src/components/dashboard/AIPanel.jsx
- Modify: client/src/services/project.service.js
- Test: client/src/components/dashboard/FrameworkRecommendationPanel.test.jsx only if frontend test tooling exists; otherwise validate through production build.

**Interfaces:**
- getFrameworkRecommendationApi(projectId, snapshotId) -> recommendation response.
- selectTestingFrameworkApi(projectId, snapshotId, framework) -> saved selection response.
- FrameworkRecommendationPanel accepts { projectId, snapshotId }.

- [ ] **Step 1: Write component behaviour specification**

~~~jsx
<FrameworkRecommendationPanel projectId="project-1" snapshotId="snapshot-1" />
// Shows: "Recommended: Vitest", project type, evidence rows, and Jest/Vitest buttons.
// Selecting Jest calls selectTestingFrameworkApi("project-1", "snapshot-1", "jest").
// An unavailable dependency displays "Install before running tests" without disabling selection.
~~~

- [ ] **Step 2: Confirm current dashboard lacks this capability**

Run: npm.cmd run build --prefix client

Expected: PASS before changes; no FrameworkRecommendationPanel module exists.

- [ ] **Step 3: Implement panel and API helpers**

~~~js
export async function getFrameworkRecommendationApi(projectId, snapshotId) {
  const query = snapshotId ? "?snapshotId=" + encodeURIComponent(snapshotId) : "";
  return handleResponse(await fetch(BASE_URL + "/projects/" + projectId + "/test-framework-recommendation" + query,
    { headers: getAuthHeaders() }));
}
~~~

Render the panel above generation actions in AIPanel. It loads only when projectId and snapshotId exist, shows retryable local errors, marks recommendation and selection distinctly, and does not block existing AI chat/generation controls while loading.

- [ ] **Step 4: Verify production build and existing API contracts**

Run: npm.cmd run build --prefix client; npm.cmd test --prefix server -- projectStructure.route.test.js frameworkRecommendation.service.test.js

Expected: build and server tests pass.

- [ ] **Step 5: Commit**

~~~bash
git add client/src/components/dashboard/FrameworkRecommendationPanel.jsx client/src/components/dashboard/AIPanel.jsx client/src/services/project.service.js
git commit -m "feat: add framework recommendation panel"
~~~

### Task 6: Regression and migration verification

**Files:**
- Modify: README.md only if project API documentation is maintained there.

- [ ] **Step 1: Inspect additive migration**

Run: Get-Content -Raw server/prisma/migrations/<timestamp>_add_framework_recommendation/migration.sql

Expected: only two nullable ProjectSnapshot columns.

- [ ] **Step 2: Run focused tests**

Run: npm.cmd test --prefix server -- frameworkRecommendationAnalyzer.service.test.js frameworkRecommendation.service.test.js projectFrameworkRecommendation.route.test.js aiPromptBuilder.test.js aiTestsJob.frameworkSelection.test.js

Expected: all pass.

- [ ] **Step 3: Run full verification**

Run: npx.cmd prisma validate from server; npm.cmd test --prefix server; npm.cmd run build --prefix client; git diff --check

Expected: all pass and no whitespace errors. Report pre-existing test failures separately.

- [ ] **Step 4: Commit documentation if needed**

~~~bash
git add README.md
git commit -m "docs: document framework recommendation"
~~~

## Plan Self-Review

- **Spec coverage:** Tasks 1-3 persist/analyze/expose recommendation and selection; Task 4 integrates only selected values into AI test generation; Task 5 supplies dashboard selection; Task 6 verifies migration and regressions.
- **Placeholder scan:** No deferred implementation markers; the migration timestamp is generated by Prisma and constrained to an additive reviewed migration.
- **Type consistency:** Framework values are lowercase jest/vitest from analyzer through persistence/API and map only to display labels in the client.

