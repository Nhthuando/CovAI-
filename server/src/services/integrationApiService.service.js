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
import { invalidateEndpointCache } from "./integrationWorkspace.service.js";
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
    if (snapshot.project?.ownerId && snapshot.project.ownerId !== userId) {
        throw new ServiceError("Forbidden: You do not have access to this project", 403);
    }
    return { snapshot, project: snapshot.project };
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
    if (project.ownerId && project.ownerId !== userId) {
        throw new ServiceError("Forbidden: You do not have access to this project", 403);
    }
    return project;
};

/**
 * Task 4.2: Detect integration test frameworks & dependencies
 */
export const detectIntegrationFrameworksService = async ({ snapshotId, projectId, userId }) => {
    let rootDir = null;
    if (snapshotId) {
        const { snapshot, project } = await verifySnapshotOwnership(snapshotId, userId);
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
export const installIntegrationDependenciesService = async ({ snapshotId, projectId, userId, packages, framework }) => {
    let rootDir = null;
    if (snapshotId) {
        const { snapshot, project } = await verifySnapshotOwnership(snapshotId, userId);
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
    const result = await installIntegrationDependencies(rootDir, target);
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
}) => {
    const { snapshot, project } = await verifySnapshotOwnership(snapshotId, userId);
    const normFramework = normalizeFramework(framework);

    // Pre-flight dirty check (F-03): Check if user edited scenarios exist on targeted endpoints
    if (!force) {
        const existingAiTests = await prisma.aiTest.findMany({
            where: { snapshotId },
        });
        const targetSet = Array.isArray(targetEndpoints) && targetEndpoints.length > 0
            ? new Set(targetEndpoints.map((t) => (typeof t === "string" ? t.trim().toUpperCase() : `${t.method} ${t.path}`.trim().toUpperCase())))
            : null;

        for (const test of existingAiTests) {
            if (!test.metaJson) continue;
            try {
                const meta = typeof test.metaJson === "string" ? JSON.parse(test.metaJson) : test.metaJson;
                if (meta.framework !== normFramework) continue;

                if (targetSet) {
                    const matchedReqs = (meta.requests || []).filter((r) => targetSet.has(`${r.method} ${r.path}`.toUpperCase()));
                    if (matchedReqs.some((r) => r.userEdited || r.enabled === false)) {
                        throw new ServiceError("Cannot overwrite user-edited integration scenarios. Pass force=true to override.", 409);
                    }
                } else if (meta.userModified || (meta.requests || []).some((r) => r.userEdited || r.enabled === false)) {
                    throw new ServiceError("Cannot overwrite user-edited integration scenarios. Pass force=true to override.", 409);
                }
            } catch (err) {
                if (err.statusCode === 409) throw err;
            }
        }
    }

    const job = await prisma.job.create({
        data: {
            userId,
            projectId: snapshot.projectId,
            snapshotId,
            type: "AI_TESTS",
            status: "QUEUED",
            payloadJson: JSON.stringify({
                mode: "INTEGRATION_GENERATION",
                framework: normFramework,
                targetEndpoints,
                force,
            }),
        },
    });

    addJobToQueue("AI_TESTS", job.id, {
        mode: "INTEGRATION_GENERATION",
        framework: normFramework,
        targetEndpoints,
        force,
    }).catch((err) => {
        console.error(`[queueIntegrationTestGeneration] Failed to queue job ${job.id}:`, err.message);
    });

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
}) => {
    const normFramework = normalizeFramework(framework);
    await updateJobStatus({ jobId, progress: 10, status: "RUNNING" }).catch(() => {});
    await addJobLog(jobId, "INFO", `[Integration AI] Khởi động sinh test cho framework: ${normFramework}`).catch(() => {});

    // 1. Load source code & extract valid endpoints
    await updateJobStatus({ jobId, progress: 25 }).catch(() => {});
    await addJobLog(jobId, "INFO", "[Integration AI] Đang quét mã nguồn Router và Controller...").catch(() => {});
    const sourceCode = await loadSourceCode(snapshotId).catch(() => []);
    const allEndpoints = extractValidEndpoints(sourceCode);

    let endpointsToGenerate = allEndpoints;
    if (Array.isArray(targetEndpoints) && targetEndpoints.length > 0) {
        const targetSet = new Set(
            targetEndpoints.map((t) => (typeof t === "string" ? t.trim().toUpperCase() : `${t.method} ${t.path}`.trim().toUpperCase()))
        );
        endpointsToGenerate = allEndpoints.filter((ep) =>
            targetSet.has(`${ep.method.toUpperCase()} ${ep.fullPath || ep.path}`.toUpperCase()) ||
            targetSet.has(`${ep.method.toUpperCase()} ${ep.path}`.toUpperCase())
        );
        if (endpointsToGenerate.length === 0) {
            endpointsToGenerate = targetEndpoints.map((t) => {
                const parts = typeof t === "string" ? t.trim().split(/\s+/) : [t.method || "GET", t.path || "/api"];
                const method = parts.length > 1 ? parts[0].toUpperCase() : "GET";
                const routePath = parts.length > 1 ? parts[1] : parts[0];
                return { method, path: routePath, fullPath: routePath };
            });
        }
    } else if (endpointsToGenerate.length === 0) {
        endpointsToGenerate = [{ method: "GET", path: "/api", fullPath: "/api" }];
    }

    // 2. Build multi-scenario prompt
    await updateJobStatus({ jobId, progress: 50 }).catch(() => {});
    await addJobLog(jobId, "INFO", `[Integration AI] Thu thập AST context & sinh prompt cho ${endpointsToGenerate.length} API endpoint...`).catch(() => {});

    const prompt = buildIntegrationTestPrompt({
        endpoints: endpointsToGenerate,
        sourceCode,
        framework: normFramework.toLowerCase(),
    });

    // 3. Call LLM
    await updateJobStatus({ jobId, progress: 70 }).catch(() => {});
    await addJobLog(jobId, "INFO", "[Integration AI] Đang gửi yêu cầu tới mô hình AI LLM...").catch(() => {});

    const aiResponseText = await generateText(prompt, process.env.GEMINI_MODEL || "gemini-3.8-flash");
    if (!aiResponseText || !aiResponseText.trim()) {
        throw new ServiceError("Mô hình AI trả về phản hồi rỗng", 500);
    }

    // 4. Extract and validate generated code
    await updateJobStatus({ jobId, progress: 85 }).catch(() => {});
    await addJobLog(jobId, "INFO", "[Integration AI] Kiểm duyệt an toàn cú pháp Babel AST...").catch(() => {});

    let cleanedCode = aiResponseText.trim();
    const codeMatch = cleanedCode.match(/```(?:javascript|js|typescript|ts)?\s*([\s\S]*?)```/);
    if (codeMatch && codeMatch[1]) {
        cleanedCode = codeMatch[1].trim();
    }

    validateIntegrationTestCode(cleanedCode, normFramework.toLowerCase());

    // 5. Extract scenarios and save to database
    await updateJobStatus({ jobId, progress: 95 }).catch(() => {});
    const targetFilePath = normFramework === "PLAYWRIGHT_API"
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
        expectedStatus: r.expectedStatus || 200,
        createdAt: new Date().toISOString(),
    }));

    const createdAiTest = await prisma.aiTest.create({
        data: {
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
            }),
        },
    });

    invalidateEndpointCache(snapshotId);

    await updateJobStatus({ jobId, progress: 100, status: "SUCCESS" }).catch(() => {});
    await addJobLog(jobId, "INFO", `[Integration AI] Hoàn tất! Đã sinh và lưu ${requestsMeta.length} kịch bản test vào Workspace.`).catch(() => {});

    return {
        aiTestId: createdAiTest.id,
        filePath: targetFilePath,
        scenariosCount: requestsMeta.length,
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
}) => {
    const { snapshot } = await verifySnapshotOwnership(snapshotId, userId);
    if (!scenarioId) {
        throw new ServiceError("scenarioId is required", 400);
    }

    const decodedScenarioId = decodeURIComponent(scenarioId);
    const normFramework = normalizeFramework(framework);

    const job = await prisma.job.create({
        data: {
            userId,
            projectId: snapshot.projectId,
            snapshotId,
            type: "AI_TESTS",
            status: "QUEUED",
            payloadJson: JSON.stringify({
                mode: "INTEGRATION_REGENERATE",
                scenarioId: decodedScenarioId,
                framework: normFramework,
                failureContext,
            }),
        },
    });

    addJobToQueue("AI_TESTS", job.id, {
        mode: "INTEGRATION_REGENERATE",
        scenarioId: decodedScenarioId,
        framework: normFramework,
        failureContext,
    }).catch((err) => {
        console.error(`[queueRegenerateScenario] Failed to queue job ${job.id}:`, err.message);
    });

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
    framework = "SUPERTEST",
    failureContext = null,
}) => {
    await updateJobStatus({ jobId, progress: 20, status: "RUNNING" }).catch(() => {});
    await addJobLog(jobId, "INFO", `[Regenerate] Tái sinh kịch bản test '${scenarioId}'...`).catch(() => {});

    // Find AI test record containing this scenario
    const aiTests = await prisma.aiTest.findMany({ where: { snapshotId } });
    let matchedTest = null;
    let matchedReq = null;

    for (const test of aiTests) {
        if (!test.metaJson) continue;
        try {
            const meta = typeof test.metaJson === "string" ? JSON.parse(test.metaJson) : test.metaJson;
            const req = (meta.requests || []).find(
                (r) => r.scenarioId === scenarioId || r.id === scenarioId || r.testName === scenarioId
            );
            if (req) {
                matchedTest = test;
                matchedReq = req;
                break;
            }
        } catch (_) {}
    }

    const sourceCode = await loadSourceCode(snapshotId).catch(() => []);
    const allEndpoints = extractValidEndpoints(sourceCode);
    const matchedEp = matchedReq
        ? allEndpoints.find((e) => e.method === matchedReq.method && (e.path === matchedReq.path || e.fullPath === matchedReq.path))
        : allEndpoints[0];

    await updateJobStatus({ jobId, progress: 50 }).catch(() => {});

    let prompt = "";
    if (failureContext && failureContext.failureMessages) {
        prompt = buildFaultyTestFixPrompt({
            testFileContent: matchedTest?.content || "",
            testFilePath: matchedTest?.filePath || "test.js",
            failureReport: failureContext,
            endpoint: matchedEp || {},
            sourceCode,
            framework: framework.toLowerCase(),
        });
    } else {
        prompt = buildIntegrationTestPrompt({
            endpoints: matchedEp ? [matchedEp] : allEndpoints.slice(0, 1),
            sourceCode,
            framework: framework.toLowerCase(),
        });
    }

    await updateJobStatus({ jobId, progress: 75 }).catch(() => {});
    const aiResponseText = await generateText(prompt, process.env.GEMINI_MODEL || "gemini-3.8-flash");

    let cleanedCode = aiResponseText.trim();
    const codeMatch = cleanedCode.match(/```(?:javascript|js|typescript|ts)?\s*([\s\S]*?)```/);
    if (codeMatch && codeMatch[1]) {
        cleanedCode = codeMatch[1].trim();
    }

    validateIntegrationTestCode(cleanedCode, framework.toLowerCase());

    if (matchedTest) {
        await prisma.aiTest.update({
            where: { id: matchedTest.id },
            data: { content: cleanedCode },
        });
    }

    invalidateEndpointCache(snapshotId);

    await updateJobStatus({ jobId, progress: 100, status: "SUCCESS" }).catch(() => {});
    await addJobLog(jobId, "INFO", `[Regenerate] Hoàn tất tái sinh kịch bản '${scenarioId}'.`).catch(() => {});

    return {
        scenarioId,
        regenerated: true,
    };
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
    if (!scenarioId) {
        throw new ServiceError("scenarioId is required", 400);
    }

    const decodedScenarioId = decodeURIComponent(scenarioId);
    const aiTests = await prisma.aiTest.findMany({ where: { snapshotId } });

    let updatedAiTest = null;
    let found = false;

    for (const test of aiTests) {
        if (!test.metaJson) continue;
        try {
            const meta = typeof test.metaJson === "string" ? JSON.parse(test.metaJson) : test.metaJson;
            const reqIndex = (meta.requests || []).findIndex(
                (r) => r.scenarioId === decodedScenarioId || r.id === decodedScenarioId || r.testName === decodedScenarioId
            );

            if (reqIndex !== -1) {
                found = true;
                const req = meta.requests[reqIndex];

                if (updates.title !== undefined) req.testName = updates.title;
                if (updates.expectedStatus !== undefined) req.expectedStatus = Number(updates.expectedStatus);
                if (updates.payload !== undefined) req.payload = updates.payload;
                if (updates.enabled !== undefined) req.enabled = Boolean(updates.enabled);
                req.userEdited = true;
                req.lastModifiedAt = new Date().toISOString();

                let newContent = test.content;
                if (updates.code) {
                    validateIntegrationTestCode(updates.code, meta.framework ? meta.framework.toLowerCase() : "supertest");
                    newContent = updates.code;
                }

                meta.userModified = true;
                meta.requests[reqIndex] = req;

                updatedAiTest = await prisma.aiTest.update({
                    where: { id: test.id },
                    data: {
                        content: newContent,
                        metaJson: JSON.stringify(meta),
                    },
                });
                break;
            }
        } catch (err) {
            if (err.statusCode) throw err;
        }
    }

    if (!found) {
        // Also check TestScenario table if it exists
        const testScenario = await prisma.testScenario.findFirst({
            where: {
                id: decodedScenarioId,
                testRun: { snapshotId },
            },
        });
        if (testScenario) {
            await prisma.testScenario.update({
                where: { id: testScenario.id },
                data: {
                    ...(updates.title ? { title: updates.title } : {}),
                    ...(updates.expectedStatus ? { responseStatus: Number(updates.expectedStatus) } : {}),
                    ...(updates.payload ? { responseData: updates.payload } : {}),
                },
            });
            found = true;
        }
    }

    if (!found) {
        throw new ServiceError(`Scenario '${decodedScenarioId}' not found in snapshot`, 404);
    }

    invalidateEndpointCache(snapshotId);

    return {
        success: true,
        scenarioId: decodedScenarioId,
        updated: true,
        aiTest: updatedAiTest,
    };
};

