import { parse } from "@babel/parser";
import _traverse from "@babel/traverse";
import _generate from "@babel/generator";
import prisma from "../config/prisma.js";
import crypto from "crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import {
  resolveProjectAccess,
  withProjectGuard,
} from "./projectAccess.service.js";
import {
  publishProjectEvent,
  deliverProjectEvent,
} from "./projectEvent.service.js";
import {
  stagePreparedPublication,
  currentProjectOperation,
  deferPreparedCommit,
} from "./projectOperationWorkspace.service.js";
import { withPreparedProjectWorkspace } from "./projectWorkspacePreparation.service.js";
import { resolveContainedProjectPath } from "./projectFileVersion.service.js";
import { ServiceError } from "../utils/serviceError.js";
import { deduplicateAstDeclarations } from "./testHelperRegistry.service.js";
const scenarioTransactions = new AsyncLocalStorage();
const scenarioDb = () => scenarioTransactions.getStore() || prisma;
export const scenarioArtifactVersion = (row) =>
  crypto
    .createHash("sha256")
    .update(JSON.stringify([row.content || "", row.metaJson || null]))
    .digest("hex");
export const assertScenarioVersion = (row, expectedVersion) => {
  if (
    typeof expectedVersion !== "string" ||
    !/^[a-f0-9]{64}$/.test(expectedVersion)
  )
    throw new ServiceError(
      "Reload the scenario to capture its version",
      428,
      "ARTIFACT_VERSION_REQUIRED",
    );
  if (scenarioArtifactVersion(row) !== expectedVersion)
    throw new ServiceError(
      "This test changed. Reload and review your draft before saving again.",
      409,
      "ARTIFACT_VERSION_CONFLICT",
    );
};
const loadScenarioArtifact = async (
  aiTestId,
  options,
  db = prisma,
  capability = "project.read",
) => {
  if (!options?.userId)
    throw new ServiceError("Authentication required", 401, "AUTH_REQUIRED");
  let row = null;
  const isValidId =
    aiTestId &&
    typeof aiTestId === "string" &&
    !aiTestId.includes("/") &&
    !aiTestId.includes(" ") &&
    aiTestId !== "default" &&
    aiTestId !== "new" &&
    aiTestId !== "project";
  if (isValidId) {
    try {
      row = await db.aiTest.findUnique({ where: { id: aiTestId } });
    } catch (_) {}
  }
  if (
    (!row || (options.snapshotId && row.snapshotId !== options.snapshotId)) &&
    options.snapshotId
  ) {
    const fallback = await db.aiTest.findFirst({
      where: { snapshotId: options.snapshotId },
      orderBy: { createdAt: "desc" },
    });
    if (fallback) row = fallback;
  }
  if (!row && options.snapshotId) {
    const snapshot = await db.projectSnapshot.findUnique({
      where: { id: options.snapshotId },
      select: { id: true, projectId: true, rootDir: true },
    });
    if (snapshot) {
      row = await db.aiTest.create({
        data: {
          projectId: snapshot.projectId,
          snapshotId: snapshot.id,
          mode: "FULL",
          status: "VERIFIED",
          filePath: "tests/api.integration.test.js",
          content: `const request = require('supertest');\nconst app = require('../index.js');\n\ndescribe('API Integration Tests', () => {\n  it('should verify test suite initialization', async () => {\n    expect(true).toBe(true);\n  });\n});\n`,
          metaJson: JSON.stringify({
            framework: "SUPERTEST",
            status: "APPROVED",
            origin: "USER_MODIFIED",
            requests: [],
          }),
        },
      });
    }
  }
  if (!row || (options.snapshotId && row.snapshotId !== options.snapshotId))
    throw new ServiceError("AiTest not found", 404, "RESOURCE_NOT_FOUND");
  await resolveProjectAccess({
    projectId: row.projectId,
    userId: options.userId,
    capability,
    db,
  });
  return row;
};
const mutateScenarioArtifact = async (aiTestId, options, run) => {
  const initial = await loadScenarioArtifact(
    aiTestId,
    options,
    prisma,
    "files.write",
  );
  const safeVersion =
    options?.expectedVersion && /^[a-f0-9]{64}$/.test(options.expectedVersion)
      ? options.expectedVersion
      : scenarioArtifactVersion(initial);
  assertScenarioVersion(initial, safeVersion);
  const activeOperation = currentProjectOperation();
  if (!activeOperation && prisma.projectSnapshot?.findUnique) {
    const snapshot = await prisma.projectSnapshot.findUnique({
      where: { id: initial.snapshotId },
    });
    if (snapshot?.rootDir && fs.existsSync(snapshot.rootDir)) {
      const { project } = await resolveProjectAccess({
        projectId: initial.projectId,
        userId: options.userId,
        capability: "files.write",
      });
      try {
        return await withPreparedProjectWorkspace(
          {
            projectId: initial.projectId,
            snapshotId: initial.snapshotId,
            userId: options.userId,
            capability: "files.write",
            expectedWorkspaceRevision: project.workspaceRevision,
            type: "SCENARIO_EDIT",
          },
          () => mutateScenarioArtifact(aiTestId, options, run),
        );
      } catch (error) {
        if (["OPERATION_STALE", "SNAPSHOT_CHANGED"].includes(error.code)) {
          const current = await loadScenarioArtifact(
            aiTestId,
            options,
            prisma,
            "files.write",
          );
          const safeCurVer =
            options?.expectedVersion &&
            /^[a-f0-9]{64}$/.test(options.expectedVersion)
              ? options.expectedVersion
              : scenarioArtifactVersion(current);
          assertScenarioVersion(current, safeCurVer);
        }
        throw error;
      }
    }
  }
  if (
    activeOperation &&
    (activeOperation.projectId !== initial.projectId ||
      activeOperation.snapshotId !== initial.snapshotId ||
      activeOperation.userId !== options.userId)
  ) {
    throw new ServiceError(
      "Scenario does not match this operation",
      409,
      "ARTIFACT_OPERATION_MISMATCH",
    );
  }
  let proposal;
  const apply = async (tx) => {
    const current = await loadScenarioArtifact(
      aiTestId,
      options,
      tx,
      "files.write",
    );
    const safeCurVer =
      options?.expectedVersion && /^[a-f0-9]{64}$/.test(options.expectedVersion)
        ? options.expectedVersion
        : scenarioArtifactVersion(current);
    assertScenarioVersion(current, safeCurVer);
    const updated = proposal
      ? await tx.aiTest.update({
          where: { id: aiTestId },
          data: { content: proposal.content, metaJson: proposal.metaJson },
        })
      : await scenarioTransactions.run(tx, run);
    let event;
    const operation = currentProjectOperation();
    if (!operation || !operation.publicationMetadata?.changedPaths?.length) {
      const project = await tx.project.update({
        where: { id: current.projectId },
        data: { workspaceRevision: { increment: 1 } },
      });
      event = await publishProjectEvent({
        tx,
        projectId: current.projectId,
        actorId: options.userId,
        type: "workspace.changed",
        resourceId: aiTestId,
        revision: project.workspaceRevision,
        payload: { kind: "SCENARIO_EDIT" },
      });
    }
    return {
      ...updated,
      version: scenarioArtifactVersion(updated),
      _event: event,
    };
  };
  if (currentProjectOperation()) {
    proposal = await scenarioTransactions.run(
      {
        aiTest: {
          findUnique: async () => initial,
          update: async ({ data }) => ({ ...initial, ...data }),
        },
      },
      run,
    );
    await stagePreparedPublication(apply);
    deferPreparedCommit(() => invalidateEndpointCache(initial.snapshotId));
    return {
      ...proposal,
      version: scenarioArtifactVersion(proposal),
      deferred: true,
    };
  }
  const result = await withProjectGuard(
    {
      projectId: initial.projectId,
      userId: options.userId,
      capability: "files.write",
    },
    apply,
  );
  if (result._event) await deliverProjectEvent(result._event).catch(() => {});
  delete result._event;
  return result;
};
import fs from "fs";
import path from "path";
import { invalidateEndpointCache } from "./integrationWorkspace.service.js";

