import { resolveProjectAccess } from "./projectAccess.service.js";
import {
  currentProjectOperation,
  operationSnapshot,
  stagePreparedValue,
  stagePreparedPublication,
  deferPreparedCommit,
} from "./projectOperationWorkspace.service.js";
import { withPreparedProjectWorkspace } from "./projectWorkspacePreparation.service.js";
import {
  scenarioArtifactVersion,
  assertScenarioVersion,
  updateScenarioService,
  getScenarioService,
  regenerateScenarioService,
} from "./scenarioManager.service.js";
import { createSnapshotJob } from "./job.service.js";
const invalidateAfterCommit = (snapshotId) =>
  currentProjectOperation()
    ? deferPreparedCommit(() => invalidateEndpointCache(snapshotId))
    : invalidateEndpointCache(snapshotId);
const stageArtifact = async (run, placeholder) =>
  stagePreparedValue(async (tx) => {
    const value = await run(tx);
    const operation = currentProjectOperation();
    if (operation && !operation.publicationMetadata?.changedPaths?.length)
      await tx.project.update({
        where: { id: operation.projectId },
        data: { workspaceRevision: { increment: 1 } },
      });
    return value;
  }, placeholder);
const guardedWorkspace = async (args, capability, run) => {
  const { snapshot, project } = args.snapshotId
    ? await verifySnapshotOwnership(args.snapshotId, args.userId)
    : await (async () => {
        const project = await verifyProjectOwnership(
          args.projectId,
          args.userId,
        );
        return { project, snapshot: project.snapshots?.[0] };
      })();
  if (!snapshot) throw new ServiceError("Snapshot not found", 404);
  await resolveProjectAccess({
    projectId: project.id,
    userId: args.userId,
    capability,
  });
  if (currentProjectOperation())
    return run({ ...args, snapshotId: snapshot.id });
  return withPreparedProjectWorkspace(
    {
      projectId: project.id,
      snapshotId: snapshot.id,
      userId: args.userId,
      capability,
      expectedWorkspaceRevision: project.workspaceRevision,
      type: "INTEGRATION_WRITE",
    },
    () => run({ ...args, snapshotId: snapshot.id }),
  );
};
import fs from "fs";
import path from "path";
import crypto from "crypto";
import prisma from "../config/prisma.js";
import { ServiceError } from "../utils/serviceError.js";
import { loadSourceCode } from "./aiContextBuilder.service.js";
import { extractValidEndpoints } from "./apiEndpointParser.service.js";
import {
  detectIntegrationFrameworks,
  installIntegrationDependencies,
} from "./integrationDetection.service.js";
import {
  buildIntegrationTestPrompt,
  validateIntegrationTestCode,
  buildFaultyTestFixPrompt,
  harvestApiDeepContext,
} from "./integrationAiTestGenerator.service.js";
import { generateText } from "./gemini.service.js";
import { extractTestRequests } from "./testSourceParser.service.js";
import {
  invalidateEndpointCache,
  discoverProjectIntegrationTests,
} from "./integrationWorkspace.service.js";
import {
  getEndpointRequiredCases,
  getScenarioCaseKey,
} from "../../../shared/integrationCaseCoverage.js";
import {
  resolveAndValidateAiTestPath,
  resolveAppImportPath,
} from "./aiTestStorage.service.js";
import { addJobToQueue } from "./queue.service.js";
import { getJobById, addJobLog } from "./job.service.js";
import { updateJobStatus } from "./jobUpdate.service.js";

/**
 * Normalizes framework string to standardized enum format.
 * @param {string} framework
 * @returns {"SUPERTEST" | "PLAYWRIGHT_API"}
 */
export const normalizeFramework = (framework = "") => {
  const lower = String(framework).toLowerCase();
  if (lower.includes("playwright")) {
    return "PLAYWRIGHT_API";
  }
  return "SUPERTEST";
};

/**
 * Validates user ownership of snapshot and project.
 * @param {string} snapshotId
 * @param {string} userId
 * @returns {Promise<{ snapshot: Object, project: Object }>}
 */
