import prisma from "../config/prisma.js";
import { getJobById, addJobLog } from "./job.service.js";
import { updateJobStatus } from "./jobUpdate.service.js";
import { buildAiPayload } from "./aiContextBuilder.service.js";
import { buildFinalPrompt } from "./aiPromptBuilder.service.js";
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

        // SCRUM-393: Send AI context
        await addJobLog(jobId, "INFO", `Building AI Context Payload for ${mode} Tests...`);
        const aiPayloadResult = await buildAiPayload(snapshotId);
        const payload = aiPayloadResult.payload;

        await updateJobStatus({ jobId, progress: 30 });

        await addJobLog(jobId, "INFO", `Constructing final prompt for ${mode} mode...`);

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

        await addJobLog(jobId, "ERROR", `Pipeline Error: ${error.message}`);

        await updateJobStatus({
            jobId,
            status: "FAILED",
            errorMessage: error.message,
        });

        throw error;
    }
};
