import { resolveProjectAccess } from './projectAccess.service.js';
import { currentProjectOperation, operationSnapshot, stagePreparedValue, stagePreparedPublication, deferPreparedCommit } from './projectOperationWorkspace.service.js';
import { withPreparedProjectWorkspace } from './projectWorkspacePreparation.service.js';
import { scenarioArtifactVersion, assertScenarioVersion, updateScenarioService, getScenarioService, regenerateScenarioService } from './scenarioManager.service.js';
import { createSnapshotJob } from './job.service.js';
const invalidateAfterCommit = snapshotId => currentProjectOperation() ? deferPreparedCommit(()=>invalidateEndpointCache(snapshotId)) : invalidateEndpointCache(snapshotId);
const stageArtifact = async (run, placeholder) => stagePreparedValue(async tx => {
    const value = await run(tx);
    const operation = currentProjectOperation();
    if (operation && !operation.publicationMetadata?.changedPaths?.length) await tx.project.update({where:{id:operation.projectId},data:{workspaceRevision:{increment:1}}});
    return value;
},placeholder);
const guardedWorkspace = async (args,capability,run) => {
    const {snapshot,project} = args.snapshotId ? await verifySnapshotOwnership(args.snapshotId,args.userId) : await (async()=>{const project=await verifyProjectOwnership(args.projectId,args.userId);return {project,snapshot:project.snapshots?.[0]};})();
    if (!snapshot) throw new ServiceError('Snapshot not found',404);
    await resolveProjectAccess({projectId:project.id,userId:args.userId,capability});
    if (currentProjectOperation()) return run({...args,snapshotId:snapshot.id});
    return withPreparedProjectWorkspace({projectId:project.id,snapshotId:snapshot.id,userId:args.userId,capability,expectedWorkspaceRevision:project.workspaceRevision,type:'INTEGRATION_WRITE'},()=>run({...args,snapshotId:snapshot.id}));
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
    await resolveProjectAccess({projectId:snapshot.projectId,userId,capability:'project.read'});
    return { snapshot:operationSnapshot(snapshot), project: snapshot.project };
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
    await resolveProjectAccess({projectId:projectId,userId,capability:'project.read'});
    return {...project,snapshots:(project.snapshots || []).map(operationSnapshot)};
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
const installIntegrationDependenciesInWorkspace = async ({ snapshotId, projectId, userId, packages, framework }) => {
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
    const result = await installIntegrationDependencies({rootDir,packages,framework});
    if (!result.success) throw new ServiceError("Dependency installation failed",500);
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
    model, requestId,
}) => {
    const { snapshot, project } = await verifySnapshotOwnership(snapshotId, userId);
    await resolveProjectAccess({projectId:snapshot.projectId,userId,capability:'ai.use'});
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

    const payload = {mode:'INTEGRATION_GENERATION',framework:normFramework,targetEndpoints,force,model};
    const job = await createSnapshotJob({projectId:snapshot.projectId,snapshotId,userId,type:'AI_TESTS',payloadJson:payload,requestId});
    if (!job.reused) await addJobToQueue('AI_TESTS',job.id,payload);

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

    const aiResponseText = await generateText(prompt, model || process.env.GEMINI_MODEL || "gemini-2.5-flash");
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

    const plannedId = crypto.randomUUID();
    const createdAiTest = await stageArtifact(tx => tx.aiTest.create({
        data: {
            id:plannedId,
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
    }),{id:plannedId});

    invalidateAfterCommit(snapshotId);

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
    expectedVersion, model, requestId,
}) => {
    const { snapshot } = await verifySnapshotOwnership(snapshotId, userId);
    await resolveProjectAccess({projectId:snapshot.projectId,userId,capability:'ai.use'});
    if (!scenarioId) {
        throw new ServiceError("scenarioId is required", 400);
    }

    const decodedScenarioId = decodeURIComponent(scenarioId);
    const normFramework = normalizeFramework(framework);

    const tests = await prisma.aiTest.findMany({where:{snapshotId}});
    const artifact = tests.find(test => {try {return (JSON.parse(test.metaJson || '{}').requests || []).some(r=>r.scenarioId===decodedScenarioId || r.testName===decodedScenarioId);}catch{return false;}});
    if (!artifact) throw new ServiceError('Editable scenario not found',404);
    assertScenarioVersion(artifact,expectedVersion);
    const payload = {mode:'INTEGRATION_REGENERATE',scenarioId:decodedScenarioId,framework:normFramework,failureContext,expectedVersion,model};
    const job = await createSnapshotJob({projectId:snapshot.projectId,snapshotId,userId,type:'AI_TESTS',payloadJson:payload,requestId});
    if (!job.reused) await addJobToQueue('AI_TESTS',job.id,payload);

    return {
        job,
        message: "Scenario regeneration job queued successfully.",
    };
};