export const verifySnapshotOwnership = async (snapshotId, userId) => {
  if (!snapshotId) {
    throw new ServiceError("snapshotId is required", 400);
  }
  const snapshot = await prisma.projectSnapshot.findUnique({
    where: { id: snapshotId },
    include: { project: true },
  });
  if (!snapshot) {
    throw new ServiceError("Project snapshot not found", 404);
  }
  await resolveProjectAccess({
    projectId: snapshot.projectId,
    userId,
    capability: "project.read",
  });
  return { snapshot: operationSnapshot(snapshot), project: snapshot.project };
};

/**
 * Validates user ownership of project by projectId.
 * @param {string} projectId
 * @param {string} userId
 * @returns {Promise<Object>}
 */
export const verifyProjectOwnership = async (projectId, userId) => {
  if (!projectId) {
    throw new ServiceError("projectId is required", 400);
  }
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: {
      snapshots: { orderBy: { createdAt: "desc" }, take: 1 },
    },
  });
  if (!project) {
    throw new ServiceError("Project not found", 404);
  }
  await resolveProjectAccess({
    projectId: projectId,
    userId,
    capability: "project.read",
  });
  return {
    ...project,
    snapshots: (project.snapshots || []).map(operationSnapshot),
  };
};

/**
 * Task 4.2: Detect integration test frameworks & dependencies
 */
export const detectIntegrationFrameworksService = async ({
  snapshotId,
  projectId,
  userId,
}) => {
  let rootDir = null;
  if (snapshotId) {
    const { snapshot, project } = await verifySnapshotOwnership(
      snapshotId,
      userId,
    );
    rootDir = snapshot.rootDir || snapshot.storagePath || project.rootDir;
  } else if (projectId) {
    const project = await verifyProjectOwnership(projectId, userId);
    const latest = project.snapshots?.[0];
    rootDir = latest?.rootDir || latest?.storagePath || project.rootDir;
  } else {
    throw new ServiceError("Either snapshotId or projectId is required", 400);
  }

  if (!rootDir || !fs.existsSync(rootDir)) {
    throw new ServiceError("Project directory does not exist on disk", 404);
  }

  const detection = await detectIntegrationFrameworks(rootDir);
  return detection;
};

/**
 * Task 4.2: Install missing dependencies for integration testing
 */
const installIntegrationDependenciesInWorkspace = async ({
  snapshotId,
  projectId,
  userId,
  packages,
  framework,
}) => {
  let rootDir = null;
  if (snapshotId) {
    const { snapshot, project } = await verifySnapshotOwnership(
      snapshotId,
      userId,
    );
    rootDir = snapshot.rootDir || snapshot.storagePath || project.rootDir;
  } else if (projectId) {
    const project = await verifyProjectOwnership(projectId, userId);
    const latest = project.snapshots?.[0];
    rootDir = latest?.rootDir || latest?.storagePath || project.rootDir;
  } else {
    throw new ServiceError("Either snapshotId or projectId is required", 400);
  }

  if (!rootDir || !fs.existsSync(rootDir)) {
    throw new ServiceError("Project directory does not exist on disk", 404);
  }

  const target = framework || packages;
  const result = await installIntegrationDependencies({
    rootDir,
    packages,
    framework,
  });
  if (!result.success)
    throw new ServiceError("Dependency installation failed", 500);
  return result;
};

/**
 * Task 4.3: Queue comprehensive AI integration test generation (Cold-Start & Multi-Endpoint)
 */