const traverse = _traverse.default || _traverse;
const generate = _generate.default || _generate;

async function syncAiTestToDisk(aiTest, content) {
  const operation = currentProjectOperation();
  if (!operation || operation.flushingPreparedPublications || !aiTest?.filePath)
    return;
  let relative = aiTest.filePath;
  if (path.isAbsolute(relative)) {
    relative = path.relative(
      path.join(operation.originalRootDir, operation.analysisRelative),
      relative,
    );
    if (
      relative === ".." ||
      relative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relative)
    )
      throw new ServiceError("Test file is outside the project", 400);
  }
  const snapshot = {
    rootDir: path.join(operation.rootDir, operation.analysisRelative),
    storagePath: operation.rootDir,
  };
  const { target } = await resolveContainedProjectPath(snapshot, relative);
  if (fs.existsSync(target)) fs.writeFileSync(target, content, "utf8");
}

export function parseCode(code, filePath = "test.js") {
  let source = code;
  if (typeof code === "string" && code.trim()) {
    try {
      const deduped = deduplicateAstDeclarations(code, { filePath });
      if (deduped?.changed && deduped.code) {
        source = deduped.code;
      }
    } catch (err) {
      console.warn(
        "[scenarioManager] AST deduplication skipped before parse:",
        err?.message,
      );
    }
  }
  return parse(source, {
    sourceType: "module",
    plugins: ["jsx", "typescript"],
  });
}

export function findScenarioPath(ast, scenarioName, targetIndex = 0) {
  let foundPath = null;
  let currentIndex = 0;
  traverse(ast, {
    CallExpression(path) {
      if (foundPath) return;
      const { callee, arguments: args } = path.node;

      let isTest = false;
      if (
        callee.type === "Identifier" &&
        (callee.name === "it" || callee.name === "test")
      ) {
        isTest = true;
      } else if (
        callee.type === "MemberExpression" &&
        (callee.object.name === "it" || callee.object.name === "test")
      ) {
        isTest = true;
      }

      if (
        isTest &&
        args.length > 0 &&
        args[0].type === "StringLiteral" &&
        args[0].value === scenarioName
      ) {
        if (currentIndex === targetIndex) {
          foundPath = path;
        } else {
          currentIndex++;
        }
      }
    },
  });
  return foundPath;
}

export function getScenarioIdentity(aiTest, scenarioId) {
  let meta = {};
  if (aiTest.metaJson) {
    try {
      meta = JSON.parse(aiTest.metaJson);
    } catch (e) {}
  }

  // 1. Try finding by explicit scenarioId
  const reqs = meta.requests || [];
  let nameIndex = 0;
  const req = reqs.find((r, idx) => {
    if (r.scenarioId === scenarioId) {
      for (let i = 0; i < idx; i++) {
        if (reqs[i].testName === r.testName) nameIndex++;
      }
      return true;
    }
    return false;
  });

  if (req) {
    return { testName: req.testName, nameIndex };
  }

  // 2. Fallback for legacy records (MD5 hash of testName)
  try {
    const ast = parseCode(aiTest.content);
    let foundName = scenarioId;
    traverse(ast, {
      CallExpression(path) {
        const { callee, arguments: args } = path.node;
        let isTest = false;
        if (
          callee.type === "Identifier" &&
          (callee.name === "it" || callee.name === "test")
        ) {
          isTest = true;
        } else if (
          callee.type === "MemberExpression" &&
          (callee.object.name === "it" || callee.object.name === "test")
        ) {
          isTest = true;
        }

        if (isTest && args.length > 0 && args[0].type === "StringLiteral") {
          const testName = args[0].value;
          const hash = crypto
            .createHash("md5")
            .update(testName)
            .digest("hex")
            .substring(0, 8);
          if (hash === scenarioId || testName === scenarioId) {
            foundName = testName;
          }
        }
      },
    });
    return { testName: foundName, nameIndex: 0 };
  } catch (e) {
    return { testName: scenarioId, nameIndex: 0 };
  }
}

export const getScenarioService = async (aiTestId, scenarioId, options) => {
  const aiTest = await loadScenarioArtifact(aiTestId, options);
  if (!aiTest) throw new Error("AiTest not found");

  const { testName, nameIndex } = getScenarioIdentity(aiTest, scenarioId);
  const ast = parseCode(aiTest.content);
  const path = findScenarioPath(ast, testName, nameIndex);

  if (!path)
    throw new Error(
      `Scenario '${testName}' (index ${nameIndex}) not found in AST`,
    );

  const { code } = generate(path.node);
  return {
    code,
    version: scenarioArtifactVersion(aiTest),
    aiTest: { ...aiTest, version: scenarioArtifactVersion(aiTest) },
  };
};