/**
 * Task 4.4: Apply approved/selected integration tests directly into project source code
 */
export const applyIntegrationTestsService = async ({
    snapshotId,
    userId,
    testIds = [],
    targetFilePath = null,
    fileName = null,
}) => {
    const { snapshot, project } = await verifySnapshotOwnership(snapshotId, userId);
    const rootDir = snapshot.rootDir || snapshot.storagePath || project.rootDir;

    if (!rootDir || !fs.existsSync(rootDir)) {
        throw new ServiceError("Project source directory does not exist on disk", 404);
    }

    let testsToApply = [];
    if (Array.isArray(testIds) && testIds.length > 0) {
        testsToApply = await prisma.aiTest.findMany({
            where: {
                snapshotId,
                id: { in: testIds },
            },
        });
    } else {
        const allTests = await prisma.aiTest.findMany({
            where: { snapshotId },
        });
        testsToApply = allTests.filter((t) => {
            if (!t.metaJson) return false;
            try {
                const meta = typeof t.metaJson === "string" ? JSON.parse(t.metaJson) : t.metaJson;
                return meta.framework === "SUPERTEST" || meta.framework === "PLAYWRIGHT_API";
            } catch {
                return false;
            }
        });
    }

    if (testsToApply.length === 0) {
        throw new ServiceError("No integration tests found to apply to source code", 404);
    }

    const appliedFiles = [];
    let totalScenarios = 0;

    for (const test of testsToApply) {
        const meta = test.metaJson ? (typeof test.metaJson === "string" ? JSON.parse(test.metaJson) : test.metaJson) : {};
        const framework = (meta.framework || "SUPERTEST").toLowerCase();

        // 1. Validate test code safety
        validateIntegrationTestCode(test.content, framework);

        // 2. Resolve target file path securely (no path traversal allowed)
        let relPath = test.filePath;
        if (targetFilePath) {
            relPath = targetFilePath;
        } else if (fileName) {
            const ext = fileName.endsWith(".js") || fileName.endsWith(".ts") ? "" : ".test.js";
            relPath = path.join("tests", "integration", `${fileName}${ext}`).replace(/\\/g, "/");
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
        let finalContent = test.content;
        try {
            finalContent = resolveAppImportPath(test.content, rootDir, fullDestPath);
        } catch (err) {
            console.warn(`[applyIntegrationTests] Notice resolving app entry import: ${err.message}`);
        }

        // 4. Write to disk
        fs.writeFileSync(fullDestPath, finalContent, "utf8");

        // 5. Update aiTest record with applied status
        meta.status = "APPLIED";
        meta.appliedAt = new Date().toISOString();

        await prisma.aiTest.update({
            where: { id: test.id },
            data: {
                filePath: relPath,
                content: finalContent,
                metaJson: JSON.stringify(meta),
            },
        });

        appliedFiles.push(relPath);
        totalScenarios += Array.isArray(meta.requests) ? meta.requests.length : 1;
    }

    invalidateEndpointCache(snapshotId, rootDir);

    return {
        success: true,
        message: `Đã áp dụng thành công ${appliedFiles.length} file test vào mã nguồn dự án.`,
        appliedFiles,
        totalScenarios,
        suggestRerun: true, // Prompts user to rerun coverage analysis to confirm 100% coverage
    };
};