export const queueIntegrationTestGenerationService = async ({
  snapshotId,
  userId,
  framework = "supertest",
  targetEndpoints = [],
  force = false,
  model,
  requestId,
}) => {
  const { snapshot, project } = await verifySnapshotOwnership(
    snapshotId,
    userId,
  );
  await resolveProjectAccess({
    projectId: snapshot.projectId,
    userId,
    capability: "ai.use",
  });
  const normFramework = normalizeFramework(framework);

  // Pre-flight dirty check (F-03): Check if user edited scenarios exist on targeted endpoints
  if (!force) {
    const existingAiTests = await prisma.aiTest.findMany({
      where: { snapshotId },
    });
    const targetSet =
      Array.isArray(targetEndpoints) && targetEndpoints.length > 0
        ? new Set(
            targetEndpoints.map((t) =>
              typeof t === "string"
                ? t.trim().toUpperCase()
                : `${t.method} ${t.path}`.trim().toUpperCase(),
            ),
          )
        : null;

    for (const test of existingAiTests) {
      if (!test.metaJson) continue;
      try {
        const meta =
          typeof test.metaJson === "string"
            ? JSON.parse(test.metaJson)
            : test.metaJson;
        if (meta.framework !== normFramework) continue;

        if (targetSet) {
          const matchedReqs = (meta.requests || []).filter((r) =>
            targetSet.has(`${r.method} ${r.path}`.toUpperCase()),
          );
          if (matchedReqs.some((r) => r.userEdited || r.enabled === false)) {
            throw new ServiceError(
              "Cannot overwrite user-edited integration scenarios. Pass force=true to override.",
              409,
            );
          }
        } else if (
          meta.userModified ||
          (meta.requests || []).some((r) => r.userEdited || r.enabled === false)
        ) {
          throw new ServiceError(
            "Cannot overwrite user-edited integration scenarios. Pass force=true to override.",
            409,
          );
        }
      } catch (err) {
        if (err.statusCode === 409) throw err;
      }
    }
  }

  const payload = {
    mode: "INTEGRATION_GENERATION",
    framework: normFramework,
    targetEndpoints,
    force,
    model,
  };
  const job = await createSnapshotJob({
    projectId: snapshot.projectId,
    snapshotId,
    userId,
    type: "AI_TESTS",
    payloadJson: payload,
    requestId,
  });
  if (!job.reused) await addJobToQueue("AI_TESTS", job.id, payload);

  return {
    job,
    message: "Integration test generation job queued successfully.",
  };
};

/**
 * Task 4.3: Pipeline execution for generating integration tests
 */
