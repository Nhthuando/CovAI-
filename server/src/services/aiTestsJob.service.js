import fs from "fs";
import path from "path";
import prisma from "../config/prisma.js";
import { ServiceError } from "../utils/serviceError.js";
import { getJobById, addJobLog } from "./job.service.js";
import { updateJobStatus } from "./jobUpdate.service.js";
import { buildAiPayload } from "./aiContextBuilder.service.js";
import { buildFinalPrompt, buildPlaywrightPrompt } from "./aiPromptBuilder.service.js";
import { buildCypressPrompt } from "./cypressPromptBuilder.service.js";
import { buildSupertestPrompt } from "./supertestPromptBuilder.service.js";
import { generateText } from "./gemini.service.js";
import { processAiSuggestions } from "./aiSuggestionParser.service.js";
import { processSkeletonTests } from "./skeletonPostProcessor.service.js";
import { processFullTests } from "./fullTestsPostProcessor.service.js";
import { processCypressTests } from "./cypressPostProcessor.service.js";
import { processSupertestTests } from "./supertestPostProcessor.service.js";
import { notificationService } from "./notification.service.js";
import { saveAiTestsToFilesystem, removeAiTestsFromFilesystem } from "./aiTestStorage.service.js";
import crypto from "crypto";
import { validateGeneratedTestCode } from "../validators/aiTestCode.validator.js";
import { formatSystemTestFailure } from "../utils/systemTestFailure.js";
import { dockerRunner } from "./dockerRunner.service.js";
import { ensurePlaywrightPrerequisites, resolvePlaywrightCommand, runSystemTests } from "./systemTestRunner.service.js";
import { validateFullSystemTest } from "./systemTestEvidence.service.js";
import { generateVerifiedSystemTests } from './verifiedSystemGeneration.service.js';
import {
    resolveAvailableAutPort,
    prepareAutEnvironment,
    startAutServer,
    stopAutServer,
} from "./autLifecycle.service.js";

const broadcastAiJobProgress = (jobId, { progress, stage, message, status = "RUNNING", userId = null }) => {
    try {
        if (global.io) {
            const payload = {
                jobId,
                progress,
                stage: stage || message,
                message,
                status,
                updatedAt: new Date().toISOString(),
            };
            if (userId) {
                global.io.to(`user:${userId}`).emit("job:progress", payload);
            }
        }
    } catch (err) {
        console.warn(`[broadcastAiJobProgress] Error for job ${jobId}:`, err.message);
    }
};

/**
 * Orchestrates the full Skeleton Test Generation Pipeline
 */