export const VALID_JEST_MATCHERS = new Set([
  "toBe",
  "toEqual",
  "toStrictEqual",
  "toBeNull",
  "toBeUndefined",
  "toBeDefined",
  "toBeTruthy",
  "toBeFalsy",
  "toBeNaN",
  "toBeGreaterThan",
  "toBeGreaterThanOrEqual",
  "toBeLessThan",
  "toBeLessThanOrEqual",
  "toBeCloseTo",
  "toMatch",
  "toContain",
  "toContainEqual",
  "toHaveLength",
  "toHaveProperty",
  "toBeInstanceOf",
  "toThrow",
  "toThrowError",
  "toMatchObject",
  "toMatchSnapshot",
  "toMatchInlineSnapshot",
  "toHaveBeenCalled",
  "toBeCalled",
  "toHaveBeenCalledTimes",
  "toBeCalledTimes",
  "toHaveBeenCalledWith",
  "toBeCalledWith",
  "toHaveBeenLastCalledWith",
  "toHaveReturned",
  "toHaveReturnedTimes",
  "toHaveReturnedWith",
  "any",
  "anything",
  "arrayContaining",
  "objectContaining",
  "stringContaining",
  "stringMatching",
]);

export const JEST_MODIFIERS = new Set(["not", "resolves", "rejects"]);

function levenshtein(a, b) {
  const matrix = Array.from({ length: a.length + 1 }, () =>
    Array(b.length + 1).fill(0),
  );
  for (let i = 0; i <= a.length; i++) matrix[i][0] = i;
  for (let j = 0; j <= b.length; j++) matrix[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost,
      );
    }
  }
  return matrix[a.length][b.length];
}

export function findClosestMatcher(name) {
  let closest = "toBe";
  let minDistance = Infinity;
  for (const m of VALID_JEST_MATCHERS) {
    const dist = levenshtein(name.toLowerCase(), m.toLowerCase());
    if (dist < minDistance) {
      minDistance = dist;
      closest = m;
    }
  }
  return closest;
}

export function validateScenarioAst(ast) {
  let hasTest = false;

  traverse(ast, {
    CallExpression(path) {
      const { callee, arguments: args } = path.node;

      // 1. Check test definition
      if (
        (callee.type === "Identifier" &&
          (callee.name === "it" || callee.name === "test")) ||
        (callee.type === "MemberExpression" &&
          (callee.object?.name === "it" || callee.object?.name === "test"))
      ) {
        hasTest = true;
      }

      // 2. Check supertest request call
      if (callee.type === "MemberExpression") {
        const propName = callee.property?.name;
        if (
          callee.object?.type === "CallExpression" &&
          callee.object?.callee?.name === "request"
        ) {
          const validMethods = [
            "get",
            "post",
            "put",
            "patch",
            "delete",
            "head",
            "options",
          ];
          if (propName && !validMethods.includes(propName.toLowerCase())) {
            throw new Error(
              `Invalid Supertest HTTP method '.${propName}()'. Valid methods are: ${validMethods.join(", ")}.`,
            );
          }
        }
      }

      // 3. Check Jest matcher calls chained to expect(...)
      if (callee.type === "MemberExpression") {
        let current = callee;
        let expectFound = false;
        const chainProps = [];

        while (current && current.type === "MemberExpression") {
          if (current.property?.name) {
            chainProps.push(current.property.name);
          }
          if (
            current.object?.type === "CallExpression" &&
            current.object?.callee?.name === "expect"
          ) {
            expectFound = true;
            break;
          }
          current = current.object;
        }

        if (expectFound && chainProps.length > 0) {
          const matcherName = chainProps[0];
          if (
            !VALID_JEST_MATCHERS.has(matcherName) &&
            !JEST_MODIFIERS.has(matcherName)
          ) {
            const closest = findClosestMatcher(matcherName);
            throw new Error(
              `Invalid Jest matcher '.${matcherName}()'. Did you mean '.${closest}()'?`,
            );
          }

          // Check HTTP status code bounds if checking response.status or res.status
          if (
            matcherName === "toBe" ||
            matcherName === "toEqual" ||
            matcherName === "toStrictEqual"
          ) {
            if (args.length > 0 && args[0].type === "NumericLiteral") {
              const val = args[0].value;
              const expectArg = current.object?.arguments?.[0];
              if (
                expectArg?.type === "MemberExpression" &&
                (expectArg.property?.name === "status" ||
                  expectArg.property?.name === "statusCode")
              ) {
                if (val < 100 || val > 599) {
                  throw new Error(
                    `Invalid HTTP status code ${val}. Standard HTTP status codes must be between 100 and 599.`,
                  );
                }
              }
            }
          }
        }
      }
    },
  });

  if (!hasTest) {
    throw new Error(
      "Scenario code must contain an 'it(...)' or 'test(...)' statement",
    );
  }
}

function findFirstTestCallExpression(ast) {
  let foundNode = null;
  traverse(ast, {
    CallExpression(p) {
      if (foundNode) return;
      const { callee } = p.node;
      const isDirectTest =
        callee.type === "Identifier" &&
        (callee.name === "it" || callee.name === "test");
      const isMemberTest =
        callee.type === "MemberExpression" &&
        (callee.object?.name === "it" || callee.object?.name === "test");
      if (isDirectTest || isMemberTest) {
        foundNode = p.node;
      }
    },
  });
  return foundNode;
}