/**
 * Task 4.3: Pipeline execution for regenerating a single scenario
 */
export const runRegenerateScenarioPipeline = async ({jobId,snapshotId,scenarioId,expectedVersion,model,failureContext}) => {
    const context = currentProjectOperation();
    if (!context || context.snapshotId !== snapshotId || context.jobId !== jobId) throw new ServiceError('Guarded regeneration context required',409);
    await updateJobStatus({jobId,progress:20,status:'RUNNING'});
    const tests = await prisma.aiTest.findMany({where:{snapshotId}});
    const artifact = tests.find(test => {try{return (JSON.parse(test.metaJson || '{}').requests || []).some(r=>r.scenarioId===scenarioId || r.testName===scenarioId);}catch{return false;}});
    if (!artifact) throw new ServiceError('Editable scenario not found',404);
    await regenerateScenarioService(artifact.id,scenarioId,{model,failureContext},{userId:context.userId,snapshotId,expectedVersion});
    await updateJobStatus({jobId,progress:100,status:'SUCCESS'});
    return {scenarioId,regenerated:true};
};

/**
 * Task 4.4: Update an integration scenario by scenarioId
 */
export const updateIntegrationScenarioService = async ({snapshotId,scenarioId,userId,updates={}}) => {
    await verifySnapshotOwnership(snapshotId,userId);
    const tests = await prisma.aiTest.findMany({where:{snapshotId}});
    const decoded = decodeURIComponent(scenarioId);
    const test = tests.find(test => {try{return (JSON.parse(test.metaJson || '{}').requests || []).some(r=>r.scenarioId===decoded || r.testName===decoded);}catch{return false;}});
    if (!test) throw new ServiceError('Editable scenario not found in snapshot',404);
    const options = {userId,snapshotId,expectedVersion:updates.expectedVersion,updates};
    const code = updates.code || (await getScenarioService(test.id,decoded,options)).code;
    const updated = await updateScenarioService(test.id,decoded,code,options);
    return {success:true,updated:true,scenarioId:decoded,aiTest:updated};
};

/**
 * Task 4.4: Apply approved/selected integration tests directly into project source code
 */
const applyIntegrationTestsInWorkspace = async ({
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

        await stagePreparedPublication(tx => tx.aiTest.update({
            where: { id: test.id },
            data: {
                filePath: relPath,
                content: finalContent,
                metaJson: JSON.stringify(meta),
            },
        }));

        appliedFiles.push(relPath);
        totalScenarios += Array.isArray(meta.requests) ? meta.requests.length : 1;
    }

    await stagePreparedPublication(async tx => {
        const operation = currentProjectOperation();
        if (operation && !operation.publicationMetadata?.changedPaths?.length) await tx.project.update({where:{id:operation.projectId},data:{workspaceRevision:{increment:1}}});
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

export const installIntegrationDependenciesService = args => guardedWorkspace(args,'integrations.write',installIntegrationDependenciesInWorkspace);
export const applyIntegrationTestsService = args => guardedWorkspace(args,'files.write',applyIntegrationTestsInWorkspace);
