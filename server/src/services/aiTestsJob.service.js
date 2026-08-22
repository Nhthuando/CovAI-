import prisma from "../config/prisma.js";
import { getJobById, addJobLog } from "./job.service.js";
import { updateJobStatus } from "./jobUpdate.service.js";
import { buildAiPayload } from "./aiContextBuilder.service.js";
import { buildFinalPrompt } from "./aiPromptBuilder.service.js";
import { buildCypressPrompt } from "./cypressPromptBuilder.service.js";
import { generateText } from "./gemini.service.js";
import { processAiSuggestions } from "./aiSuggestionParser.service.js";
import { processSkeletonTests } from "./skeletonPostProcessor.service.js";
import { processFullTests } from "./fullTestsPostProcessor.service.js";
import { processCypressTests } from "./cypressPostProcessor.service.js";
import { notificationService } from "./notification.service.js";

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