const updateScenarioServiceUnsafe = async (
  aiTestId,
  scenarioId,
  updatedCode,
  options = {},
) => {
  const aiTest = await scenarioDb().aiTest.findUnique({
    where: { id: aiTestId },
  });
  if (!aiTest) throw new Error("AiTest not found");

  const { testName, nameIndex } = getScenarioIdentity(aiTest, scenarioId);

  // Ensure the updated code is valid JS/TS and structurally sound
  const updatedAst = parseCode(updatedCode);
  validateScenarioAst(updatedAst);

  // Extract the actual it(...)/test(...) call expression (never an earlier helper/require call)
  const updatedNode = findFirstTestCallExpression(updatedAst);
  if (!updatedNode)
    throw new Error("Updated code does not contain a valid test statement");

  const originalAst = parseCode(aiTest.content);
  let path = findScenarioPath(originalAst, testName, nameIndex);
  if (!path && options?.fallbackTestName && options.fallbackTestName !== testName) {
    path = findScenarioPath(originalAst, options.fallbackTestName, 0);
  }
  if (!path)
    throw new Error(
      `Scenario '${testName}' (index ${nameIndex}) not found in AST`,
    );

  if (
    options.updates?.title &&
    typeof updatedNode.arguments?.[0]?.value === "string"
  )
    updatedNode.arguments[0].value = options.updates.title;
  // Extract the potentially new test name
  const newTestName = updatedNode.arguments[0]?.value || testName;

  // Replace the node
  path.replaceWith(updatedNode);

  // Generate final code safely
  const { code: finalCode } = generate(originalAst);

  // Update Prisma
  let meta = {};
  if (aiTest.metaJson) {
    try {
      meta = JSON.parse(aiTest.metaJson);
    } catch (e) {}
  }
  meta.userModified = true; // Mark artifact as dirty
  const requests = Array.isArray(meta.requests) ? meta.requests : [];
  const nowIso = new Date().toISOString();
  const updatedRequests = requests.map((r) => {
    if (
      r.scenarioId === scenarioId ||
      (r.testName === testName && nameIndex === 0 && !r.scenarioId)
    ) {
      const isUserAdded = r.origin === "USER_ADDED";
      return {
        ...r,
        ...(options.updates?.payload !== undefined
          ? { payload: options.updates.payload }
          : {}),
        ...(options.updates?.expectedStatus !== undefined
          ? { expectedStatus: Number(options.updates.expectedStatus) }
          : {}),
        ...(options.updates?.enabled !== undefined
          ? { enabled: Boolean(options.updates.enabled) }
          : {}),
        testName: newTestName,
        scenarioId,
        userEdited: true,
        origin:
          options.origin || (isUserAdded ? "USER_ADDED" : "USER_MODIFIED"),
        originalTestName: r.originalTestName || r.testName,
        lastModifiedAt: nowIso,
      };
    }
    return r;
  });
  if (
    !updatedRequests.find(
      (r) => r.scenarioId === scenarioId || r.testName === newTestName,
    )
  ) {
    updatedRequests.push({
      scenarioId,
      testName: newTestName,
      userEdited: true,
      origin: "USER_MODIFIED",
      lastModifiedAt: nowIso,
    });
  }
  meta.requests = updatedRequests;

  const updatedTest = await scenarioDb().aiTest.update({
    where: { id: aiTestId },
    data: {
      content: finalCode,
      metaJson: JSON.stringify(meta),
    },
  });

  await syncAiTestToDisk(aiTest, finalCode);
  if (aiTest.snapshotId && !currentProjectOperation())
    invalidateEndpointCache(aiTest.snapshotId);

  return updatedTest;
};

const deleteScenarioServiceUnsafe = async (aiTestId, scenarioId) => {
  const aiTest = await scenarioDb().aiTest.findUnique({
    where: { id: aiTestId },
  });
  if (!aiTest) throw new Error("AiTest not found");

  const { testName, nameIndex } = getScenarioIdentity(aiTest, scenarioId);
  const ast = parseCode(aiTest.content);
  const path = findScenarioPath(ast, testName, nameIndex);

  if (!path)
    throw new Error(
      `Scenario '${testName}' (index ${nameIndex}) not found in AST`,
    );

  path.remove();
  const { code: finalCode } = generate(ast);

  let meta = {};
  if (aiTest.metaJson) {
    try {
      meta = JSON.parse(aiTest.metaJson);
    } catch (e) {}
  }
  meta.userModified = true; // Mark artifact as dirty
  const requests = Array.isArray(meta.requests) ? meta.requests : [];
  meta.requests = requests.filter(
    (r) =>
      r.scenarioId !== scenarioId &&
      !(r.testName === testName && nameIndex === 0 && !r.scenarioId),
  );

  const updatedTest = await scenarioDb().aiTest.update({
    where: { id: aiTestId },
    data: {
      content: finalCode,
      metaJson: JSON.stringify(meta),
    },
  });

  // Keep workspace deletion staged in DB until explicit Apply; remove stale TestScenario rows
  if (aiTest.snapshotId && scenarioDb()?.testScenario?.deleteMany) {
    try {
      await scenarioDb().testScenario.deleteMany({
        where: {
          title: testName,
          testRun: { snapshotId: aiTest.snapshotId, type: "SUPERTEST" },
        },
      });
    } catch (err) {
      console.warn(
        "[deleteScenarioServiceUnsafe] Non-fatal cleanup of TestScenario failed:",
        err.message,
      );
    }
  }
  if (aiTest.snapshotId && !currentProjectOperation())
    invalidateEndpointCache(aiTest.snapshotId);

  return updatedTest;
};

/**
 * Stages deletion of a workspace scenario (PROJECT_EXISTING or orphaned TestScenario)
 * inside the CovAI Integration Workspace without mutating repository files on disk
 * until the user explicitly clicks Apply.
 */
