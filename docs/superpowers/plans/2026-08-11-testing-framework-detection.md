# Testing Framework Detection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Detect Jest and Vitest, discover existing tests and configurations, persist a snapshot-level result, and expose it without breaking Jest consumers.

**Architecture:** A pure utility produces normalized detection. The existing Jest detector delegates to it; import paths serialize it on a snapshot and API mapping deserializes it.

**Tech Stack:** Node.js ESM, Express 5, Prisma 7/PostgreSQL, Jest 29.

## Global Constraints

- Support Jest and Vitest only; do not run Vitest or change the Jest coverage runner.
- Unreadable files/directories and malformed `package.json` create diagnostics, not import failures.
- Skip `node_modules`, `.git`, coverage/build output and caches; expose only normalized relative test paths.
- Retain `hasJest`, `jestConfigPath`, and `jestCommand`.

---

## File structure

- Create `server/src/utils/testingFrameworkDetector.js` for pure detection.
- Create `server/src/tests/testingFrameworkDetector.test.js` for behavior tests using temporary directories.
- Modify `server/src/utils/jestDetector.js` as a compatibility adapter.
- Modify `server/prisma/schema.prisma` and add migration for snapshot JSON metadata.
- Modify `server/src/services/project.service.js`, `server/src/controllers/github.controller.js`, and `server/src/services/jestDetection.service.js` for persistence and API exposure.

### Task 1: Test and implement normalized framework detection

**Files:**
- Create: `server/src/utils/testingFrameworkDetector.js`
- Create: `server/src/tests/testingFrameworkDetector.test.js`

**Interfaces:** Produces `detectTestingFrameworks(rootDir)`, returning `frameworks`, `detectedFrameworks`, `primaryFramework`, `frameworkType`, `hasMultipleFrameworks`, `testFiles`, `testFileCount`, and `errors`.

- [ ] **Step 1: Write the failing framework and test-file behavior tests**

```js
it("reports both frameworks and a deterministic primary framework", () => {
    writeJson(root, "package.json", {
        scripts: { test: "jest", unit: "vitest run" },
        devDependencies: { jest: "^29.7.0", vitest: "^2.1.0" },
        jest: { testEnvironment: "node" },
    });
    writeFile(root, "vitest.config.ts", "export default {};");
    expect(detectTestingFrameworks(root)).toMatchObject({
        detectedFrameworks: ["jest", "vitest"], primaryFramework: "jest",
        frameworkType: "multiple", hasMultipleFrameworks: true,
    });
});

it("discovers and classifies tests while excluding ignored directories", () => {
    writeFile(root, "src/a.test.js", "import { jest } from '@jest/globals';");
    writeFile(root, "__tests__/b.spec.ts", "import { vi } from 'vitest';");
    writeFile(root, "node_modules/x/ignored.test.js", "jest.fn();");
    expect(detectTestingFrameworks(root).testFiles).toEqual([
        { path: "__tests__/b.spec.ts", framework: "vitest" },
        { path: "src/a.test.js", framework: "jest" },
    ]);
});
```

- [ ] **Step 2: Verify the test fails**

Run: `npm test --prefix server -- --runInBand testingFrameworkDetector.test.js`

Expected: FAIL because the detector module does not exist.

- [ ] **Step 3: Implement minimal evidence, traversal, and error handling**

```js
export function detectTestingFrameworks(rootDir) {
    // Read package.json once; inspect dependency sections, scripts, inline config,
    // framework config files, then recursively collect .test/.spec and __tests__ files.
    // Return relative paths and diagnostics instead of throwing on unreadable input.
}

const classifyTestFile = (content) => {
    if (/@jest\/globals|\bjest\s*\./.test(content)) return "jest";
    if (/from\s+["']vitest["']|\bvi\s*\./.test(content)) return "vitest";
    return "unknown";
};
```

- [ ] **Step 4: Complete edge tests, verify pass, and commit**

Add Jest-only, Vitest-only, config-only, dependency-only, script-only, inline-config, no-framework, invalid-JSON and missing-root cases.

Run: `npm test --prefix server -- --runInBand testingFrameworkDetector.test.js`

Expected: PASS.

Commit: `git add server/src/utils/testingFrameworkDetector.js server/src/tests/testingFrameworkDetector.test.js && git commit -m "feat: detect Jest and Vitest frameworks"`

### Task 2: Convert the existing Jest detector into a compatibility adapter

**Files:**
- Modify: `server/src/utils/jestDetector.js`
- Test: `server/src/tests/testingFrameworkDetector.test.js`

**Interfaces:** Consumes `detectTestingFrameworks(rootDir)`; `detectJest(rootDir)` retains its current fields and adds `testingFrameworks`.

- [ ] **Step 1: Write a failing compatibility test**

```js
it("preserves Jest metadata and adds normalized metadata", () => {
    writeJson(root, "package.json", { scripts: { test: "jest" }, devDependencies: { jest: "^29.7.0" } });
    expect(detectJest(root)).toMatchObject({
        hasJest: true, jestCommand: "jest",
        testingFrameworks: { frameworkType: "single", detectedFrameworks: ["jest"] },
    });
});
```

