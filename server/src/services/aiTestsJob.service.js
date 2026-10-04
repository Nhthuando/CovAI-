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
            const supertestPrompt = buildSupertestPrompt(payload);

            await updateJobStatus({ jobId, progress: 40 });

            await addJobLog(jobId, "INFO", JSON.stringify({ stage: 'BUILD_CONTEXT', label: "Calling Gemini AI model for Supertest test generation...", progress: 40 }));
            const supertestResponseText = await generateText(supertestPrompt, "gemini-1.5-pro");

            if (!supertestResponseText) {
                throw new ServiceError("AI Model failed to return test scenarios", 500);
            }

            await addJobLog(jobId, "INFO", JSON.stringify({ stage: 'GENERATE_AI_TESTS', label: "Parsing and validating generated test scenarios...", progress: 80 }));
            await updateJobStatus({ jobId, progress: 80 });

            await addJobLog(jobId, "INFO", JSON.stringify({ stage: 'VALIDATE_SCENARIOS', label: "Parsing Supertest scenarios...", progress: 85 }));
            const { allTests, suggestions, summary } = processSupertestTests(supertestResponseText, {
                projectId,
                snapshotId,
            });

            await addJobLog(jobId, "INFO", "Cleaning up old Supertest tests for this snapshot...");
            // Clean up old SUPERTEST files using in-memory filtering because Prisma doesn't support json filtering cleanly on all DBs
            const existingTests = await prisma.aiTest.findMany({
                where: { snapshotId }
            });
            const supertestTests = existingTests
                .filter(t => {
                    if (!t.metaJson) return false;
                    try {
                        return JSON.parse(t.metaJson).framework === "SUPERTEST";
                    } catch { return false; }
                });
            const supertestIds = supertestTests.map(t => t.id);

            if (supertestIds.length > 0) {
                removeAiTestsFromFilesystem(job.snapshot.rootDir, supertestTests);
                await prisma.aiTest.deleteMany({
                    where: { id: { in: supertestIds } }
                });
            }

            // Clean up old AiSuggestions (since we are replacing them)
            await prisma.aiSuggestion.deleteMany({
                where: { snapshotId }
            });

            if (suggestions && suggestions.length > 0) {
                await prisma.aiSuggestion.createMany({ data: suggestions });
                await addJobLog(jobId, "INFO", `Saved ${suggestions.length} Supertest integration scenario suggestions.`);
            }

            if (allTests.length > 0) {
                saveAiTestsToFilesystem(job.snapshot.rootDir, allTests);
                await prisma.aiTest.createMany({ data: allTests });
                await addJobLog(jobId, "INFO", summary.message);
            } else {
                await addJobLog(jobId, "INFO", "No Supertest integration test files were generated.");
            }

            await updateJobStatus({ jobId, status: "SUCCESS", progress: 100 });
            await notificationService.createJobFinishedNotification(jobId);
            return { success: true, count: allTests.length, summary };
        }

        // ── Cypress E2E Generation Branch ──────────────────────────────────
        if (mode === "CYPRESS") {
            const cypressPrompt = buildCypressPrompt(payload);

            await updateJobStatus({ jobId, progress: 40 });

            await addJobLog(jobId, "INFO", "Calling Gemini AI model for Cypress test generation...");
            const cypressResponseText = await generateText(cypressPrompt, "gemini-1.5-pro");

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
        const responseText = await generateText(finalPrompt, "gemini-1.5-pro");

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