export const runIntegrationGenerationPipeline = async ({
  jobId,
  snapshotId,
  projectId,
  framework = "SUPERTEST",
  targetEndpoints = [],
  abortSignal = null,
  model,
}) => {
  const normFramework = normalizeFramework(framework);
  await updateJobStatus({ jobId, progress: 10, status: "RUNNING" }).catch(
    () => {},
  );
  await addJobLog(
    jobId,
    "INFO",
    `[Integration AI] Khởi động sinh test cho framework: ${normFramework}`,
  ).catch(() => {});

  // 1. Load source code & extract valid endpoints
  await updateJobStatus({ jobId, progress: 25 }).catch(() => {});
  await addJobLog(
    jobId,
    "INFO",
    "[Integration AI] Đang quét mã nguồn Router và Controller...",
  ).catch(() => {});
  const sourceCode = await loadSourceCode(snapshotId).catch(() => []);
  const allEndpoints = extractValidEndpoints(sourceCode);

  let endpointsToGenerate = allEndpoints;
  if (Array.isArray(targetEndpoints) && targetEndpoints.length > 0) {
    const targetSet = new Set(
      targetEndpoints.map((t) =>
        typeof t === "string"
          ? t.trim().toUpperCase()
          : `${t.method} ${t.path}`.trim().toUpperCase(),
      ),
    );
    endpointsToGenerate = allEndpoints.filter(
      (ep) =>
        targetSet.has(
          `${ep.method.toUpperCase()} ${ep.fullPath || ep.path}`.toUpperCase(),
        ) ||
        targetSet.has(`${ep.method.toUpperCase()} ${ep.path}`.toUpperCase()),
    );
    if (endpointsToGenerate.length === 0) {
      endpointsToGenerate = targetEndpoints.map((t) => {
        const parts =
          typeof t === "string"
            ? t.trim().split(/\s+/)
            : [t.method || "GET", t.path || "/api"];
        const method = parts.length > 1 ? parts[0].toUpperCase() : "GET";
        const routePath = parts.length > 1 ? parts[1] : parts[0];
        return { method, path: routePath, fullPath: routePath };
      });
    }
  } else if (endpointsToGenerate.length === 0) {
    endpointsToGenerate = [{ method: "GET", path: "/api", fullPath: "/api" }];
  }

  // 2. Gather preserved existing scenarios so Setup generation respects language and skips already-covered cases
  const snapshotRecord = await prisma.projectSnapshot
    .findUnique({
      where: { id: snapshotId },
      select: { rootDir: true },
    })
    .catch(() => null);
  const existingSuites = snapshotRecord?.rootDir
    ? await discoverProjectIntegrationTests(snapshotRecord.rootDir).catch(
        () => [],
      )
    : [];
  const existingReqs = existingSuites.flatMap((s) =>
    (s.requests || []).map((r) => ({ ...r, filePath: s.filePath })),
  );

  endpointsToGenerate = endpointsToGenerate.map((ep) => {
    const epMethod = String(ep.method || "GET").toUpperCase();
    const epPath = (ep.fullPath || ep.path || "/").replace(/\/+$/, "") || "/";
    const epRegex = new RegExp("^" + epPath.replace(/:[^\/]+/g, "[^/]+") + "$");
    const matchedExisting = existingReqs.filter((r) => {
      if (String(r.method || "").toUpperCase() !== epMethod) return false;
      const cleanReq =
        String(r.path || "/")
          .split("?")[0]
          .replace(/\/+$/, "") || "/";
      return epRegex.test(cleanReq);
    });
    const requiredCases = getEndpointRequiredCases(ep);
    const coveredKeys = new Set();
    const existingScenarios = matchedExisting.map((r) => {
      const caseKey = getScenarioCaseKey({
        title: r.testName,
        expectedStatus: r.expectedStatus,
        expectedStatuses: r.expectedStatuses,
        category: r.category,
      });
      coveredKeys.add(caseKey);
      const matchedDef = requiredCases.find((rc) => rc.key === caseKey);
      return {
        testName: r.testName,
        expectedStatus: r.expectedStatus,
        caseKey,
        caseLabel: matchedDef?.label || caseKey,
      };
    });
    const missingCases = requiredCases.filter((rc) => !coveredKeys.has(rc.key));
    return {
      ...ep,
      existingScenarios,
      missingCoverageRequested: missingCases.map((rc) => rc.promptHint),
    };
  });

  // 2.5 Build multi-scenario prompt
  await updateJobStatus({ jobId, progress: 50 }).catch(() => {});
  await addJobLog(
    jobId,
    "INFO",
    `[Integration AI] Thu thập AST context & sinh prompt cho ${endpointsToGenerate.length} API endpoint...`,
  ).catch(() => {});

  const prompt = buildIntegrationTestPrompt({
    endpoints: endpointsToGenerate,
    sourceCode,
    testFiles: existingSuites.map((s) => ({
      path: s.filePath,
      content: s.content || "",
    })),
    framework: normFramework.toLowerCase(),
  });

  // 3. Call LLM
  await updateJobStatus({ jobId, progress: 70 }).catch(() => {});
  await addJobLog(
    jobId,
    "INFO",
    "[Integration AI] Đang gửi yêu cầu tới mô hình AI LLM...",
  ).catch(() => {});

  const callStart = Date.now();
  const aiResponse = await generateText(
    prompt,
    model || process.env.GEMINI_MODEL || "gemini-3.5-flash-lite",
    {
      taskType: "integration",
      temperature: 0.2,
      maxOutputTokens: 1500,
      returnTelemetry: true,
    },
  );
  const aiResponseText =
    typeof aiResponse === "object" && aiResponse?.text !== undefined
      ? aiResponse.text
      : aiResponse;
  if (!aiResponseText || !aiResponseText.trim()) {
    throw new ServiceError("Mô hình AI trả về phản hồi rỗng", 500);
  }
  const telemetry = aiResponse?.telemetry || {
    durationMs: Date.now() - callStart,
    durationSeconds: Number(((Date.now() - callStart) / 1000).toFixed(2)),
    tokens: {
      prompt: Math.max(1, Math.round(prompt.length / 4)),
      completion: Math.max(1, Math.round((aiResponseText || "").length / 4)),
      total: Math.max(
        2,
        Math.round((prompt.length + (aiResponseText || "").length) / 4),
      ),
    },
    model: model || "gemini-3.5-flash-lite",
  };

  // 4. Extract and validate generated code
  await updateJobStatus({ jobId, progress: 85 }).catch(() => {});
  await addJobLog(
    jobId,
    "INFO",
    "[Integration AI] Kiểm duyệt an toàn cú pháp Babel AST...",
  ).catch(() => {});

  let cleanedCode = "";

  // 4.1 Try to extract code from JSON structure (buildIntegrationTestPrompt specifies JSON output)
  try {
    let jsonStr = aiResponseText.trim();
    const jsonMatch = jsonStr.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/i);
    if (jsonMatch && jsonMatch[1]) {
      jsonStr = jsonMatch[1].trim();
    } else {
      jsonStr = jsonStr
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/\s*```$/i, "")
        .trim();
    }

    const parsed = JSON.parse(jsonStr);
    if (Array.isArray(parsed?.tests) && parsed.tests.length > 0) {
      cleanedCode = parsed.tests
        .map((t) => t.content)
        .filter(Boolean)
        .join("\n\n");
    } else if (parsed?.content) {
      cleanedCode = parsed.content;
    } else if (typeof parsed === "string") {
      cleanedCode = parsed;
    }
  } catch (_) {
    // Fallback: If not valid JSON, proceed to extract raw code block
  }

  // 4.2 Fallback to markdown code block or raw text
  if (!cleanedCode) {
    const codeMatch = aiResponseText.match(
      /```(?:javascript|js|typescript|ts)?\s*([\s\S]*?)```/i,
    );
    if (codeMatch && codeMatch[1]) {
      cleanedCode = codeMatch[1].trim();
    } else {
      cleanedCode = aiResponseText.trim();
    }
  }

  // 4.3 If cleanedCode itself contains markdown code fences, unwrap them
  if (cleanedCode) {
    const innerMatch = cleanedCode.match(
      /```(?:javascript|js|typescript|ts)?\s*([\s\S]*?)```/i,
    );
    if (innerMatch && innerMatch[1]) {
      cleanedCode = innerMatch[1].trim();
    }
  }

  validateIntegrationTestCode(cleanedCode, normFramework.toLowerCase());

  // 5. Extract scenarios and save to database
  await updateJobStatus({ jobId, progress: 95 }).catch(() => {});
  const targetFilePath =
    normFramework === "PLAYWRIGHT_API"
      ? "tests/api/api-integration.spec.js"
      : "tests/integration/api-integration.test.js";

  const testRequests = extractTestRequests(cleanedCode, targetFilePath);
  const requestsMeta = testRequests.map((r) => ({
    scenarioId: crypto.randomUUID(),
    testName: r.testName,
    enabled: true,
    userEdited: false,
    origin: "AI_GENERATED",
    method: r.method,
    path: r.path,
    ...(r.expectedStatus != null ? { expectedStatus: r.expectedStatus } : {}),
    ...(Array.isArray(r.expectedStatuses) && r.expectedStatuses.length > 0
      ? { expectedStatuses: r.expectedStatuses }
      : {}),
    createdAt: new Date().toISOString(),
    telemetry: {
      durationSeconds: Number(
        (telemetry.durationSeconds / Math.max(1, testRequests.length)).toFixed(
          2,
        ),
      ),
      tokens: Math.round(
        telemetry.tokens.total / Math.max(1, testRequests.length),
      ),
    },
  }));

  const plannedId = crypto.randomUUID();
  const createdAiTest = await stageArtifact(
    (tx) =>
      tx.aiTest.create({
        data: {
          id: plannedId,
          projectId,
          snapshotId,
          filePath: targetFilePath,
          mode: "FULL",
          content: cleanedCode,
          metaJson: JSON.stringify({
            framework: normFramework,
            status: "DRAFT",
            isValid: true,
            requests: requestsMeta,
            telemetry,
          }),
        },
      }),
    { id: plannedId },
  );

  invalidateAfterCommit(snapshotId);

  await updateJobStatus({ jobId, progress: 100, status: "SUCCESS" }).catch(
    () => {},
  );
  await addJobLog(
    jobId,
    "INFO",
    `[Integration AI] Hoàn tất! Đã sinh và lưu ${requestsMeta.length} kịch bản test vào Workspace (${telemetry.durationSeconds}s, ${telemetry.tokens.total} tokens).`,
  ).catch(() => {});

  return {
    aiTestId: createdAiTest.id,
    filePath: targetFilePath,
    scenariosCount: requestsMeta.length,
    telemetry,
  };
};

/**
 * Task 4.3: Queue scenario regeneration or faulty test fix
 */
export const queueRegenerateScenarioService = async ({
  snapshotId,
  userId,
  scenarioId,
  framework = "supertest",
  failureContext = null,
  expectedVersion,
  model,
  requestId,
}) => {
  const { snapshot } = await verifySnapshotOwnership(snapshotId, userId);
  await resolveProjectAccess({
    projectId: snapshot.projectId,
    userId,
    capability: "ai.use",
  });
  if (!scenarioId) {
    throw new ServiceError("scenarioId is required", 400);
  }

  const decodedScenarioId = decodeURIComponent(scenarioId);
  const normFramework = normalizeFramework(framework);

  const tests = await prisma.aiTest.findMany({ where: { snapshotId } });
  const artifact = tests.find((test) => {
    try {
      return (JSON.parse(test.metaJson || "{}").requests || []).some(
        (r) =>
          r.scenarioId === decodedScenarioId ||
          r.testName === decodedScenarioId,
      );
    } catch {
      return false;
    }
  });
  if (!artifact) throw new ServiceError("Editable scenario not found", 404);
  assertScenarioVersion(artifact, expectedVersion);
  const payload = {
    mode: "INTEGRATION_REGENERATE",
    scenarioId: decodedScenarioId,
    framework: normFramework,
    failureContext,
    expectedVersion,
    model,
  };
  const job = await createSnapshotJob({
    projectId: snapshot.projectId,
    snapshotId,
    userId,
    type: "AI_TESTS",
    payloadJson: payload,
    requestId,
  });
  if (!job.reused) await addJobToQueue("AI_TESTS", job.id, payload);

  return {
    job,
    message: "Scenario regeneration job queued successfully.",
  };
};

/**
 * Task 4.3: Pipeline execution for regenerating a single scenario
 */
export const runRegenerateScenarioPipeline = async ({
  jobId,
  snapshotId,
  scenarioId,
  expectedVersion,
  model,
  failureContext,
}) => {
  const context = currentProjectOperation();
  if (!context || context.snapshotId !== snapshotId || context.jobId !== jobId)
    throw new ServiceError("Guarded regeneration context required", 409);
  await updateJobStatus({ jobId, progress: 20, status: "RUNNING" });
  const tests = await prisma.aiTest.findMany({ where: { snapshotId } });
  const artifact = tests.find((test) => {
    try {
      return (JSON.parse(test.metaJson || "{}").requests || []).some(
        (r) => r.scenarioId === scenarioId || r.testName === scenarioId,
      );
    } catch {
      return false;
    }
  });
  if (!artifact) throw new ServiceError("Editable scenario not found", 404);
  await regenerateScenarioService(
    artifact.id,
    scenarioId,
    { model, failureContext },
    { userId: context.userId, snapshotId, expectedVersion },
  );
  await updateJobStatus({ jobId, progress: 100, status: "SUCCESS" });
  return { scenarioId, regenerated: true };
};

/**
 * Task 4.4: Update an integration scenario by scenarioId
 */
export const updateIntegrationScenarioService = async ({
  snapshotId,
  scenarioId,
  userId,
  updates = {},
}) => {
  await verifySnapshotOwnership(snapshotId, userId);
  const tests = await prisma.aiTest.findMany({ where: { snapshotId } });
  const decoded = decodeURIComponent(scenarioId);
  const test = tests.find((test) => {
    try {
      return (JSON.parse(test.metaJson || "{}").requests || []).some(
        (r) => r.scenarioId === decoded || r.testName === decoded,
      );
    } catch {
      return false;
    }
  });
  if (!test)
    throw new ServiceError("Editable scenario not found in snapshot", 404);
  const options = {
    userId,
    snapshotId,
    expectedVersion: updates.expectedVersion,
    updates,
  };
  const code =
    updates.code || (await getScenarioService(test.id, decoded, options)).code;
  const updated = await updateScenarioService(test.id, decoded, code, options);
  return { success: true, updated: true, scenarioId: decoded, aiTest: updated };
};

/**
 * Task 4.4: Apply approved/selected integration tests directly into project source code
 */
const applyIntegrationTestsInWorkspace = async ({
  snapshotId,
  userId,
  testIds = [],
  selectedScenarios = [],
  targetFilePath = null,
  fileName = null,
}) => {
  const { snapshot, project } = await verifySnapshotOwnership(
    snapshotId,
    userId,
  );
  const rootDir = snapshot.rootDir || snapshot.storagePath || project.rootDir;

  if (!rootDir || !fs.existsSync(rootDir)) {
    throw new ServiceError(
      "Project source directory does not exist on disk",
      404,
    );
  }

  // Normalize composite keys ("aiTestId::scenarioId") and explicit scenario selections
  const explicitAiTestIds = new Set();
  const requestedScenarios = Array.isArray(selectedScenarios)
    ? [...selectedScenarios]
    : [];

  if (Array.isArray(testIds)) {
    for (const rawId of testIds) {
      if (!rawId || typeof rawId !== "string") continue;
      if (rawId.includes("::")) {
        const [aiId, scenPart] = rawId.split("::");
        if (aiId) explicitAiTestIds.add(aiId);
        if (aiId && scenPart) {
          requestedScenarios.push({
            aiTestId: aiId,
            scenarioId: scenPart,
            testName: scenPart,
          });
        }
      } else {
        explicitAiTestIds.add(rawId);
      }
    }
  }

  for (const sc of requestedScenarios) {
    if (sc?.aiTestId) explicitAiTestIds.add(sc.aiTestId);
  }

  let testsToApply = [];
  if (explicitAiTestIds.size > 0) {
    testsToApply = await prisma.aiTest.findMany({
      where: {
        snapshotId,
        id: { in: Array.from(explicitAiTestIds) },
      },
    });
  }

  // Fallback to all integration tests for snapshot if testIds contained only scenario-level IDs or was empty
  if (testsToApply.length === 0) {
    const allTests = await prisma.aiTest.findMany({
      where: { snapshotId },
    });
    testsToApply = allTests.filter((t) => {
      if (!t.metaJson) return false;
      try {
        const meta =
          typeof t.metaJson === "string" ? JSON.parse(t.metaJson) : t.metaJson;
        return (
          meta.framework === "SUPERTEST" || meta.framework === "PLAYWRIGHT_API"
        );
      } catch {
        return false;
      }
    });
  }

  if (testsToApply.length === 0) {
    throw new ServiceError(
      "No integration tests found to apply to source code",
      404,
    );
  }

  const appliedFiles = [];
  let totalScenarios = 0;

  const hasScenarioFilter = requestedScenarios.length > 0;
  const { parseCode, findScenarioPath, getScenarioIdentity } = hasScenarioFilter
    ? await import("./scenarioManager.service.js")
    : {};
  const generateModule = hasScenarioFilter
    ? await import("@babel/generator")
    : null;
  const generate =
    generateModule?.default?.default ||
    generateModule?.default ||
    generateModule;

  for (const test of testsToApply) {
    const meta = test.metaJson
      ? typeof test.metaJson === "string"
        ? JSON.parse(test.metaJson)
        : test.metaJson
      : {};
    const framework = (meta.framework || "SUPERTEST").toLowerCase();
    const requests = Array.isArray(meta.requests) ? meta.requests : [];

    // Determine if only a subset of scenarios from this test file should be written
    let contentToApply = test.content;
    let isPartialApply = false;
    let appliedScenarioIds = requests
      .map((r) => r.scenarioId || r.testName)
      .filter(Boolean);

    if (hasScenarioFilter && requests.length > 0) {
      const forThisTest = requestedScenarios.filter(
        (s) => !s.aiTestId || s.aiTestId === test.id,
      );
      if (forThisTest.length > 0) {
        const selectedSet = new Set();
        for (const s of forThisTest) {
          if (s.scenarioId) selectedSet.add(String(s.scenarioId).trim());
          if (s.testName)
            selectedSet.add(String(s.testName).trim().toLowerCase());
          if (s.title) selectedSet.add(String(s.title).trim().toLowerCase());
        }

        const matchedReqs = requests.filter((r) => {
          const idMatch =
            r.scenarioId && selectedSet.has(String(r.scenarioId).trim());
          const nameMatch =
            r.testName &&
            selectedSet.has(String(r.testName).trim().toLowerCase());
          return idMatch || nameMatch;
        });

        if (matchedReqs.length === 0) {
          continue;
        }

        if (matchedReqs.length < requests.length) {
          isPartialApply = true;
          appliedScenarioIds = matchedReqs
            .map((r) => r.scenarioId || r.testName)
            .filter(Boolean);
          const ast = parseCode(test.content);
          const matchedKeys = new Set(
            matchedReqs.map((r) => r.scenarioId || r.testName),
          );
          for (const r of requests) {
            if (!matchedKeys.has(r.scenarioId || r.testName)) {
              const { testName, nameIndex } = getScenarioIdentity(
                test,
                r.scenarioId,
              );
              const scPath = findScenarioPath(ast, testName, nameIndex);
              if (scPath) scPath.remove();
            }
          }
          contentToApply = generate(ast).code;
        }
      }
    }

    // 1. Validate test code safety
    validateIntegrationTestCode(contentToApply, framework);

    // 2. Resolve target file path securely (no path traversal allowed)
    let relPath = test.filePath;
    if (targetFilePath) {
      relPath = targetFilePath;
    } else if (fileName) {
      const ext =
        fileName.endsWith(".js") || fileName.endsWith(".ts") ? "" : ".test.js";
      relPath = path
        .join("tests", "integration", `${fileName}${ext}`)
        .replace(/\\/g, "/");
    } else if (!relPath) {
      relPath = framework.includes("playwright")
        ? "tests/api/api.spec.js"
        : "tests/integration/api.test.js";
    }

    const fullDestPath = resolveAndValidateAiTestPath(rootDir, relPath);
    const destDir = path.dirname(fullDestPath);

    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true });
    }

    // 3. Resolve application import statement
    let finalContent = contentToApply;
    try {
      finalContent = resolveAppImportPath(
        contentToApply,
        rootDir,
        fullDestPath,
      );
    } catch (err) {
      console.warn(
        `[applyIntegrationTests] Notice resolving app entry import: ${err.message}`,
      );
    }

    // 4. Write to disk
    fs.writeFileSync(fullDestPath, finalContent, "utf8");

    // 5. Update aiTest record with applied status (keep full content if partial apply)
    meta.appliedScenarios = Array.from(
      new Set([
        ...(Array.isArray(meta.appliedScenarios) ? meta.appliedScenarios : []),
        ...appliedScenarioIds,
      ]),
    );
    meta.status =
      isPartialApply && meta.appliedScenarios.length < requests.length
        ? "PARTIAL_APPLIED"
        : "APPLIED";
    meta.appliedAt = new Date().toISOString();

    await stagePreparedPublication((tx) =>
      tx.aiTest.update({
        where: { id: test.id },
        data: {
          ...(isPartialApply
            ? {}
            : { filePath: relPath, content: finalContent }),
          metaJson: JSON.stringify(meta),
        },
      }),
    );

    const scenariosWritten = isPartialApply
      ? appliedScenarioIds.length
      : requests.length || 1;
    appliedFiles.push({ filePath: relPath, scenariosCount: scenariosWritten });
    totalScenarios += scenariosWritten;
  }

  const flushedDeletes = await (await import("./scenarioManager.service.js"))
    .flushStagedIntegrationDeletesToDisk({ snapshotId, userId })
    .catch(() => ({ appliedDeletions: 0, filesUpdated: [] }));

  if (
    appliedFiles.length === 0 &&
    (flushedDeletes.appliedDeletions || 0) === 0
  ) {
    throw new ServiceError(
      "No matching test scenarios found to apply to source code",
      404,
    );
  }

  for (const fp of flushedDeletes.filesUpdated || []) {
    appliedFiles.push({
      filePath: fp,
      scenariosCount: 0,
      deletionsApplied: flushedDeletes.appliedDeletions,
    });
  }

  await stagePreparedPublication(async (tx) => {
    const operation = currentProjectOperation();
    if (operation && !operation.publicationMetadata?.changedPaths?.length)
      await tx.project.update({
        where: { id: operation.projectId },
        data: { workspaceRevision: { increment: 1 } },
      });
  });
  invalidateAfterCommit(snapshotId);

  return {
    success: true,
    message: `Đã áp dụng thành công ${appliedFiles.length} file test vào mã nguồn dự án.`,
    appliedFiles,
    totalScenarios,
    suggestRerun: true, // Prompts user to rerun coverage analysis to confirm 100% coverage
  };
};

export const installIntegrationDependenciesService = (args) =>
  guardedWorkspace(
    args,
    "integrations.write",
    installIntegrationDependenciesInWorkspace,
  );
export const applyIntegrationTestsService = (args) =>
  guardedWorkspace(args, "files.write", applyIntegrationTestsInWorkspace);