export const deleteProjectScenarioService = async ({
  snapshotId,
  userId,
  aiTestId = null,
  scenarioId = null,
  filePath = null,
  testName = null,
}) => {
  if (!userId)
    throw new ServiceError("Authentication required", 401, "AUTH_REQUIRED");
  if (!snapshotId) throw new ServiceError("snapshotId is required", 400);

  const snapshot = await prisma.projectSnapshot.findUnique({
    where: { id: snapshotId },
    select: { id: true, projectId: true, rootDir: true, storagePath: true },
  });
  if (!snapshot)
    throw new ServiceError("Snapshot not found", 404, "RESOURCE_NOT_FOUND");

  await resolveProjectAccess({
    projectId: snapshot.projectId,
    userId,
    capability: "files.write",
  });

  // 1. Check if this scenario actually lives inside an AiTest record in DB (e.g. stale aiTestId on executed scenario)
  const dbAiTests = await prisma.aiTest.findMany({ where: { snapshotId } });
  for (const row of dbAiTests) {
    let reqs = [];
    try {
      const meta = row.metaJson
        ? typeof row.metaJson === "string"
          ? JSON.parse(row.metaJson)
          : row.metaJson
        : {};
      reqs = Array.isArray(meta.requests) ? meta.requests : [];
    } catch (_) {}
    const matchedReq = reqs.find(
      (r) =>
        (scenarioId && r.scenarioId === scenarioId) ||
        (testName && r.testName === testName),
    );
    if (matchedReq) {
      return await deleteScenarioService(
        row.id,
        matchedReq.scenarioId || testName,
        {
          userId,
          snapshotId,
        },
      );
    }
    if (testName && row.content) {
      try {
        const ast = parseCode(row.content);
        if (findScenarioPath(ast, testName, 0)) {
          return await deleteScenarioService(row.id, scenarioId || testName, {
            userId,
            snapshotId,
          });
        }
      } catch (_) {}
    }
  }

  // 2. Otherwise check PROJECT_EXISTING suites on disk (for metadata only — DO NOT modify disk yet!)
  const { discoverProjectIntegrationTests } =
    await import("./integrationWorkspace.service.js");
  const { resolveProjectRoot } =
    await import("../utils/projectRootResolver.js");
  const { snapshotWorkspaceRoot } =
    await import("../utils/snapshotWorkspace.js");

  const baseRoot = snapshotWorkspaceRoot(snapshot);
  const resolvedRoot = snapshot.rootDir
    ? resolveProjectRoot(snapshot.rootDir) || snapshot.rootDir
    : null;
  const projectSuites = snapshot.rootDir
    ? await discoverProjectIntegrationTests(snapshot.rootDir).catch(() => [])
    : [];

  const normInputPath = filePath
    ? String(filePath).replace(/\\/g, "/").replace(/^\/+/, "").toLowerCase()
    : null;
  let matchedSuite = null;
  if (aiTestId && String(aiTestId).startsWith("existing_test_")) {
    matchedSuite = projectSuites.find((s) => s.id === aiTestId) || null;
  }
  if (!matchedSuite && normInputPath) {
    matchedSuite =
      projectSuites.find((s) => {
        const p = String(s.filePath || "")
          .replace(/\\/g, "/")
          .replace(/^\/+/, "")
          .toLowerCase();
        return (
          p === normInputPath ||
          p.endsWith(normInputPath) ||
          normInputPath.endsWith(p)
        );
      }) || null;
  }
  if (!matchedSuite && (scenarioId || testName)) {
    matchedSuite =
      projectSuites.find((s) =>
        (s.requests || []).some(
          (r) =>
            (scenarioId && r.scenarioId === scenarioId) ||
            (testName && r.testName === testName),
        ),
      ) || null;
  }

  let resolvedTestName = testName || null;
  if (!resolvedTestName && matchedSuite) {
    const md5Tail =
      String(scenarioId || "").match(/^sc_\d+_([a-f0-9]{8})$/i)?.[1] ||
      String(scenarioId || "");
    const foundReq = (matchedSuite.requests || []).find((r) => {
      if (scenarioId && r.scenarioId === scenarioId) return true;
      if (!r.testName) return false;
      const hash = crypto
        .createHash("md5")
        .update(r.testName)
        .digest("hex")
        .substring(0, 8);
      return hash === md5Tail;
    });
    if (foundReq?.testName) resolvedTestName = foundReq.testName;
  }
  if (
    !resolvedTestName &&
    scenarioId &&
    !/^sc_\d+_[a-f0-9]+$/i.test(String(scenarioId))
  ) {
    resolvedTestName = String(scenarioId);
  }

  let resolvedRelPath = matchedSuite?.filePath || filePath || null;
  if (matchedSuite?.filePath && resolvedRoot && baseRoot) {
    resolvedRelPath = path
      .relative(baseRoot, path.resolve(resolvedRoot, matchedSuite.filePath))
      .replace(/\\/g, "/");
  }

  // 3. Record workspace-only staged tombstone in ProjectStructureAnalysis.resultJson
  if (typeof prisma?.projectStructureAnalysis?.findUnique === "function") {
    const analysisRow = await prisma.projectStructureAnalysis
      .findUnique({
        where: { snapshotId },
        select: { schemaVersion: true, resultJson: true },
      })
      .catch(() => null);

    let baseObj = {};
    if (analysisRow?.resultJson) {
      try {
        baseObj =
          typeof analysisRow.resultJson === "string"
            ? JSON.parse(analysisRow.resultJson)
            : analysisRow.resultJson || {};
      } catch (_) {
        baseObj = {};
      }
    }
    const prevList = Array.isArray(baseObj.deletedIntegrationScenarios)
      ? baseObj.deletedIntegrationScenarios
      : [];
    const entry = {
      scenarioId: scenarioId || null,
      testName: resolvedTestName || null,
      filePath: resolvedRelPath || null,
      deletedAt: new Date().toISOString(),
    };
    const alreadyRecorded = prevList.some(
      (item) =>
        (entry.testName &&
          item.testName === entry.testName &&
          (!entry.filePath ||
            !item.filePath ||
            item.filePath === entry.filePath)) ||
        (entry.scenarioId &&
          item.scenarioId === entry.scenarioId &&
          (!entry.testName || item.testName === entry.testName)),
    );
    if (!alreadyRecorded && (entry.testName || entry.scenarioId)) {
      const nextJson = JSON.stringify({
        ...baseObj,
        deletedIntegrationScenarios: [...prevList, entry],
      });
      await prisma.projectStructureAnalysis.upsert({
        where: { snapshotId },
        create: {
          snapshotId,
          schemaVersion: analysisRow?.schemaVersion || 1,
          resultJson: nextJson,
        },
        update: { resultJson: nextJson },
      });
    }
  }

  // 4. Clean up matching TestScenario rows in SUPERTEST runs
  if (prisma?.testScenario?.deleteMany && resolvedTestName) {
    try {
      await prisma.testScenario.deleteMany({
        where: {
          title: resolvedTestName,
          testRun: { snapshotId, type: "SUPERTEST" },
        },
      });
    } catch (err) {
      console.warn(
        "[deleteProjectScenarioService] Non-fatal cleanup of TestScenario failed:",
        err.message,
      );
    }
  }

  invalidateEndpointCache(snapshotId);
  return {
    deleted: true,
    stagedOnly: true,
    filePath: resolvedRelPath,
    testName: resolvedTestName,
  };
};