export const processAiTestsJob = async (jobId) => {
    try {
        const job = await getJobById(jobId);

        await updateJobStatus({
            jobId,
            status: "RUNNING",
            progress: 5,
        });

        const { snapshotId, projectId } = job;

        const project = await prisma.project.findUnique({
            where: { id: projectId },
            select: { hasJest: true, hasVitest: true }
        });
        const hasJest = project ? project.hasJest : false;
        const hasVitest = project ? project.hasVitest : false;

        const payloadJsonObj = JSON.parse(job.payloadJson || "{}");
        const mode = payloadJsonObj.mode || "SKELETON";
        const executionMode = payloadJsonObj.executionMode || "frontend";

        if ((mode === 'PLAYWRIGHT_E2E' || mode === 'PLAYWRIGHT') && payloadJsonObj.executionMode === 'full') {
            const rootDir=job.snapshot?.rootDir || (await prisma.projectSnapshot.findUnique({where:{id:snapshotId},select:{rootDir:true}}))?.rootDir;
            const result=await generateVerifiedSystemTests({rootDir,jobId,onProgress:async(progress,message)=>{
                await updateJobStatus({jobId,progress});
                await addJobLog(jobId,'INFO',message);
                broadcastAiJobProgress(jobId,{progress,stage:message,message,userId:job.userId});
            }});
            const filePath='tests/system/ai-generated.spec.js';
            if(!result.failed) {
                const target=path.join(rootDir,filePath);
                fs.mkdirSync(path.dirname(target),{recursive:true});
                fs.writeFileSync(target,result.code,'utf8');
            }
            // Keep previous verified generations; a failed candidate must not erase them.
            await prisma.aiTest.create({data:{
                projectId,snapshotId,mode:'PLAYWRIGHT_E2E',status:result.failed?'FAILED':'VERIFIED',filePath,content:result.code,
                metaJson:JSON.stringify({framework:'PLAYWRIGHT',executionMode:'full',dryRun:result.failed?'FAILED':'PASSED',attempts:result.attempts,verificationRuns:result.verificationRuns,contextHash:result.contextHash,scenarioCount:result.scenarioCount,contextComplete:result.contextComplete,omittedFiles:result.omittedFiles,error:result.error,verifiedAt:result.failed?undefined:new Date().toISOString()}),
            }});
            await updateJobStatus({jobId,status:result.failed?'FAILED':'SUCCESS',progress:100,...(result.failed?{errorMessage:result.error}:{})});
            await notificationService.createJobFinishedNotification(jobId);
            return {success:!result.failed,dryRunPassed:!result.failed,filePath,error:result.error};
        }

        // SCRUM-393: Send AI context
        await addJobLog(jobId, "INFO", `Building AI Context Payload for ${mode} Tests...`);
        const aiPayloadResult = await buildAiPayload(snapshotId);
        const payload = aiPayloadResult.payload;

        await updateJobStatus({ jobId, progress: 30 });

        await addJobLog(jobId, "INFO", `Constructing final prompt for ${mode} mode...`);

        // ── Playwright E2E Generation & Dry-Run Branch (Phase 5) ─────────────
        if (mode === "PLAYWRIGHT_E2E" || mode === "PLAYWRIGHT") {
            const playwrightPrompt = buildPlaywrightPrompt(payload, {executionMode});

            await updateJobStatus({ jobId, progress: 40 });
            await addJobLog(jobId, "INFO", "Calling Gemini AI model to generate Playwright E2E tests...");
            broadcastAiJobProgress(jobId, {
                progress: 40,
                stage: "Generating Playwright E2E tests with AI...",
                message: "Calling Gemini AI model to generate Playwright E2E tests...",
                userId: job.userId,
            });

            const aiResponseText = await generateText(playwrightPrompt);
            if (!aiResponseText || !aiResponseText.trim()) {
                throw new ServiceError("Gemini returned an empty response for Playwright test generation.", 500);
            }

            await updateJobStatus({ jobId, progress: 65 });
            await addJobLog(jobId, "INFO", "Validating generated Playwright test syntax and safety via Babel AST...");
            broadcastAiJobProgress(jobId, {
                progress: 65,
                stage: "Validating AST syntax & safety...",
                message: "Validating generated Playwright test syntax and safety via Babel AST...",
                userId: job.userId,
            });

            // Parse response: extract code from JSON or markdown block
            let generatedCode = "";
            let targetFilePath = executionMode === "full" ? "tests/system/ai-generated.spec.js" : "tests/e2e/ai-generated.spec.js";

            try {
                const cleaned = aiResponseText.replace(/^```json\s*/i, "").replace(/```\s*$/i, "").trim();
                const parsed = JSON.parse(cleaned);
                if (Array.isArray(parsed.tests) && parsed.tests.length > 0) {
                    generatedCode = parsed.tests[0].content || "";
                } else if (parsed.content) {
                    generatedCode = parsed.content;
                }
            } catch {
                const codeMatch = aiResponseText.match(/```(?:javascript|js|typescript|ts)?\s*([\s\S]*?)```/i);
                if (codeMatch && codeMatch[1]) {
                    generatedCode = codeMatch[1].trim();
                } else {
                    generatedCode = aiResponseText.trim();
                }
            }

            if (!generatedCode) {
                throw new ServiceError("Failed to extract valid test code from Gemini response.", 422);
            }

            // 1. AST Syntax & Security Validation
            try {
                validateGeneratedTestCode(generatedCode);
                if (executionMode === "full") validateFullSystemTest(generatedCode);
                await addJobLog(jobId, "INFO", "AST Validation passed: Syntax is valid and no forbidden APIs detected.");
            } catch (astError) {
                await addJobLog(jobId, "WARN", `AST Validation failed: ${astError.message}`);

                await prisma.aiTest.deleteMany({
                    where: { snapshotId, mode: "PLAYWRIGHT_E2E" }
                });
                await prisma.aiTest.create({
                    data: {
                        projectId,
                        snapshotId,
                        mode: "PLAYWRIGHT_E2E",
                        status: "FAILED",
                        filePath: targetFilePath,
                        content: generatedCode,
                        metaJson: JSON.stringify({
                            framework: "PLAYWRIGHT",
                            executionMode,
                            dryRun: "FAILED",
                            error: `Syntax/Security check failed: ${astError.message}`,
                        }),
                    },
                });

                await updateJobStatus({
                    jobId,
                    status: "FAILED",
                    errorMessage: `AST Validation failed: ${astError.message}`,
                });
                return { success: false, dryRunPassed: false, error: astError.message };
            }

            // 2. Isolated Dry-Run Gate
            await updateJobStatus({ jobId, progress: 75 });
            await addJobLog(jobId, "INFO", "Starting isolated Dry-Run gate to verify test executability...");
            broadcastAiJobProgress(jobId, {
                progress: 75,
                stage: "Verifying test syntax in isolated Dry-Run...",
                message: "Starting isolated Dry-Run gate to verify test executability...",
                userId: job.userId,
            });

            const snapshotRecord = await prisma.projectSnapshot.findUnique({
                where: { id: snapshotId },
                select: { rootDir: true }
            });
            const rootDir = snapshotRecord?.rootDir || job.snapshot?.rootDir;

            if (!rootDir || !fs.existsSync(rootDir)) {
                throw new ServiceError("Snapshot root directory not found for dry-run", 404);
            }

            const tempDir = path.join(rootDir, ".covai-temp");
            fs.mkdirSync(tempDir, { recursive: true });
            const dryRunFile = path.join(tempDir, "dryrun.spec.js");
            fs.writeFileSync(dryRunFile, generatedCode, "utf8");

            let dryRunSuccess = false;
            let dryRunError = "";
            let autHandle = null;
            let autPort = 4173;

            try {
                if (executionMode === "full") {
                    const runRes = await runSystemTests({jobId, rootDir, executionMode, execution: {runner:"playwright", rootDir, testDirectory:"tests/system", testFile:dryRunFile}});
                    dryRunSuccess = runRes.success;
                    if (!runRes.success) dryRunError = formatSystemTestFailure({...runRes,stdout:fs.existsSync(runRes.reportPath) ? fs.readFileSync(runRes.reportPath,"utf8") : runRes.stdout});
                } else {
                try {
                    autPort = await resolveAvailableAutPort(rootDir, 4173);
                    await prepareAutEnvironment(rootDir, autPort, jobId);
                    autHandle = await startAutServer({
                        snapshotDir: rootDir,
                        port: autPort,
                        jobId,
                        healthTimeoutMs: 15000,
                    }).catch((err) => {
                        console.warn(`[Dry-Run] AUT server auto-start skipped: ${err.message}`);
                        return null;
                    });
                } catch (envErr) {
                    console.warn(`[Dry-Run] Environment setup skipped: ${envErr.message}`);
                }

                const relativeDryRunPath = path.relative(rootDir, dryRunFile).replace(/\\/g, "/");
                ensurePlaywrightPrerequisites(rootDir, autPort);
                const dryConfig = path.join(tempDir, "playwright.config.mjs");
                fs.writeFileSync(dryConfig, `export default { testDir: '.', testMatch: 'dryrun.spec.js', retries: 0, use: { headless: true, baseURL: process.env.PLAYWRIGHT_BASE_URL } };`, "utf8");
                const dryRunCmd = `npx --yes playwright test "${relativeDryRunPath}" --config=.covai-temp/playwright.config.mjs --timeout=15000 --reporter=json`;
                const runRes = await dockerRunner.run({
                    snapshotPath: rootDir,
                      command: resolvePlaywrightCommand(rootDir, dryRunCmd),
                      timeoutMs: 120000,
                    jobId,
                      forceHost: true,
                    env: {
                        PLAYWRIGHT_BASE_URL: `http://localhost:${autPort}`,
                    },
                });
                dryRunSuccess = runRes.success;
                if (!runRes.success) {
                    dryRunError = formatSystemTestFailure(runRes);
                }
                }
            } catch (err) {
                dryRunSuccess = false;
                dryRunError = err.message;
            } finally {
                if (autHandle?.started && autHandle?.pid) {
                    try {
                        await stopAutServer(autHandle.pid, autHandle.port, jobId);
                    } catch (_) {}
                }
                try {
                    if (fs.existsSync(dryRunFile)) fs.unlinkSync(dryRunFile);
                    const dryConfig = path.join(tempDir, "playwright.config.mjs");
                    if (fs.existsSync(dryConfig)) fs.unlinkSync(dryConfig);
                } catch (_) {}
            }

            await updateJobStatus({ jobId, progress: 90 });
            broadcastAiJobProgress(jobId, {
                progress: 90,
                stage: "Persisting verified tests...",
                message: "Saving verified tests to test suite...",
                userId: job.userId,
            });

            // 3. Persist based on Dry-Run Result
            await prisma.aiTest.deleteMany({
                where: { snapshotId, mode: "PLAYWRIGHT_E2E" }
            });

            if (dryRunSuccess) {
                // Dry-Run PASS: Save officially into tests/e2e/ai-generated.spec.js
                const fullTargetPath = path.join(rootDir, targetFilePath);
                fs.mkdirSync(path.dirname(fullTargetPath), { recursive: true });
                fs.writeFileSync(fullTargetPath, generatedCode, "utf8");

                await prisma.aiTest.create({
                    data: {
                        projectId,
                        snapshotId,
                        mode: "PLAYWRIGHT_E2E",
                        status: "VERIFIED",
                        filePath: targetFilePath,
                        content: generatedCode,
                        metaJson: JSON.stringify({
                            framework: "PLAYWRIGHT",
                            executionMode,
                            dryRun: "PASSED",
                            verifiedAt: new Date().toISOString(),
                        }),
                    },
                });

                await addJobLog(jobId, "INFO", `Dry-run passed! Saved verified test to ${targetFilePath}.`);
                await updateJobStatus({ jobId, status: "SUCCESS", progress: 100 });
                broadcastAiJobProgress(jobId, {
                    progress: 100,
                    stage: "Completed",
                    message: `Dry-run passed! Saved verified test to ${targetFilePath}.`,
                    status: "SUCCESS",
                    userId: job.userId,
                });
                await notificationService.createJobFinishedNotification(jobId);
                return { success: true, dryRunPassed: true, filePath: targetFilePath };
            } else {
                // Dry-Run FAIL: Do NOT save to main test suite. Save AiTest as FAILED for UI feedback.
                await prisma.aiTest.create({
                    data: {
                        projectId,
                        snapshotId,
                        mode: "PLAYWRIGHT_E2E",
                        status: "FAILED",
                        filePath: targetFilePath,
                        content: generatedCode,
                        metaJson: JSON.stringify({
                            framework: "PLAYWRIGHT",
                            executionMode,
                            dryRun: "FAILED",
                            error: dryRunError.slice(0, 1500),
                            failedAt: new Date().toISOString(),
                        }),
                    },
                });

                await addJobLog(
                    jobId,
                    "WARN",
                    `Dry-run failed: ${dryRunError.slice(0, 300)}. Test was not saved to project test suite.`,
                );
                await updateJobStatus({
                    jobId,
                    status: "FAILED",
                    progress: 100,
                    errorMessage: `Dry-run failed: ${dryRunError.slice(0, 300)}. Test was not saved to project test suite.`,
                });
                broadcastAiJobProgress(jobId, {
                    progress: 100,
                    stage: "Dry-Run Failed",
                    message: `Dry-run failed: ${dryRunError.slice(0, 300)}`,
                    status: "FAILED",
                    userId: job.userId,
                });
                await notificationService.createJobFinishedNotification(jobId);
                return { success: false, dryRunPassed: false, error: dryRunError };
            }
        }

        // ── Supertest Integration Generation Branch ────────────────────────
        if (mode === "SUPERTEST_REGENERATE") {
            const { aiTestId, scenarioId } = payloadJsonObj;
            
            await updateJobStatus({ jobId, progress: 40 });
            await addJobLog(jobId, "INFO", JSON.stringify({ stage: 'GENERATE_AI_TESTS', label: "Regenerating scenario using AI...", progress: 40 }));
            
            const { regenerateScenarioService } = await import("./scenarioManager.service.js");
            await regenerateScenarioService(aiTestId, scenarioId, payload);
            
            await updateJobStatus({ jobId, progress: 100, status: "SUCCESS" });
            return;
        }

        if (mode === "SUPERTEST") {
            const { extractValidEndpoints } = await import("./apiEndpointParser.service.js");
            const allEndpoints = extractValidEndpoints(payload.sourceCode || []);
            const CHUNK_SIZE = 2; // Strict requirement: start with 2
            const allTestsCombined = [];
            const suggestionsCombined = [];
            let summaryCombined = { message: "" };

            // Selective Generation: filter to targetEndpoints if specified
            let targetEndpoints = allEndpoints;
            if (payload.targetEndpoints && Array.isArray(payload.targetEndpoints) && payload.targetEndpoints.length > 0) {
                const targetSet = new Set(
                    payload.targetEndpoints.map(t => typeof t === 'string' ? t.trim().toUpperCase() : `${t.method} ${t.path || t.fullPath || t.route}`.trim().toUpperCase())
                );
                targetEndpoints = allEndpoints.filter(ep => {
                    const key = `${ep.method} ${ep.fullPath}`.toUpperCase();
                    const altKey = `${ep.method} ${ep.path || ep.route}`.toUpperCase();
                    return targetSet.has(key) || targetSet.has(altKey);
                });
                await addJobLog(jobId, "INFO", `Selective generation active: ${targetEndpoints.length} of ${allEndpoints.length} endpoints selected.`);
            } else {
                await addJobLog(jobId, "INFO", `Found ${allEndpoints.length} endpoints to generate tests for. Batching in chunks of ${CHUNK_SIZE}...`);
            }

            // Initialize tracker for target endpoints
            const endpointTracker = new Map();
            targetEndpoints.forEach(ep => {
                endpointTracker.set(`${ep.method} ${ep.fullPath}`, {
                    endpoint: ep,
                    happy: false,
                    error: false,
                    scenarios: [],
                    failed: false,
                    retries: 0
                });
            });

            if (targetEndpoints.length === 0) {
                await addJobLog(jobId, "WARN", "No matching API endpoints detected for generation. Aborting.");
                await updateJobStatus({ jobId, status: "SUCCESS", progress: 100 });
                return { success: true, count: 0, summary: summaryCombined };
            }

            const MAX_RETRIES = 2;
            let currentQueue = Array.from(endpointTracker.keys());
            let generationCycles = 0;

            while (currentQueue.length > 0 && generationCycles < 5) { // Limit total cycles to prevent infinite loops
                generationCycles++;
                await addJobLog(jobId, "INFO", `Generation Cycle ${generationCycles}. Endpoints in queue: ${currentQueue.length}`);
                
                let nextQueue = [];
                for (let i = 0; i < currentQueue.length; i += CHUNK_SIZE) {
                    const chunkKeys = currentQueue.slice(i, i + CHUNK_SIZE);
                    const chunkEndpoints = chunkKeys.map(k => endpointTracker.get(k).endpoint);
                    
                    const chunkProgress = Math.min(80, Math.floor(40 + ((i / currentQueue.length) * 40 / generationCycles)));
                    await updateJobStatus({ jobId, progress: chunkProgress });
                    
                    const batchId = `cycle-${generationCycles}-batch-${Math.floor(i / CHUNK_SIZE) + 1}`;
                    await addJobLog(jobId, "INFO", JSON.stringify({ 
                        stage: 'BUILD_CONTEXT', 
                        label: `Calling Gemini for batch ${batchId} (${chunkEndpoints.length} endpoints)...`, 
                        progress: chunkProgress 
                    }));

                    // We instruct the model precisely for the missing coverage types
                    const promptChunk = chunkEndpoints.map(ep => {
                        const tr = endpointTracker.get(`${ep.method} ${ep.fullPath}`);
                        let missing = [];
                        if (!tr.happy) missing.push("Happy Path (200/201)");
                        if (!tr.error) missing.push("Error Edge Case (400/404/500)");
                        return { ...ep, missingCoverageRequested: missing };
                    });

                    const supertestPrompt = buildSupertestPrompt(payload, promptChunk);
                    
                    let batchStatus = "SUCCESS";
                    let acceptedScenarios = 0;
                    let rejectedScenarios = 0;
                    
                    try {
                        // The model name is hardcoded here but gemini.service resolves fallbacks internally
                        const supertestResponseText = await generateText(supertestPrompt, "gemini-3.8-flash");
                        
                        if (supertestResponseText) {
                            try {
                                const { allTests, suggestions, summary } = processSupertestTests(supertestResponseText, { projectId, snapshotId });
                                
                                // Helper to match path with route params and query strings
                                const matchEndpoint = (requestPath, requestMethod, validKeys) => {
                                    const cleanPath = requestPath.split("?")[0].replace(/\/+$/, "") || "/";
                                    for (const key of validKeys) {
                                        const [method, path] = key.split(" ");
                                        if (method !== requestMethod) continue;
                                        
                                        const cleanRoute = path.replace(/\/+$/, "") || "/";
                                        
                                        // Convert express route /path/:id to regex ^/path/[^/]+$
                                        const regexStr = "^" + cleanRoute.replace(/:[^\/]+/g, "[^/]+") + "$";
                                        const regex = new RegExp(regexStr);
                                        if (regex.test(cleanPath)) {
                                            return key;
                                        }
                                    }
                                    return null;
                                };

                                // VALIDATION: Strict per-endpoint output validation
                                const validTestsForBatch = [];
                                for (const testFile of allTests) {
                                    const meta = JSON.parse(testFile.metaJson);
                                    const validRequests = [];
                                    
                                    for (const req of meta.requests) {
                                        const matchedKey = matchEndpoint(req.path, req.method, chunkKeys);
                                        
                                        // Verify that scenario is associated with a REAL endpoint IN THE CURRENT BATCH
                                        if (!matchedKey) {
                                            rejectedScenarios++;
                                            await addJobLog(jobId, "WARN", `Rejected scenario '${req.testName}' for endpoint '${req.method} ${req.path}': Not in the requested batch or is an invented endpoint.`);
                                            continue;
                                        }
                                        
                                        const tr = endpointTracker.get(matchedKey);
                                        const name = req.testName.toLowerCase();
                                        
                                        // Distinguish Happy Path from Error Edge Case
                                        let isHappy = name.includes('happy') || name.includes('200') || name.includes('201') || name.includes('success');
                                        let isError = name.includes('error') || name.includes('400') || name.includes('401') || name.includes('404') || name.includes('500') || name.includes('fail') || name.includes('missing') || name.includes('invalid');
                                        
                                        if (!isHappy && !isError) {
                                            // Fallback classification if naming is vague
                                            isHappy = true;
                                        }
                                        
                                        if (isHappy) tr.happy = true;
                                        if (isError) tr.error = true;
                                        
                                        acceptedScenarios++;
                                        validRequests.push(req);
                                    }
                                    
                                    if (validRequests.length > 0) {
                                        meta.requests = validRequests;
                                        testFile.metaJson = JSON.stringify(meta);
                                        validTestsForBatch.push(testFile);
                                    }
                                }
                                
                                allTestsCombined.push(...validTestsForBatch);
                                if (suggestions) suggestionsCombined.push(...suggestions);
                                
                            } catch (e) {
                                batchStatus = "PARSE_ERROR";
                                await addJobLog(jobId, "WARN", `AI Model output parsing failed for batch: ${e.message}`);
                            }
                        } else {
                            batchStatus = "EMPTY_RESPONSE";
                            await addJobLog(jobId, "WARN", `AI Model returned empty response for batch.`);
                        }
                    } catch (genErr) {
                        batchStatus = "PROVIDER_ERROR";
                        await addJobLog(jobId, "ERROR", `Provider generation failed for batch ${batchId}: ${genErr.message}`);
                    }
                    
                    // Evaluate missing coverage for the chunk and queue retries
                    for (const key of chunkKeys) {
                        const tr = endpointTracker.get(key);
                        if (!tr.happy || !tr.error) {
                            tr.retries++;
                            if (tr.retries <= MAX_RETRIES) {
                                await addJobLog(jobId, "WARN", `Endpoint ${key} missing required coverage (Happy: ${tr.happy}, Error: ${tr.error}). Queuing for retry (${tr.retries}/${MAX_RETRIES}).`);
                                nextQueue.push(key);
                            } else {
                                tr.failed = true;
                                await addJobLog(jobId, "ERROR", `Endpoint ${key} exhausted retries. Unresolved coverage.`);
                            }
                        }
                    }
                    
                    // Log structured batch info
                    await addJobLog(jobId, "INFO", JSON.stringify({
                        batchId,
                        endpoints: chunkKeys,
                        attempt: generationCycles,
                        status: batchStatus,
                        acceptedScenarios,
                        rejectedScenarios,
                    }));
                }
                currentQueue = nextQueue;
            }
            
            // Check Final Status
            let completelyCovered = 0;
            let partialCovered = 0;
            let completelyMissed = 0;
            const unresolvedEndpoints = [];

            for (const [key, tr] of endpointTracker.entries()) {
                if (tr.happy && tr.error) completelyCovered++;
                else if (tr.happy || tr.error) {
                    partialCovered++;
                    unresolvedEndpoints.push(`${key} (Missing: ${!tr.happy ? 'Happy' : 'Error'})`);
                } else {
                    completelyMissed++;
                    unresolvedEndpoints.push(`${key} (Missing: Both)`);
                }
            }

            const finalJobStatus = (completelyMissed === targetEndpoints.length) ? "FAILED" : (unresolvedEndpoints.length > 0 ? "PARTIAL" : "SUCCESS");
            await addJobLog(jobId, "INFO", `Coverage Results: ${completelyCovered} Complete, ${partialCovered} Partial, ${completelyMissed} Missed.`);

            await addJobLog(jobId, "INFO", JSON.stringify({ stage: 'GENERATE_AI_TESTS', label: "Consolidating test scenarios...", progress: 85 }));
            await updateJobStatus({ jobId, progress: 85 });

            await addJobLog(jobId, "INFO", "Replacing old Supertest tests atomically...");
            const existingTests = await prisma.aiTest.findMany({
                where: { snapshotId }
            });
            const supertestIds = [];
            const testsToUpdate = [];
            
            const { stripAiScenariosService } = await import("./scenarioManager.service.js");

            const successfullyGeneratedEndpoints = new Set();
            for (const [key, tr] of endpointTracker.entries()) {
                if (tr.happy || tr.error) successfullyGeneratedEndpoints.add(key);
            }

            existingTests.forEach(t => {
                if (!t.metaJson) return;
                try {
                    const meta = JSON.parse(t.metaJson);
                    if (meta.framework !== "SUPERTEST") return;
                    
                    let overlapsWithNew = false;
                    if (meta.requests && Array.isArray(meta.requests)) {
                        for (const req of meta.requests) {
                            const key = `${req.method} ${req.path}`;
                            // Use basic string matching or the regex matcher if needed. We assume path is normalized.
                            // If this old test covers an endpoint we just generated, we consider it overlapping.
                            // We can check if any successfully generated endpoint regex matches this req.path
                            for (const successKey of successfullyGeneratedEndpoints) {
                                const [sMethod, sPath] = successKey.split(" ");
                                if (req.method === sMethod) {
                                    const regexStr = "^" + sPath.replace(/:[^\/]+/g, "[^/]+") + "$";
                                    if (new RegExp(regexStr).test(req.path)) {
                                        overlapsWithNew = true;
                                        break;
                                    }
                                }
                            }
                            if (overlapsWithNew) break;
                        }
                    }

                    if (meta.userModified || overlapsWithNew) {
                        // If it overlaps, we MUST strip the old AI scenarios for those endpoints to replace them.
                        // Wait, stripAiScenariosService strips ALL AI scenarios in the file.
                        // This is acceptable because files usually group related endpoints.
                        const stripped = stripAiScenariosService(t);
                        if (stripped) {
                            testsToUpdate.push(stripped);
                        } else {
                            if (overlapsWithNew) supertestIds.push(t.id);
                        }
                    } else {
                        // If it doesn't overlap and wasn't user modified, we KEEP IT to preserve partial coverage!
                        // Do not add to supertestIds.
                    }
                } catch { }
            });

            // Step 1: Write NEW files to unique staging paths
            allTestsCombined.forEach(t => {
                if (!t.id) t.id = crypto.randomUUID();
                t.filePath = t.filePath.replace('.test.js', `-${t.id.substring(0, 8)}.test.js`);
            });

            if (allTestsCombined.length > 0) {
                saveAiTestsToFilesystem(job.snapshot.rootDir, allTestsCombined);
            }
            if (testsToUpdate.length > 0) {
                saveAiTestsToFilesystem(job.snapshot.rootDir, testsToUpdate);
            }

            // Step 2: Atomic DB Transaction
            await prisma.$transaction(async (tx) => {
                if (supertestIds.length > 0) {
                    await tx.aiTest.deleteMany({
                        where: { id: { in: supertestIds } }
                    });
                }
                
                for (const updated of testsToUpdate) {
                    await tx.aiTest.update({
                        where: { id: updated.id },
                        data: {
                            content: updated.content,
                            metaJson: updated.metaJson
                        }
                    });
                }
                
                await tx.aiSuggestion.deleteMany({
                    where: { snapshotId }
                });
                
                if (suggestionsCombined && suggestionsCombined.length > 0) {
                    await tx.aiSuggestion.createMany({ data: suggestionsCombined });
                }

                if (allTestsCombined.length > 0) {
                    await tx.aiTest.createMany({ data: allTestsCombined });
                }
            });

            // Step 3: Cleanup old files asynchronously
            if (supertestIds.length > 0) {
                try {
                    // Assuming existing tests are retrieved above, we can filter them for cleanup.
                    const existingSupertests = existingTests.filter(t => supertestIds.includes(t.id));
                    removeAiTestsFromFilesystem(job.snapshot.rootDir, existingSupertests);
                } catch (err) {
                    console.error("[aiTestsJob] Failed to clean up old files after DB transaction", err);
                    await addJobLog(jobId, "WARN", "Failed to clean up some old test files. New tests are safely saved.");
                }
            }

            if (allTestsCombined.length > 0) {
                await addJobLog(jobId, "INFO", `Successfully generated ${allTestsCombined.length} Supertest test files.`);
            } else {
                await addJobLog(jobId, "INFO", "No Supertest integration test files were generated.");
            }

            await updateJobStatus({ jobId, status: finalJobStatus === "PARTIAL" ? "SUCCESS" : finalJobStatus, progress: 100 });
            await notificationService.createJobFinishedNotification(jobId);
            return { 
                success: finalJobStatus !== "FAILED", 
                count: allTestsCombined.length, 
                summary: { 
                    message: `Coverage: ${completelyCovered} Complete, ${partialCovered} Partial, ${completelyMissed} Missed.`,
                    unresolvedEndpoints,
                    status: finalJobStatus
                } 
            };
        }

        // ── Cypress E2E Generation Branch ──────────────────────────────────
        if (mode === "CYPRESS") {
            const cypressPrompt = buildCypressPrompt(payload);

            await updateJobStatus({ jobId, progress: 40 });

            await addJobLog(jobId, "INFO", "Calling Gemini AI model for Cypress test generation...");
            const cypressResponseText = await generateText(cypressPrompt, "gemini-3.8-flash");

            if (!cypressResponseText) {
                throw new Error("Gemini returned an empty response for Cypress generation.");
            }

            await updateJobStatus({ jobId, progress: 80 });

            await addJobLog(jobId, "INFO", "Parsing and classifying Cypress test scenarios...");
            const { allTests, summary } = processCypressTests(cypressResponseText, {
                projectId,
                snapshotId,
            });

            await addJobLog(jobId, "INFO", "Cleaning up old Cypress tests for this snapshot...");
            await prisma.aiTest.deleteMany({
                where: { snapshotId, mode: "CYPRESS" },
            });

            if (allTests.length > 0) {
                await prisma.aiTest.createMany({ data: allTests });
                await addJobLog(jobId, "INFO", summary.message);
            } else {
                await addJobLog(jobId, "INFO", "No Cypress test files were generated.");
            }

            await updateJobStatus({ jobId, status: "SUCCESS", progress: 100 });
            await notificationService.createJobFinishedNotification(jobId);
            return { success: true, count: allTests.length, summary };
        }

        // ── Jest / Vitest Generation Branch (existing) ─────────────────────
        const finalPrompt = buildFinalPrompt(payload, { mode, hasJest, hasVitest });

        await updateJobStatus({ jobId, progress: 40 });

        // SCRUM-394: Call Gemini API
        await addJobLog(jobId, "INFO", "Calling Gemini AI model...");
        const responseText = await generateText(finalPrompt, "gemini-3.8-flash");

        // SCRUM-396: Validate AI response
        if (!responseText) {
            throw new Error("Gemini returned an empty response.");
        }

        await updateJobStatus({ jobId, progress: 80 });

        await addJobLog(jobId, "INFO", "Parsing AI response...");
        const { suggestions, tests } = processAiSuggestions(responseText, projectId, snapshotId);

        await addJobLog(jobId, "INFO", "Saving skeleton tests to database...");

        // Clean up old ones for this snapshot
        await prisma.aiTest.deleteMany({
            where: { snapshotId }
        });
        await prisma.aiSuggestion.deleteMany({
            where: { snapshotId }
        });

        // SCRUM-397: Generate mock suggestions
        if (suggestions.length > 0) {
            await prisma.aiSuggestion.createMany({
                data: suggestions
            });
            await addJobLog(jobId, "INFO", `Saved ${suggestions.length} mock suggestions.`);
        } else {
            await addJobLog(jobId, "INFO", "No mock suggestions were generated.");
        }

        // SCRUM-398: Generate tests
        if (tests.length > 0) {
            let processedTests, summary;

            if (mode === "FULL") {
                const result = processFullTests(tests);
                processedTests = result.processedTests;
                summary = result.summary;
            } else {
                const result = processSkeletonTests(tests);
                processedTests = result.processedTests;
                summary = result.summary;
            }

            await prisma.aiTest.createMany({
                data: processedTests
            });
            await addJobLog(jobId, "INFO", summary.message);
        } else {
            await addJobLog(jobId, "INFO", `No ${mode.toLowerCase()} test files were generated.`);
        }

        await updateJobStatus({
            jobId,
            status: "SUCCESS",
            progress: 100,
        });

        // Notify user
        await notificationService.createJobFinishedNotification(jobId);

        return { success: true, count: tests.length };
    } catch (error) {
        // SCRUM-395: Handle generation errors
        console.error(`[AiTestsJob ${jobId}] Failed:`, error);

        try {
            await addJobLog(jobId, "ERROR", `Pipeline Error: ${error.message}`);
        } catch (_) {}

        try {
            await updateJobStatus({
                jobId,
                status: "FAILED",
                progress: 100,
                errorMessage: error.message,
            });
        } catch (_) {}

        throw error;
    }
};