- [ ] **Step 2: Verify failure, then replace duplicated scanning logic**

Run: `npm test --prefix server -- --runInBand testingFrameworkDetector.test.js`

Expected: FAIL because legacy output has no `testingFrameworks`.

```js
export function detectJest(rootDir) {
    const testingFrameworks = detectTestingFrameworks(rootDir);
    const jest = testingFrameworks.frameworks.find(({ name }) => name === "jest");
    return {
        ...toExistingJestShape(jest, testingFrameworks.errors, rootDir),
        testingFrameworks,
    };
}
```

- [ ] **Step 3: Verify pass and commit**

Run: `npm test --prefix server -- --runInBand testingFrameworkDetector.test.js`

Expected: PASS with no Jest regression.

Commit: `git add server/src/utils/jestDetector.js server/src/tests/testingFrameworkDetector.test.js && git commit -m "refactor: preserve Jest detector compatibility"`

### Task 3: Persist snapshot metadata in all import paths

**Files:**
- Modify: `server/prisma/schema.prisma`
- Create: `server/prisma/migrations/<timestamp>_add_testing_framework_detection/migration.sql`
- Modify: `server/src/services/project.service.js`
- Modify: `server/src/controllers/github.controller.js`
- Modify: `server/src/services/jestDetection.service.js`
- Test: `server/src/tests/testingFrameworkDetector.test.js`

**Interfaces:** Produces nullable `ProjectSnapshot.testingFrameworksJson`; existing Jest fields derive from the Jest framework entry.

- [ ] **Step 1: Add failing persistence expectations**

```js
expect(prisma.projectSnapshot.update).toHaveBeenCalledWith(expect.objectContaining({
    data: expect.objectContaining({
        testingFrameworksJson: JSON.stringify(detection.testingFrameworks),
        hasJest: true,
    }),
}));
```

- [ ] **Step 2: Verify failure and add schema/migration**

Run: `npm test --prefix server -- --runInBand testingFrameworkDetector.test.js`

Expected: FAIL because `testingFrameworksJson` is not persisted.

```prisma
model ProjectSnapshot {
  testingFrameworksJson String?
}
```

```sql
ALTER TABLE "ProjectSnapshot" ADD COLUMN "testingFrameworksJson" TEXT;
```

- [ ] **Step 3: Persist during ZIP extraction and both GitHub imports**

```js
const detection = detectJest(rootDir);
const data = {
    hasJest: detection.hasJest,
    jestConfigPath: detection.configPath,
    jestCommand: detection.jestCommand,
    testingFrameworksJson: JSON.stringify(detection.testingFrameworks),
};
```

- [ ] **Step 4: Validate, test, and commit**

Run: `npx.cmd prisma validate` from `server/`

Expected: schema valid.

Run: `npm test --prefix server -- --runInBand testingFrameworkDetector.test.js`

Expected: PASS.

Commit: `git add server/prisma server/src/services/project.service.js server/src/controllers/github.controller.js server/src/services/jestDetection.service.js server/src/tests/testingFrameworkDetector.test.js && git commit -m "feat: persist testing framework metadata per snapshot"`

### Task 4: Return the additive API contract and run regression checks

**Files:**
- Modify: `server/src/services/project.service.js`
- Modify: `server/src/controllers/project.controller.js` if it constructs snapshot output.
- Test: `server/src/tests/projectStructure.route.test.js` or focused project-service test.

**Interfaces:** Snapshot responses return parsed `testingFrameworks` or `null`; detect-Jest responses retain legacy fields plus `testingFrameworks`.

- [ ] **Step 1: Write a failing response mapping test**

```js
expect(snapshotResponse({
    id: "snapshot-1",
    testingFrameworksJson: JSON.stringify({ frameworkType: "multiple", detectedFrameworks: ["jest", "vitest"] }),
})).toMatchObject({
    testingFrameworks: { frameworkType: "multiple", detectedFrameworks: ["jest", "vitest"] },
});
```

- [ ] **Step 2: Verify failure, add defensive parsing, then verify pass**

Run: `npm test --prefix server -- --runInBand projectStructure.route.test.js`

Expected: FAIL because `testingFrameworks` is absent.

```js
const parseTestingFrameworks = (value) => {
    try { return value ? JSON.parse(value) : null; } catch { return null; }
};
```

Run: `npm test --prefix server -- --runInBand testingFrameworkDetector.test.js projectStructure.route.test.js`

Expected: PASS.

- [ ] **Step 3: Run full verification and commit**

Run: `npm test --prefix server -- --runInBand`

Expected: report any pre-existing failures separately; new detector tests pass.

Run: `npx.cmd prisma generate` from `server/`

Expected: client generated successfully.

Commit: `git add server/src/services/project.service.js server/src/controllers/project.controller.js server/src/tests && git commit -m "feat: expose testing framework detection"`

## Self-review

- Every requested subtask maps to Task 1: Jest/Vitest detection, existing test discovery, configuration detection, multiple framework detection, detected frameworks, and framework type.
- Tasks 2–4 preserve compatibility, persist snapshot data, and expose the contract.
- No placeholders or incompatible names remain.