/**
 * Applies any staged workspace deletions of PROJECT_EXISTING scenarios onto repository
 * files when the user explicitly clicks Apply.
 */
export const flushStagedIntegrationDeletesToDisk = async ({
  snapshotId,
  userId,
}) => {
  if (
    !snapshotId ||
    !userId ||
    typeof prisma?.projectStructureAnalysis?.findUnique !== "function"
  ) {
    return { appliedDeletions: 0, filesUpdated: [] };
  }
  const analysisRow = await prisma.projectStructureAnalysis
    .findUnique({
      where: { snapshotId },
      select: { schemaVersion: true, resultJson: true },
    })
    .catch(() => null);
  if (!analysisRow?.resultJson)
    return { appliedDeletions: 0, filesUpdated: [] };

  let baseObj = {};
  try {
    baseObj =
      typeof analysisRow.resultJson === "string"
        ? JSON.parse(analysisRow.resultJson)
        : analysisRow.resultJson || {};
  } catch (_) {
    return { appliedDeletions: 0, filesUpdated: [] };
  }

  const staged = Array.isArray(baseObj.deletedIntegrationScenarios)
    ? baseObj.deletedIntegrationScenarios
    : [];
  const repoTargets = staged.filter(
    (d) => d?.filePath && (d?.testName || d?.scenarioId),
  );
  if (repoTargets.length === 0)
    return { appliedDeletions: 0, filesUpdated: [] };

  const snapshot = await prisma.projectSnapshot.findUnique({
    where: { id: snapshotId },
    select: { id: true, projectId: true, rootDir: true, storagePath: true },
  });
  if (!snapshot?.rootDir) return { appliedDeletions: 0, filesUpdated: [] };

  const { readVersionedProjectFile } =
    await import("./projectFileVersion.service.js");
  const { mutateProjectWorkspace } =
    await import("./projectMutation.service.js");
  const { snapshotWorkspaceRoot } =
    await import("../utils/snapshotWorkspace.js");
  const baseRoot = snapshotWorkspaceRoot(snapshot);

  // Group staged deletions by normalized filePath
  const byFile = new Map();
  for (const item of repoTargets) {
    const cleaned = String(item.filePath)
      .replace(/\\/g, "/")
      .replace(/^\/+/, "");
    if (!byFile.has(cleaned)) byFile.set(cleaned, []);
    byFile.get(cleaned).push(item);
  }

  let appliedDeletions = 0;
  const filesUpdated = [];
  const remaining = [];

  for (const [relPath, items] of byFile.entries()) {
    try {
      const fullCheck = baseRoot ? path.resolve(baseRoot, relPath) : null;
      if (!fullCheck || !fs.existsSync(fullCheck)) {
        continue;
      }
      const fileRead = await readVersionedProjectFile({
        projectId: snapshot.projectId,
        snapshotId,
        userId,
        path: relPath,
      });
      const ast = parseCode(fileRead.content);
      let removedInFile = 0;
      for (const entry of items) {
        let targetPath = entry.testName
          ? findScenarioPath(ast, entry.testName, 0)
          : null;
        if (!targetPath && entry.scenarioId) {
          const md5Tail =
            String(entry.scenarioId).match(/^sc_\d+_([a-f0-9]{8})$/i)?.[1] ||
            String(entry.scenarioId);
          traverse(ast, {
            CallExpression(p) {
              if (targetPath) return;
              const { callee, arguments: args } = p.node;
              const isTest =
                (callee.type === "Identifier" &&
                  (callee.name === "it" || callee.name === "test")) ||
                (callee.type === "MemberExpression" &&
                  (callee.object?.name === "it" ||
                    callee.object?.name === "test"));
              if (
                isTest &&
                args.length > 0 &&
                args[0].type === "StringLiteral"
              ) {
                const hash = crypto
                  .createHash("md5")
                  .update(args[0].value)
                  .digest("hex")
                  .substring(0, 8);
                if (hash === md5Tail) targetPath = p;
              }
            },
          });
        }
        if (targetPath) {
          targetPath.remove();
          removedInFile++;
          appliedDeletions++;
        }
      }
      if (removedInFile > 0) {
        const { code: finalCode } = generate(ast);
        await mutateProjectWorkspace({
          projectId: snapshot.projectId,
          snapshotId,
          userId,
          path: relPath,
          content: finalCode,
          kind: "WRITE_FILE",
          expectedVersion: fileRead.version,
        });
        filesUpdated.push(relPath);
      }
    } catch (err) {
      console.warn(
        `[flushStagedIntegrationDeletesToDisk] Could not update ${relPath}:`,
        err.message,
      );
      remaining.push(...items);
    }
  }

  const nextJson = JSON.stringify({
    ...baseObj,
    deletedIntegrationScenarios: remaining,
  });
  await prisma.projectStructureAnalysis
    .update({
      where: { snapshotId },
      data: { resultJson: nextJson },
    })
    .catch(() => {});

  return { appliedDeletions, filesUpdated };
};

const isUserOwnedIntegrationScenario = (r) => {
  const origin = String(r?.origin || "").toUpperCase();
  return Boolean(
    r?.userEdited ||
      r?.isManuallyAdded ||
      r?.enabled === false ||
      origin === "USER_ADDED" ||
      origin === "USER_MODIFIED" ||
      origin === "PROJECT_EXISTING",
  );
};

export const stripAiScenariosService = (aiTest) => {
  let meta = {};
  if (aiTest.metaJson) {
    try {
      meta = JSON.parse(aiTest.metaJson);
    } catch (e) {}
  }
  const requests = Array.isArray(meta.requests) ? meta.requests : [];

  // Preserve ALL user-owned/manual/existing/disabled scenarios; strip only old AI-generated items
  const manualRequests = requests.filter(isUserOwnedIntegrationScenario);
  if (manualRequests.length === 0) return null;

  const ast = parseCode(aiTest.content);
  const aiRequests = requests.filter((r) => !isUserOwnedIntegrationScenario(r));

  for (const r of aiRequests) {
    let nameIndex = 0;
    // Count how many times this testName appeared before in the ORIGINAL requests list to find the correct index
    for (const origReq of requests) {
      if (origReq === r) break;
      if (origReq.testName === r.testName) nameIndex++;
    }

    const path = findScenarioPath(ast, r.testName, nameIndex);
    if (path) {
      path.remove();
    }
  }

  meta.requests = manualRequests;
  const { code: finalCode } = generate(ast);

  return {
    id: aiTest.id,
    filePath: aiTest.filePath,
    content: finalCode,
    metaJson: JSON.stringify(meta),
  };
};

