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
  pruneScenariosFromCode,
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
import { jsonrepair } from "jsonrepair";
import prisma from "../config/prisma.js";
import { ServiceError } from "../utils/serviceError.js";
import { normalizeDiskPath } from "../utils/snapshotWorkspace.js";
import { loadSourceCode } from "./aiContextBuilder.service.js";
import { extractValidEndpoints } from "./apiEndpointParser.service.js";
import {
  detectIntegrationFrameworks,
  installIntegrationDependencies,
} from "./integrationDetection.service.js";
import {
  buildIntegrationTestPrompt,
  buildIntegrationRepairPrompt,
  validateIntegrationTestCode,
  buildFaultyTestFixPrompt,
  harvestApiDeepContext,
} from "./integrationAiTestGenerator.service.js";
import { deduplicateAstDeclarations } from "./testHelperRegistry.service.js";
import {
  prepareExpressEntriesForSupertest,
  adaptPlaywrightApiCodeForJest,
  transformTestCodeForProject,
  ensureProjectDependencies,
} from "./supertestCoverageJob.service.js";
import { runSupertest } from "./supertestRunner.service.js";
import { parseJestResults } from "./testResultParser.service.js";
import { generateText as generateFeatureText } from "./gemini.service.js";
import { withGeminiFeature } from "./geminiRouting.service.js";
const generateText = (...args) =>
  withGeminiFeature("integration-test", () => generateFeatureText(...args));
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
  resolveRelativeProjectImports,
} from "./aiTestStorage.service.js";
import { resolveProjectRoot } from "../utils/projectRootResolver.js";
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