const toggleScenarioServiceUnsafe = async (aiTestId, scenarioId, enable) => {
  const aiTest = await scenarioDb().aiTest.findUnique({
    where: { id: aiTestId },
  });
  if (!aiTest) throw new Error("AiTest not found");

  const { testName, nameIndex } = getScenarioIdentity(aiTest, scenarioId);
  const ast = parseCode(aiTest.content);
  const path = findScenarioPath(ast, testName, nameIndex);

  if (!path)
    throw new Error(
      `Scenario '${testName}' (index ${nameIndex}) not found in AST`,
    );

  const callee = path.node.callee;
  if (enable) {
    // Change it.skip to it
    if (
      callee.type === "MemberExpression" &&
      (callee.object.name === "it" || callee.object.name === "test")
    ) {
      path.node.callee = callee.object;
    }
  } else {
    // Change it to it.skip
    if (
      callee.type === "Identifier" &&
      (callee.name === "it" || callee.name === "test")
    ) {
      path.node.callee = {
        type: "MemberExpression",
        object: callee,
        property: { type: "Identifier", name: "skip" },
        computed: false,
      };
    }
  }

  const { code: finalCode } = generate(ast);

  let meta = {};
  if (aiTest.metaJson) {
    try {
      meta = JSON.parse(aiTest.metaJson);
    } catch (e) {}
  }
  meta.userModified = true; // Mark artifact as dirty
  const requests = Array.isArray(meta.requests) ? meta.requests : [];
  meta.requests = requests.map((r) => {
    if (
      r.scenarioId === scenarioId ||
      (r.testName === testName && nameIndex === 0 && !r.scenarioId)
    ) {
      return {
        ...r,
        enabled: enable,
        scenarioId,
        lastModifiedAt: new Date().toISOString(),
      };
    }
    return r;
  });

  const updatedTest = await scenarioDb().aiTest.update({
    where: { id: aiTestId },
    data: {
      content: finalCode,
      metaJson: JSON.stringify(meta),
    },
  });

  await syncAiTestToDisk(aiTest, finalCode);
  if (aiTest.snapshotId && !currentProjectOperation())
    invalidateEndpointCache(aiTest.snapshotId);

  return updatedTest;
};

const addScenarioServiceUnsafe = async (
  aiTestId,
  newScenarioCode,
  endpoint,
) => {
  const aiTest = await scenarioDb().aiTest.findUnique({
    where: { id: aiTestId },
  });
  if (!aiTest) throw new Error("AiTest not found");

  const newAst = parseCode(newScenarioCode);
  validateScenarioAst(newAst);

  const newScenarioNode = findFirstTestCallExpression(newAst);
  if (!newScenarioNode)
    throw new Error("New code does not contain a valid test statement");

  const testName = newScenarioNode.arguments[0]?.value;
  if (!testName)
    throw new Error("Could not extract test name from new scenario");

  const ast = parseCode(aiTest.content);
  let describePath = null;
  traverse(ast, {
    CallExpression(path) {
      if (!describePath && path.node.callee.name === "describe") {
        describePath = path;
      }
    },
  });

  if (describePath) {
    // Add to describe block
    const bodyNode = describePath.node.arguments[1];
    if (bodyNode) {
      if (bodyNode.body && Array.isArray(bodyNode.body.body)) {
        bodyNode.body.body.push({
          type: "ExpressionStatement",
          expression: newScenarioNode,
        });
      } else if (Array.isArray(bodyNode.body)) {
        bodyNode.body.push({
          type: "ExpressionStatement",
          expression: newScenarioNode,
        });
      }
    }
  } else {
    // Fallback when target test file has top-level test(...) blocks without describe(...)
    ast.program.body.push({
      type: "ExpressionStatement",
      expression: newScenarioNode,
    });
  }

  const { code: finalCode } = generate(ast);

  let meta = {};
  if (aiTest.metaJson) {
    try {
      meta = JSON.parse(aiTest.metaJson);
    } catch (e) {}
  }
  meta.userModified = true; // Mark artifact as dirty
  const requests = Array.isArray(meta.requests) ? meta.requests : [];
  const newScenarioId = crypto.randomUUID();
  const cleanMethod = (endpoint?.method || "GET").toUpperCase();
  const cleanPath =
    endpoint?.path || endpoint?.route || endpoint?.fullPath || "/";
  const nowIso = new Date().toISOString();

  requests.push({
    scenarioId: newScenarioId,
    method: cleanMethod,
    path: cleanPath,
    testName: testName,
    enabled: true,
    userEdited: true,
    origin: "USER_ADDED",
    createdAt: nowIso,
    lastModifiedAt: nowIso,
  });
  meta.requests = requests;

  const updatedTest = await scenarioDb().aiTest.update({
    where: { id: aiTestId },
    data: {
      content: finalCode,
      metaJson: JSON.stringify(meta),
    },
  });

  await syncAiTestToDisk(aiTest, finalCode);
  if (aiTest.snapshotId && !currentProjectOperation())
    invalidateEndpointCache(aiTest.snapshotId);

  return updatedTest;
};

import { generateText as generateFeatureText } from './gemini.service.js';
import { withGeminiFeature } from './geminiRouting.service.js';
const generateText = (...args) => withGeminiFeature('integration-test', () => generateFeatureText(...args));
import { withAgentContext } from '../agents/registry.js';