const resolveExistingRootDir = (snapshot, project) => {
  const raw = snapshot?.rootDir || snapshot?.storagePath || project?.rootDir;
  return normalizeDiskPath(raw) || raw;
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
    rootDir = resolveExistingRootDir(snapshot, project);
  } else if (projectId) {
    const project = await verifyProjectOwnership(projectId, userId);
    const latest = project.snapshots?.[0];
    rootDir = resolveExistingRootDir(latest, project);
  } else {
    throw new ServiceError("Either snapshotId or projectId is required", 400);
  }

  if (
    rootDir &&
    /^\/?app\/(?:storage|uploads)\//i.test(
      String(rootDir).replace(/\\/g, "/"),
    ) &&
    !fs.existsSync(rootDir)
  ) {
    rootDir = resolveProjectRoot(rootDir) || rootDir;
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
    rootDir = resolveExistingRootDir(snapshot, project);
  } else if (projectId) {
    const project = await verifyProjectOwnership(projectId, userId);
    const latest = project.snapshots?.[0];
    rootDir = resolveExistingRootDir(latest, project);
  } else {
    throw new ServiceError("Either snapshotId or projectId is required", 400);
  }

  if (
    rootDir &&
    /^\/?app\/(?:storage|uploads)\//i.test(
      String(rootDir).replace(/\\/g, "/"),
    ) &&
    !fs.existsSync(rootDir)
  ) {
    rootDir = resolveProjectRoot(rootDir) || rootDir;
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

  // Non-destructive generation policy: existing user/manual scenarios are preserved
  // alongside newly generated AI scenarios cleanly.
  void force;

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
  // Integration Test generation targets Jest + Supertest exclusively (Playwright remains reserved for System/E2E tests)
  void framework;
  const normFramework = "SUPERTEST";
  await updateJobStatus({ jobId, progress: 10, status: "RUNNING" }).catch(
    () => {},
  );
  await addJobLog(
    jobId,
    "INFO",
    `[Integration AI] Starting test generation for framework: ${normFramework}`,
  ).catch(() => {});

  // 1. Load source code & extract valid endpoints
  await updateJobStatus({ jobId, progress: 25 }).catch(() => {});
  await addJobLog(
    jobId,
    "INFO",
    "[Integration AI] Scanning Router and Controller source code...",
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
  const resolvedSnapshotRoot = snapshotRecord?.rootDir
    ? normalizeDiskPath(snapshotRecord.rootDir) || snapshotRecord.rootDir
    : null;
  const existingSuites = resolvedSnapshotRoot
    ? await discoverProjectIntegrationTests(resolvedSnapshotRoot).catch(
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
    return {
      ...ep,
      existingScenarios,
      // Always generate the exact N required cases (existing user tests stay preserved separately)
      missingCoverageRequested: requiredCases.map((rc) => rc.promptHint),
    };
  });

  // 2.5 Build multi-scenario prompt
  await updateJobStatus({ jobId, progress: 45 }).catch(() => {});
  await addJobLog(
    jobId,
    "INFO",
    `[Integration AI] Thu thập AST context & sinh prompt cho ${endpointsToGenerate.length} API endpoint...`,
  ).catch(() => {});

  const hydratedTestFiles = existingSuites.map((s) => {
    let content = s.content || "";
    if (!content && s.filePath && resolvedSnapshotRoot) {
      try {
        const absTest = path.isAbsolute(s.filePath)
          ? s.filePath
          : path.join(resolvedSnapshotRoot, s.filePath);
        if (fs.existsSync(absTest)) {
          content = fs.readFileSync(absTest, "utf8");
        }
      } catch (readErr) {
        console.warn(
          "[Integration AI] Could not read existing test file:",
          readErr?.message,
        );
      }
    }
    return { path: s.filePath, content };
  });

  const backendSubdir =
    resolvedSnapshotRoot && fs.existsSync(resolvedSnapshotRoot)
      ? ["server", "backend", "api"].find(
          (sub) =>
            fs.existsSync(
              path.join(resolvedSnapshotRoot, sub, "package.json"),
            ) || fs.existsSync(path.join(resolvedSnapshotRoot, sub, "src")),
        ) || ""
      : "";
  const baseTargetFilePath =
    normFramework === "PLAYWRIGHT_API"
      ? "tests/api/api-integration.spec.js"
      : "tests/integration/api-integration.test.js";
  const targetFilePath = backendSubdir
    ? `${backendSubdir}/${baseTargetFilePath}`
    : baseTargetFilePath;

  const prompt = buildIntegrationTestPrompt({
    endpoints: endpointsToGenerate,
    sourceCode,
    testFiles: hydratedTestFiles,
    framework: normFramework.toLowerCase(),
    targetFilePath,
  });

  // 3. Call LLM
  await updateJobStatus({ jobId, progress: 70 }).catch(() => {});
  await addJobLog(
    jobId,
    "INFO",
    "[Integration AI] Đang gửi yêu cầu tới mô hình AI LLM...",
  ).catch(() => {});

  const callStart = Date.now();
  const aiResponse = await generateText(prompt, model || null, {
    taskType: "integration",
    temperature: 0.2,
    maxOutputTokens: 16384,
    returnTelemetry: true,
  });
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

  const extractRawGeneratedCode = (rawResponseText) => {
    let extracted = "";
    try {
      let jsonStr = String(rawResponseText || "").trim();
      const fencedJsonMatch = jsonStr.match(
        /^```(?:json)?\s*([\s\S]*?)\s*```$/i,
      );
      if (fencedJsonMatch && fencedJsonMatch[1]) {
        jsonStr = fencedJsonMatch[1].trim();
      } else {
        const firstBrace = jsonStr.indexOf("{");
        const lastBrace = jsonStr.lastIndexOf("}");
        if (firstBrace !== -1 && lastBrace > firstBrace) {
          jsonStr = jsonStr.slice(firstBrace, lastBrace + 1);
        } else {
          jsonStr = jsonStr
            .replace(/^```(?:json)?\s*/i, "")
            .replace(/\s*```$/i, "")
            .trim();
        }
      }
      const parsed = JSON.parse(jsonrepair(jsonStr));
      if (Array.isArray(parsed?.tests) && parsed.tests.length > 0) {
        extracted = parsed.tests
          .map((t) => t.content)
          .filter(Boolean)
          .join("\n\n");
      } else if (parsed?.content) {
        extracted = parsed.content;
      } else if (typeof parsed === "string") {
        extracted = parsed;
      }
    } catch (_) {
      // Fallback: extract raw markdown code block when response is not JSON
    }

    if (!extracted) {
      const codeMatch = String(rawResponseText || "").match(
        /```(?:javascript|js|typescript|ts)?\s*([\s\S]*)```/i,
      );
      extracted =
        codeMatch?.[1]?.trim() || String(rawResponseText || "").trim();
    }

    const innerMatch = extracted.match(
      /^```(?:javascript|js|typescript|ts)?\s*([\s\S]*?)\s*```$/i,
    );
    if (innerMatch?.[1]) extracted = innerMatch[1].trim();
    return extracted;
  };

  const parseAndDeduplicateResponse = (rawResponseText) => {
    let extracted = extractRawGeneratedCode(rawResponseText);

    if (extracted) {
      try {
        const deduped = deduplicateAstDeclarations(extracted, {
          filePath: targetFilePath,
        });
        if (deduped?.changed && deduped.code) extracted = deduped.code;
      } catch (dedupErr) {
        console.warn(
          "[Integration AI] AST declaration deduplication warning:",
          dedupErr?.message,
        );
      }
      if (resolvedSnapshotRoot && fs.existsSync(resolvedSnapshotRoot)) {
        extracted = resolveRelativeProjectImports(
          extracted,
          resolvedSnapshotRoot,
          targetFilePath,
        );
      }
      // Deterministic safety net 1: if AI manually mocked Stripe objects (cs_* / pi_*) without a `created` Unix timestamp,
      // inject `created` so `new Date(obj.created * 1000).toISOString()` never throws RangeError: Invalid time value.
      if (
        /(?:unstable_mockModule|mock)\s*\(\s*['"]stripe['"]/.test(extracted)
      ) {
        extracted = extracted.replace(
          /(\{\s*id\s*:\s*(?:['"](?:cs|pi)_[^'"]*['"]|id\b(?:\s*\|\|\s*['"](?:cs|pi)_[^'"]*['"])?))(?![^{}]*\bcreated\s*:)/g,
          "$1, created: Math.floor(Date.now() / 1000)",
        );
        extracted = extracted.replace(
          /(retrieve\s*:\s*jest\.fn\(\)\.mockImplementation\(\s*(?:async\s*)?\(?\s*([a-zA-Z_$][\w$]*)\s*\)?\s*=>\s*\{)(?![\s\S]{0,120}\.trim\(\))/,
          "$1\n              if (!$2 || !String($2).trim()) { throw new Error('Invalid id'); }",
        );
      }
      // Deterministic safety net 2: in ESM tests, CommonJS setupFilesAfterEnv cannot intercept ESM `import` of `@google/generative-ai`.
      // If the project imports `@google/generative-ai` and the generated ESM test forgot to mock it, inject a deterministic mock before the app import.
      const projectUsesGenAi = (sourceCode || []).some((f) =>
        /@google\/generative-ai/.test(String(f?.content || "")),
      );
      if (
        projectUsesGenAi &&
        /\bawait\s+import\s*\(/.test(extracted) &&
        !/(?:unstable_mockModule|mock)\s*\(\s*['"]@google\/generative-ai['"]/.test(
          extracted,
        )
      ) {
        const genAiMockSnippet = [
          `await jest.unstable_mockModule('@google/generative-ai', () => ({`,
          `  GoogleGenerativeAI: jest.fn().mockImplementation(() => ({`,
          `    getGenerativeModel: jest.fn().mockReturnValue({`,
          `      generateContent: jest.fn().mockResolvedValue({ response: { text: () => JSON.stringify({ summary: 'Mock AI summary.', topics: ['Technology'] }), usageMetadata: { totalTokenCount: 30 } } }),`,
          `      startChat: jest.fn().mockReturnValue({ sendMessage: jest.fn().mockResolvedValue({ response: { text: () => 'Mock AI chat response.', usageMetadata: { totalTokenCount: 30 } } }) }),`,
          `    }),`,
          `  })),`,
          `}));`,
          ``,
        ].join("\n");
        extracted = extracted.replace(
          /^((?:const|let|var)\s+[^\n;]*?=\s*await\s+import\s*\()/m,
          `${genAiMockSnippet}$1`,
        );
      }
    }

    validateIntegrationTestCode(extracted, normFramework.toLowerCase());
    return extracted;
  };

  let cleanedCode;
  try {
    cleanedCode = parseAndDeduplicateResponse(aiResponseText);
  } catch (initialParseErr) {
    const isSyntaxOrEmpty =
      /AST syntax error|Generated test code is empty/i.test(
        initialParseErr?.message || "",
      );
    if (!isSyntaxOrEmpty || abortSignal?.aborted) {
      throw initialParseErr;
    }
    await addJobLog(
      jobId,
      "WARN",
      `[Integration AI] Phát hiện lỗi cú pháp trong mã test vừa sinh (${initialParseErr.message}). Đang yêu cầu AI tự sửa cú pháp...`,
    ).catch(() => {});
    const brokenCode = extractRawGeneratedCode(aiResponseText);
    const syntaxRepairPrompt = [
      `You are a Principal Node.js QA Engineer.`,
      `The generated ${normFramework} integration test file below failed Babel AST parsing with:`,
      `\`${initialParseErr.message}\``,
      ``,
      `Fix ONLY the JavaScript syntax error(s) so the entire file parses cleanly (ensure all blocks, parentheses, template literals, and strings are closed properly; do not drop endpoints).`,
      `Return ONLY valid JSON inside \`\`\`json\`\`\`:`,
      `\`\`\`json`,
      `{`,
      `  "content": "// Complete, syntactically valid test file..."`,
      `}`,
      `\`\`\``,
      ``,
      `### BROKEN TEST FILE:`,
      `\`\`\`javascript`,
      brokenCode.slice(0, 32000),
      `\`\`\``,
    ].join("\n");
    const repairedResp = await generateText(syntaxRepairPrompt, model || null, {
      taskType: "integration",
      temperature: 0.1,
      maxOutputTokens: 16384,
      returnTelemetry: true,
    });
    const repairedText =
      typeof repairedResp === "object" && repairedResp?.text !== undefined
        ? repairedResp.text
        : repairedResp;
    cleanedCode = parseAndDeduplicateResponse(repairedText);
  }

  const evaluateGeneratedCompleteness = (
    code,
    filePath,
    endpointsToGenerate = [],
  ) => {
    const parsedRequests = extractTestRequests(code, filePath);
    const matchEndpoint = (r) =>
      endpointsToGenerate.find((ep) => {
        const epMethod = String(ep.method || "GET").toUpperCase();
        if (String(r.method || "").toUpperCase() !== epMethod) return false;
        const epPath =
          (ep.fullPath || ep.path || "/").replace(/\/+$/, "") || "/";
        const cleanReq =
          String(r.path || "/")
            .split("?")[0]
            .replace(/\/+$/, "") || "/";
        return new RegExp("^" + epPath.replace(/:[^/]+/g, "[^/]+") + "$").test(
          cleanReq,
        );
      });

    const coveredByEpKey = new Map();
    const unexpectedRequests = [];

    for (const r of parsedRequests) {
      const matchedEp = matchEndpoint(r);
      if (!matchedEp) {
        unexpectedRequests.push({
          method: String(r.method || "GET").toUpperCase(),
          path: r.path || "/",
          testName: r.testName || "Unnamed scenario",
        });
        continue;
      }
      const epKey = `${String(matchedEp.method || "GET").toUpperCase()} ${matchedEp.fullPath || matchedEp.path || "/"}`;
      const caseKey = getScenarioCaseKey({
        title: r.testName,
        expectedStatus: r.expectedStatus,
        expectedStatuses: r.expectedStatuses,
      });
      const set = coveredByEpKey.get(epKey) || new Set();
      set.add(caseKey);
      coveredByEpKey.set(epKey, set);
    }

    let coveredCasesCount = 0;
    let totalRequiredCases = 0;
    const missingCases = [];

    for (const ep of endpointsToGenerate) {
      const epMethod = String(ep.method || "GET").toUpperCase();
      const epPath = ep.fullPath || ep.path || "/";
      const epKey = `${epMethod} ${epPath}`;
      const requiredCases = getEndpointRequiredCases(ep);
      totalRequiredCases += requiredCases.length;
      const present = coveredByEpKey.get(epKey) || new Set();
      const missing = [];
      for (const rc of requiredCases) {
        if (present.has(rc.key)) {
          coveredCasesCount++;
        } else {
          missing.push(rc.promptHint || rc.label || rc.key);
        }
      }
      if (missing.length > 0) {
        missingCases.push({
          epKey,
          method: epMethod,
          path: epPath,
          missingLabels: missing,
        });
      }
    }

    return {
      parsedRequests,
      coveredCasesCount,
      totalRequiredCases,
      missingCases,
      unexpectedRequests,
    };
  };

  // 4.5 Verify generated scenarios against real Jest/Supertest runner & auto-repair failures
  let verificationSummary = null;
  const checkHasRunnableJestAndSupertest = () =>
    Boolean(
      resolvedSnapshotRoot &&
      fs.existsSync(resolvedSnapshotRoot) &&
      ["", "server", "backend", "api"].some(
        (sub) =>
          fs.existsSync(
            path.join(resolvedSnapshotRoot, sub, "node_modules", "jest"),
          ) &&
          fs.existsSync(
            path.join(resolvedSnapshotRoot, sub, "node_modules", "supertest"),
          ),
      ),
    );
  let hasRunnableJestAndSupertest = checkHasRunnableJestAndSupertest();
  if (
    !hasRunnableJestAndSupertest &&
    resolvedSnapshotRoot &&
    fs.existsSync(resolvedSnapshotRoot) &&
    !abortSignal?.aborted
  ) {
    try {
      await addJobLog(
        jobId,
        "INFO",
        "[Integration AI] Đang chuẩn bị dependencies (jest/supertest) để xác minh kịch bản AI...",
      ).catch(() => {});
      await ensureProjectDependencies(jobId, resolvedSnapshotRoot);
      hasRunnableJestAndSupertest = checkHasRunnableJestAndSupertest();
      if (!hasRunnableJestAndSupertest) {
        await installIntegrationDependencies(resolvedSnapshotRoot, "supertest");
        hasRunnableJestAndSupertest = checkHasRunnableJestAndSupertest();
      }
    } catch (depErr) {
      console.warn(
        "[Integration AI] Dependency install before verification warning:",
        depErr?.message,
      );
      await addJobLog(
        jobId,
        "WARN",
        `[Integration AI] Không thể cài dependencies tự động để xác minh: ${depErr?.message || "Unknown error"}`,
      ).catch(() => {});
    }
  }

  if (hasRunnableJestAndSupertest && !abortSignal?.aborted) {
    const absCandidatePath = resolveAndValidateAiTestPath(
      resolvedSnapshotRoot,
      targetFilePath,
    );
    const hadOriginalFile = fs.existsSync(absCandidatePath);
    const originalFileContent = hadOriginalFile
      ? fs.readFileSync(absCandidatePath, "utf8")
      : null;
    let restoreEntries = () => {};
    let bestCode = cleanedCode;
    let bestCoveredCases = -1;
    let bestPassed = -1;
    let bestFailed = Number.POSITIVE_INFINITY;
    let bestFailureSummary = null;

    try {
      restoreEntries =
        await prepareExpressEntriesForSupertest(resolvedSnapshotRoot);
      const maxVerifyPasses = 5;

      for (let pass = 1; pass <= maxVerifyPasses; pass++) {
        if (abortSignal?.aborted) break;
        await updateJobStatus({
          jobId,
          progress: Math.min(92, 72 + pass * 5),
        }).catch(() => {});
        await addJobLog(
          jobId,
          "INFO",
          `[Integration AI] Chạy kiểm thử xác minh kịch bản sinh ra (lượt ${pass}/${maxVerifyPasses})...`,
        ).catch(() => {});

        const adaptedForExec =
          normFramework === "PLAYWRIGHT_API" ||
          /@playwright\/test/.test(cleanedCode)
            ? adaptPlaywrightApiCodeForJest(
                cleanedCode,
                resolvedSnapshotRoot,
                absCandidatePath,
              )
            : cleanedCode;
        const execCode = await transformTestCodeForProject(
          adaptedForExec,
          resolvedSnapshotRoot,
          absCandidatePath,
        );
        fs.mkdirSync(path.dirname(absCandidatePath), { recursive: true });
        fs.writeFileSync(absCandidatePath, execCode, "utf8");

        const runResult = await runSupertest(
          jobId,
          resolvedSnapshotRoot,
          null,
          [absCandidatePath],
          { useLiveDatabase: false, signal: abortSignal },
        ).catch((err) => ({
          exitCode: 1,
          stderr: err?.message || "Execution failed",
          stdout: "",
          coverageDir: null,
        }));

        const parsedJest = runResult?.coverageDir
          ? parseJestResults(runResult.coverageDir, {
              rootDir: resolvedSnapshotRoot,
            })
          : null;
        const scenarios = Array.isArray(parsedJest?.scenarios)
          ? parsedJest.scenarios
          : [];
        const totalTests = scenarios.length;
        const passedTests = scenarios.filter(
          (s) => s.status === "passed",
        ).length;
        const failedScenarios = scenarios.filter((s) => s.status === "failed");
        const failedTests = failedScenarios.length;
        const completeness = evaluateGeneratedCompleteness(
          cleanedCode,
          targetFilePath,
          endpointsToGenerate,
        );
        const coveredCasesCount = completeness.coveredCasesCount;
        const isComplete =
          completeness.missingCases.length === 0 &&
          completeness.unexpectedRequests.length === 0;

        const isBetterCandidate =
          coveredCasesCount > bestCoveredCases ||
          (coveredCasesCount === bestCoveredCases &&
            ((totalTests > 0 && passedTests > bestPassed) ||
              (passedTests === bestPassed && failedTests < bestFailed)));
        if (isBetterCandidate) {
          bestCode = cleanedCode;
          bestCoveredCases = coveredCasesCount;
          bestPassed = passedTests;
          bestFailed = failedTests;
        }

        verificationSummary = {
          passed:
            totalTests > 0 &&
            failedTests === 0 &&
            runResult.exitCode === 0 &&
            isComplete,
          totalTests,
          passedTests,
          failedTests,
          coveredCases: coveredCasesCount,
          totalRequiredCases: completeness.totalRequiredCases,
          attempts: pass,
        };

        if (verificationSummary.passed) {
          await addJobLog(
            jobId,
            "INFO",
            `[Integration AI] Xác minh thành công ${passedTests}/${totalTests} kịch bản pass 100% và bao phủ đủ ${coveredCasesCount}/${completeness.totalRequiredCases} case!`,
          ).catch(() => {});
          break;
        }

        if (pass === maxVerifyPasses) {
          cleanedCode = bestCode;
          break;
        }

        const failureDetails = [];
        let saw500Got400 = false;
        let sawPaymentOrStripeFailure = false;
        let sawNotAConstructor = false;
        let saw400Got404 = false;
        for (const fsItem of failedScenarios.slice(0, 12)) {
          const msg = Array.isArray(fsItem.failureMessages)
            ? fsItem.failureMessages.join("\n")
            : fsItem.errorMessage || "";
          if (/Expected:\s*500[\s\S]*?Received:\s*400/i.test(msg)) {
            saw500Got400 = true;
          }
          if (/is not a constructor/i.test(msg)) {
            sawNotAConstructor = true;
          }
          if (
            /(?:Expected(?: value)?:\s*404[\s\S]*?Received array:\s*\[400|Expected:\s*400[\s\S]*?Received:\s*404)/i.test(
              msg,
            )
          ) {
            saw400Got404 = true;
          }
          if (/payment|checkout-session|stripe/i.test(fsItem.title || "")) {
            sawPaymentOrStripeFailure = true;
          }
          failureDetails.push(
            `FAILED: ${fsItem.title}\n${String(msg).slice(0, 1200)}`,
          );
        }
        const rawStderr = String(runResult?.stderr || "").trim();
        const rawStdout = String(runResult?.stdout || "").trim();
        // Put stderr BEFORE stdout so Jest's verbose --json payload on stdout never pushes controller console.error/TypeError/RangeError off the slice.
        const combinedLogs = [rawStderr, rawStdout].filter(Boolean).join("\n");
        const runtimeErrLines = combinedLogs
          .split(/\r?\n/)
          .filter((line) =>
            /(?:TypeError|RangeError|ReferenceError|SyntaxError|Invalid time value|is not a function|is not a constructor|console\.error|Error:)/i.test(
              line,
            ),
          )
          .slice(0, 25)
          .join("\n");
        if (runtimeErrLines) {
          failureDetails.push(
            `Extracted Runtime Exceptions:\n${runtimeErrLines}`,
          );
        }
        if (saw500Got400) {
          failureDetails.push(
            `DIAGNOSTIC HINT (Expected 500, Received 400): Input validation rejected the request with 400 BEFORE calling the mocked service/DB! In every 500 error test using .mockRejectedValueOnce(...), send a VALID NON-EMPTY payload (e.g. non-empty 'content', valid required fields), NEVER '' or {}.`,
          );
        }
        if (sawNotAConstructor) {
          failureDetails.push(
            `DIAGNOSTIC HINT (Singleton Service — is not a constructor): The imported service module exports a singleton INSTANCE (export default new XxxService()), NOT a class! NEVER write 'new serviceModule.default()'. Instead spy directly on the exported instance: 'jest.spyOn(serviceModule.default, "methodName").mockImplementationOnce(() => { throw new Error("Simulated failure"); })'.`,
          );
        }
        if (saw400Got404) {
          failureDetails.push(
            `DIAGNOSTIC HINT (Expected 400, Received 404 on URL Param): Express strips raw unencoded trailing spaces in URLs like '/checkout-session/   ', causing 404 Not Found! Replace raw spaces with URL-encoded '/%20' (e.g. '/api/sandbox/payments/checkout-session/%20') so req.params receives ' ' and the controller returns 400.`,
          );
        }
        if (
          sawPaymentOrStripeFailure ||
          /Invalid time value|sessions\.list|paymentIntents\.list/i.test(
            combinedLogs,
          )
        ) {
          failureDetails.push(
            `DIAGNOSTIC HINT (Stripe Mock Incomplete): A Stripe-backed route threw (often RangeError on 'new Date(item.created * 1000)' or missing '.list()'). REMOVE custom jest.unstable_mockModule('stripe', ...) so CovAI's complete built-in mock handles all Stripe methods & timestamps, OR add 'created: Math.floor(Date.now() / 1000)' on every session/intent AND implement checkout.sessions.list + paymentIntents.list returning { data: [...] }.`,
          );
        }
        if (failureDetails.length === 0 && combinedLogs) {
          failureDetails.push(combinedLogs.slice(0, 2500));
        } else if (rawStderr) {
          const stderrHead = rawStderr.slice(0, 2500);
          const stderrTail =
            rawStderr.length > 2500 ? rawStderr.slice(-1500) : "";
          failureDetails.push(
            `Jest Stderr (Head):\n${stderrHead}${stderrTail ? `\n...\nJest Stderr Tail:\n${stderrTail}` : ""}`,
          );
        }

        // If a mocked module omitted a required named export, surface that file's exports explicitly for repair
        const combinedErrorText = `${failureDetails.join("\n")}\n${rawStderr}`;
        const exportErrMatch = combinedErrorText.match(
          /The requested module ['"]([^'"]+)['"] does not provide an export named ['"]([^'"]+)['"]/i,
        );
        if (exportErrMatch) {
          const [, missingMod, missingExport] = exportErrMatch;
          const cleanMod = missingMod.replace(/^(?:\.\.?\/)+/, "");
          const modFile = (sourceCode || []).find((f) => {
            const p = String(f.path || f.filePath || "").replace(/\\/g, "/");
            return (
              p === cleanMod ||
              p.endsWith(`/${cleanMod}`) ||
              p.endsWith(cleanMod)
            );
          });
          failureDetails.push(
            `CRITICAL MOCK FIX NEEDED: Your mock for '${missingMod}' MUST also export '${missingExport}' (plus any default/named exports in that file):${modFile?.content ? `\n// ${modFile.path || modFile.filePath}\n${String(modFile.content).slice(0, 1500)}` : ""}`,
          );
        }

        const currentFailureSummary = failureDetails.join("\n---\n");
        if (isBetterCandidate || !bestFailureSummary) {
          bestFailureSummary = currentFailureSummary;
        }
        // Prevent repair regression: if this pass performed worse than bestCode, repair from bestCode instead.
        const repairBaseCode = isBetterCandidate ? cleanedCode : bestCode;
        const repairBaseSummary = isBetterCandidate
          ? currentFailureSummary
          : bestFailureSummary;

        await addJobLog(
          jobId,
          "WARN",
          `[Integration AI] Pass ${passedTests}/${totalTests}, bao phủ ${coveredCasesCount}/${completeness.totalRequiredCases} case. Đang gửi AI tự sửa...`,
        ).catch(() => {});

        const repairPrompt = buildIntegrationRepairPrompt({
          code: repairBaseCode,
          failureSummary: repairBaseSummary,
          framework: normFramework.toLowerCase(),
          endpoints: endpointsToGenerate,
          sourceCode,
          targetFilePath,
          missingCases: completeness.missingCases,
          unexpectedPaths: completeness.unexpectedRequests,
        });
        const repairResponse = await generateText(repairPrompt, model || null, {
          taskType: "integration",
          temperature: 0.15,
          maxOutputTokens: 16384,
          returnTelemetry: true,
        });
        const repairText =
          typeof repairResponse === "object" &&
          repairResponse?.text !== undefined
            ? repairResponse.text
            : repairResponse;
        if (repairText && repairText.trim()) {
          try {
            cleanedCode = parseAndDeduplicateResponse(repairText);
          } catch (repairParseErr) {
            console.warn(
              `[Integration AI] Repair output failed validation on pass ${pass}:`,
              repairParseErr?.message,
            );
          }
        }
      }
    } catch (verifyErr) {
      console.warn(
        "[Integration AI] Verification pass warning:",
        verifyErr?.message,
      );
    } finally {
      try {
        restoreEntries();
      } catch (restoreErr) {
        console.warn(
          "[Integration AI] Express restore warning:",
          restoreErr?.message,
        );
      }
      try {
        if (hadOriginalFile && originalFileContent !== null) {
          fs.writeFileSync(absCandidatePath, originalFileContent, "utf8");
        } else if (!hadOriginalFile && fs.existsSync(absCandidatePath)) {
          fs.unlinkSync(absCandidatePath);
        }
      } catch (cleanupErr) {
        console.warn(
          "[Integration AI] Candidate cleanup warning:",
          cleanupErr?.message,
        );
      }
    }
  }

  // 5. Extract scenarios and save to database
  await updateJobStatus({ jobId, progress: 95 }).catch(() => {});

  const originalTestRequests = extractTestRequests(cleanedCode, targetFilePath);
  const seenGeneratedCaseKeys = new Map();
  const keptRequests = [];
  const prunedRequests = [];
  for (const r of originalTestRequests) {
    const matchedEp = endpointsToGenerate.find((ep) => {
      const epMethod = String(ep.method || "GET").toUpperCase();
      if (String(r.method || "").toUpperCase() !== epMethod) return false;
      const epPath = (ep.fullPath || ep.path || "/").replace(/\/+$/, "") || "/";
      const cleanReq =
        String(r.path || "/")
          .split("?")[0]
          .replace(/\/+$/, "") || "/";
      return new RegExp("^" + epPath.replace(/:[^\/]+/g, "[^/]+") + "$").test(
        cleanReq,
      );
    });
    if (!matchedEp) {
      prunedRequests.push(r);
      continue;
    }
    const epKey = `${String(matchedEp.method || "GET").toUpperCase()} ${matchedEp.fullPath || matchedEp.path || "/"}`;
    const reqCaseSet = new Set(
      getEndpointRequiredCases(matchedEp).map((c) => c.key),
    );
    const caseKey = getScenarioCaseKey({
      title: r.testName,
      expectedStatus: r.expectedStatus,
      expectedStatuses: r.expectedStatuses,
    });
    const usedCases = seenGeneratedCaseKeys.get(epKey) || new Set();
    if (reqCaseSet.has(caseKey) && usedCases.has(caseKey)) {
      prunedRequests.push(r);
      continue;
    }
    if (!reqCaseSet.has(caseKey) && usedCases.size >= reqCaseSet.size) {
      prunedRequests.push(r);
      continue;
    }
    usedCases.add(caseKey);
    seenGeneratedCaseKeys.set(epKey, usedCases);
    keptRequests.push(r);
  }
  if (keptRequests.length > 0 && prunedRequests.length > 0) {
    cleanedCode = pruneScenariosFromCode(
      cleanedCode,
      originalTestRequests,
      prunedRequests,
    );
  }
  const testRequests =
    keptRequests.length > 0 ? keptRequests : originalTestRequests;
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

  const previousIntegrationRows = await prisma.aiTest
    .findMany({
      where: { snapshotId },
      select: { id: true, metaJson: true, filePath: true },
    })
    .catch(() => []);
  const previousIntegrationAiTests = previousIntegrationRows.filter((row) => {
    try {
      const meta = row?.metaJson ? JSON.parse(row.metaJson) : {};
      if (
        meta.framework === "SUPERTEST" ||
        meta.framework === "PLAYWRIGHT_API"
      ) {
        return true;
      }
    } catch (_) {}
    const normPath = String(row?.filePath || "").replace(/\\/g, "/");
    return /(?:^|\/)tests\/(?:integration|api)\//i.test(normPath);
  });
  const previousIntegrationAiTestIds = previousIntegrationAiTests.map(
    (r) => r.id,
  );
  const existingProjectTitles = new Set(
    existingReqs
      .map((r) => String(r.testName || r.title || "").trim())
      .filter(Boolean),
  );
  const staleAiTitles = Array.from(
    new Set(
      previousIntegrationAiTests
        .flatMap((row) => {
          try {
            const meta = row?.metaJson ? JSON.parse(row.metaJson) : {};
            return Array.isArray(meta.requests)
              ? meta.requests.map((r) =>
                  String(r.testName || r.title || "").trim(),
                )
              : [];
          } catch (_) {
            return [];
          }
        })
        .filter((t) => t && !existingProjectTitles.has(t)),
    ),
  );

  if (previousIntegrationAiTestIds.length > 0) {
    await addJobLog(
      jobId,
      "INFO",
      `[Integration AI] Đã xóa ${previousIntegrationAiTestIds.length} bộ test AI sinh trước đó, chỉ giữ lại test có sẵn của project để sinh bộ mới.`,
    ).catch(() => {});
  }

  const plannedId = crypto.randomUUID();
  const createdAiTest = await stageArtifact(
    async (tx) => {
      if (previousIntegrationAiTestIds.length > 0) {
        await tx.aiTest.deleteMany({
          where: { id: { in: previousIntegrationAiTestIds } },
        });
      }
      if (tx.testScenario?.deleteMany) {
        // Delete stale TestScenarios from older runs targeting this regenerated file (or previous AI titles)
        // so historical runs never leave behind ghost "Duplicate" / "Not run" scenarios in the UI.
        const normTargetFile = String(targetFilePath || "")
          .replace(/\\/g, "/")
          .replace(/^\/+/, "");
        const deleteConditions = [];
        if (staleAiTitles.length > 0) {
          deleteConditions.push({ title: { in: staleAiTitles } });
        }
        if (normTargetFile) {
          deleteConditions.push({
            testFile: { endsWith: normTargetFile },
            ...(existingProjectTitles.size > 0
              ? { title: { notIn: Array.from(existingProjectTitles) } }
              : {}),
          });
        }
        if (deleteConditions.length > 0) {
          await tx.testScenario
            .deleteMany({
              where: {
                OR: deleteConditions,
                testRun: { snapshotId, type: "SUPERTEST" },
              },
            })
            .catch(() => {});
        }
      }
      // Clear stale staged deletions targeting the newly generated test file so fresh scenarios are never hidden/skipped.
      if (tx.projectStructureAnalysis?.findUnique) {
        const analysisRow = await tx.projectStructureAnalysis
          .findUnique({
            where: { snapshotId },
            select: { resultJson: true },
          })
          .catch(() => null);
        if (analysisRow?.resultJson) {
          try {
            const parsedAnalysis =
              typeof analysisRow.resultJson === "string"
                ? JSON.parse(analysisRow.resultJson)
                : analysisRow.resultJson;
            if (
              Array.isArray(parsedAnalysis?.deletedIntegrationScenarios) &&
              parsedAnalysis.deletedIntegrationScenarios.length > 0
            ) {
              const normTargetFile = String(targetFilePath || "")
                .replace(/\\/g, "/")
                .replace(/^\/+/, "")
                .toLowerCase();
              const remainingDeletes =
                parsedAnalysis.deletedIntegrationScenarios.filter((d) => {
                  const dFile = String(d?.filePath || "")
                    .replace(/\\/g, "/")
                    .replace(/^\/+/, "")
                    .toLowerCase();
                  return (
                    dFile &&
                    normTargetFile &&
                    dFile !== normTargetFile &&
                    !dFile.endsWith(normTargetFile) &&
                    !normTargetFile.endsWith(dFile)
                  );
                });
              if (
                remainingDeletes.length !==
                parsedAnalysis.deletedIntegrationScenarios.length
              ) {
                parsedAnalysis.deletedIntegrationScenarios = remainingDeletes;
                await tx.projectStructureAnalysis.update({
                  where: { snapshotId },
                  data: { resultJson: JSON.stringify(parsedAnalysis) },
                });
              }
            }
          } catch (_) {}
        }
      }
      return tx.aiTest.create({
        data: {
          id: plannedId,
          projectId,
          snapshotId,
          filePath: targetFilePath,
          mode: "FULL",
          content: cleanedCode,
          metaJson: JSON.stringify({
            framework: normFramework,
            status: verificationSummary?.passed ? "VERIFIED" : "DRAFT",
            isValid: true,
            requests: requestsMeta,
            telemetry,
            ...(verificationSummary
              ? { verification: verificationSummary }
              : {}),
          }),
        },
      });
    },
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
  // Integration Test generation targets Jest + Supertest exclusively (Playwright remains reserved for System/E2E tests)
  void framework;
  const normFramework = "SUPERTEST";

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
  let rootDir = resolveExistingRootDir(snapshot, project);
  if (
    rootDir &&
    /^\/?app\/(?:storage|uploads)\//i.test(
      String(rootDir).replace(/\\/g, "/"),
    ) &&
    !fs.existsSync(rootDir)
  ) {
    rootDir = resolveProjectRoot(rootDir) || rootDir;
  }

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
    message: `Successfully applied ${appliedFiles.length} test file(s) into project source code.`,
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