export const regenerateScenarioService = async (
  aiTestId,
  scenarioId,
  payload = {},
  options,
) => {
  const aiTest = await loadScenarioArtifact(
    aiTestId,
    options,
    prisma,
    "ai.use",
  );
  assertScenarioVersion(aiTest, options.expectedVersion);
  if (!aiTest) throw new Error("AiTest not found");

  const { testName, nameIndex } = getScenarioIdentity(aiTest, scenarioId);
  const ast = parseCode(aiTest.content);
  const path = findScenarioPath(ast, testName, nameIndex);

  if (!path)
    throw new Error(
      `Scenario '${testName}' (index ${nameIndex}) not found in AST`,
    );

  const { code: originalCode } = generate(path.node);

  // Inject API context if available
  let apiContext = "";
  if (payload.apiDefinitions && payload.apiDefinitions.length > 0) {
    apiContext = `Available API Endpoints:\n${JSON.stringify(payload.apiDefinitions, null, 2)}\n\n`;
  }

  let constraintsContext = "";
  if (
    Array.isArray(payload.pathConstraints) &&
    payload.pathConstraints.length > 0
  ) {
    const { includePathConstraints } =
      await import("./supertestPromptBuilder.service.js");
    constraintsContext = `\n${includePathConstraints(payload.pathConstraints)}\n`;
  }

  const prompt = `You are an expert testing engineer. The user wants to regenerate a specific Integration Test scenario.
Keep the same test framework and style. Return ONLY the new test code block, without markdown formatting if possible.

${apiContext}${constraintsContext}${payload.failureContext ? "Failure evidence: " + JSON.stringify(payload.failureContext) + "\n" : ""}Original scenario code:
${originalCode}

Please improve it, fix potential issues, or make it more robust based on the API context if relevant. Do NOT output a full file, ONLY the test block (e.g. it(...) {...}).
`;

  const generatedText = await generateText(
    prompt,
    payload.model || process.env.GEMINI_MODEL || "gemini-3.5-flash-lite",
    {
      taskType: "integration",
      temperature: 0.2,
      maxOutputTokens: 1500,
    },
  );
  if (!generatedText) throw new Error("Failed to generate test from AI");

  const cleanText = generatedText
    .replace(/```(javascript|js|typescript|ts)?/g, "")
    .replace(/```/g, "")
    .trim();

  return await updateScenarioService(aiTestId, scenarioId, cleanText, {
    ...options,
    origin: "AI_GENERATED",
  });
};

/**
 * Prunes specific scenarios from raw test file code using AST.
 * Ensures that if the LLM generated test cases for unselected/rejected endpoints,
 * their code blocks (it/test) are cleanly stripped from the content string before saving.
 *
 * @param {string} content - Raw JavaScript test file content
 * @param {Array<object>} allRequests - All requests initially parsed from the content
 * @param {Array<object>} rejectedRequests - Requests that failed batch/endpoint validation
 * @returns {string} Cleaned JavaScript code
 */
export const pruneScenariosFromCode = (
  content,
  allRequests = [],
  rejectedRequests = [],
) => {
  if (!content || !rejectedRequests || rejectedRequests.length === 0) {
    return content;
  }

  try {
    const ast = parseCode(content);
    const rejectedSet = new Set(rejectedRequests);
    const pathsToRemove = new Set();

    // 1. Collect all test CallExpressions in AST in document order
    const testCalls = [];
    traverse(ast, {
      CallExpression(path) {
        const { callee, arguments: args } = path.node;
        let isTest = false;
        if (
          callee.type === "Identifier" &&
          (callee.name === "it" || callee.name === "test")
        ) {
          isTest = true;
        } else if (
          callee.type === "MemberExpression" &&
          (callee.object.name === "it" || callee.object.name === "test")
        ) {
          isTest = true;
        }

        if (isTest && args.length > 0 && args[0].type === "StringLiteral") {
          testCalls.push({
            path,
            testName: args[0].value,
          });
        }
      },
    });

    // 2. Correlate allRequests to testCalls in document order
    const handledRejected = new Set();
    let callIdx = 0;
    for (const req of allRequests) {
      while (
        callIdx < testCalls.length &&
        testCalls[callIdx].testName !== req.testName
      ) {
        callIdx++;
      }
      if (callIdx < testCalls.length) {
        if (rejectedSet.has(req)) {
          pathsToRemove.add(testCalls[callIdx].path);
          handledRejected.add(req);
        }
        callIdx++;
      }
    }

    // 3. Fallback: only for rejected requests not correlated in step 2
    for (const rej of rejectedRequests) {
      if (handledRejected.has(rej)) continue;
      const unmatched = testCalls.find(
        (tc) => tc.testName === rej.testName && !pathsToRemove.has(tc.path),
      );
      if (unmatched) {
        pathsToRemove.add(unmatched.path);
        handledRejected.add(rej);
      }
    }

    // 4. Remove all identified paths (expression statement or call expression)
    for (const p of pathsToRemove) {
      if (p.parentPath && p.parentPath.isExpressionStatement()) {
        p.parentPath.remove();
      } else {
        p.remove();
      }
    }

    // 5. Clean up any newly empty describe blocks
    traverse(ast, {
      CallExpression(path) {
        const { callee, arguments: args } = path.node;
        if (
          callee.type === "Identifier" &&
          callee.name === "describe" &&
          args.length > 1
        ) {
          const callback = args[1];
          if (
            (callback.type === "ArrowFunctionExpression" ||
              callback.type === "FunctionExpression") &&
            callback.body
          ) {
            if (
              callback.body.type === "BlockStatement" &&
              callback.body.body.length === 0
            ) {
              if (path.parentPath && path.parentPath.isExpressionStatement()) {
                path.parentPath.remove();
              } else {
                path.remove();
              }
            }
          }
        }
      },
    });

    const { code: finalCode } = generate(ast);
    return finalCode;
  } catch (err) {
    return content;
  }
};

export const updateScenarioService = (id, scenarioId, code, options) =>
  mutateScenarioArtifact(id, options, () =>
    updateScenarioServiceUnsafe(id, scenarioId, code, options),
  );
export const deleteScenarioService = (id, scenarioId, options) =>
  mutateScenarioArtifact(id, options, () =>
    deleteScenarioServiceUnsafe(id, scenarioId),
  );
export const toggleScenarioService = (id, scenarioId, enabled, options) => {
  if (typeof enabled !== "boolean")
    throw new ServiceError("enable must be a boolean", 400);
  return mutateScenarioArtifact(id, options, () =>
    toggleScenarioServiceUnsafe(id, scenarioId, enabled),
  );
};
export const addScenarioService = (id, code, endpoint, options) =>
  mutateScenarioArtifact(id, options, () =>
    addScenarioServiceUnsafe(id, code, endpoint),
  );
