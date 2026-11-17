import { z } from "zod";
import { ServiceError } from "../utils/serviceError.js";
import { GEMINI_MODEL_IDS } from '../../../shared/aiModels.js';

export const contextId = z.string().min(1).max(128).regex(/^[\w-]+$/);
// Do not store common credential forms as durable guidance/memory.
export const hasCredential = (text) => /-----BEGIN [\w ]*PRIVATE KEY-----|\b(?:AIza[\w-]{25,}|gh[pousr]_[\w]{20,}|github_pat_[\w]{20,}|sk-[\w-]{20,})|\b(?:password|api[_ -]?key|access[_ -]?token|secret)\s*[:=]\s*["']?[^\s"']{8,}/i.test(text);
const safeText = (max) => z.string().trim().max(max).refine(value => !hasCredential(value), "Remove credentials before saving context.");
export const settingsSchema = z.object({ automaticMemory: z.boolean(), guidance: safeText(8000), revision: z.number().int().nonnegative() }).strict();
export const noteSchema = z.object({ content: safeText(1000).refine(value => value.length > 0, "Memory cannot be empty."), pinned: z.boolean().default(false) }).strict();
export const editNoteSchema = noteSchema.extend({ revision: z.number().int().nonnegative() }).strict();
export const sessionSchema = z.object({ title: z.string().trim().min(1).max(120).optional(), useMemory: z.boolean().default(true), snapshotId: contextId.nullable().optional() }).strict();
export const branchSchema = z.object({
    throughMessageId: contextId.optional(),
    beforeMessageId: contextId.optional(),
    useMemory: z.boolean().default(true),
    snapshotId: contextId.nullable().optional(),
    title: z.string().trim().min(1).max(120).optional(),
}).strict().refine(input => !(input.throughMessageId && input.beforeMessageId), "Choose one branch boundary.");
const attachment = z.object({ type: z.enum(["image", "file", "project_file", "text", "code"]), name: z.string().max(240).optional(), path: z.string().max(500).optional(), content: z.string().max(100000).optional(), data: z.string().max(1500000).optional(), mimeType: z.string().max(100).optional() }).passthrough();
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const percent = z.number().min(0).max(100);
const label = z.string().max(64).regex(/^[\w .()/+&-]*$/);
const metricsScope = {
    projectId: contextId,
    snapshotId: contextId,
    state: z.enum(["ready", "loading", "not-run", "unavailable"]),
    tab: label.optional(),
};
const displayedMetrics = z.discriminatedUnion("kind", [
    z.object({
        ...metricsScope, kind: z.literal("unit"), framework: label.optional(), runStatus: label.optional(),
        cards: z.array(z.object({
            metric: z.enum(["statements", "branches", "functions", "lines"]),
            percent: percent.nullable(), covered: count.nullable(), total: count.nullable(),
            status: z.enum(["LOW", "FAIR", "PASSING", "Unavailable"]),
        }).strict()).length(4).refine(cards => new Set(cards.map(card => card.metric)).size === 4).optional(),
    }).strict(),
    z.object({
        ...metricsScope, kind: z.literal("integration"),
        counts: z.object({
            endpoints: count, testedEndpoints: count, passedEndpoints: count, failedEndpoints: count,
            scenarios: count, passedScenarios: count, failedScenarios: count,
            apiCoveragePct: percent, scenarioPassRate: percent,
        }).strict().optional(),
    }).strict(),
    z.object({
        ...metricsScope, kind: z.literal("system"), framework: label, executionMode: label,
        assessmentId: contextId.optional(),
        counts: z.object({
            scenarios: count, passed: count, failed: count, flaky: count, skipped: count,
            durationMs: z.number().nonnegative().max(Number.MAX_SAFE_INTEGER), passRate: percent.nullable(),
        }).strict().optional(),
    }).strict(),
    z.object({
        ...metricsScope, kind: z.literal("overview"),
        healthScore: percent.nullable().optional(), healthGrade: label.optional(), qualityGate: label.optional(),
        totalTests: count.optional(), passedTests: count.optional(), failedTests: count.optional(),
        overallCoveragePct: percent.nullable().optional(), unitLinesPct: percent.nullable().optional(),
        unitBranchesPct: percent.nullable().optional(), apiCoveragePct: percent.nullable().optional(),
        systemFlowPct: percent.nullable().optional(),
    }).strict(),
]);
export const screenContextSchema = z.object({ contextVersion: z.literal(1).optional(), activity: z.string().max(40).regex(/^[a-z-]+$/), testType: z.enum(["unit", "integration", "system"]).optional(), filePath: z.string().max(500).optional(), workspaceRevision: z.number().int().nonnegative().optional(), testRunId: contextId.optional(), scenarioId: contextId.optional(), jobId: contextId.optional(), displayedMetrics: displayedMetrics.optional() }).strict();
export const chatSchema = z.object({ clientRequestId: contextId, screenContext: screenContextSchema.optional(), message: z.string().trim().min(1).max(16000), sessionId: contextId.nullable().optional(), snapshotId: contextId.nullable().optional(), useMemory: z.boolean().optional(), model: z.enum(GEMINI_MODEL_IDS).optional(), attachments: z.array(attachment).max(5).default([]), history: z.array(z.unknown()).max(1000).optional() }).strict();
export const previewSchema = z.object({ screenContext: screenContextSchema.optional(), sessionId: contextId.nullable().optional(), snapshotId: contextId.nullable().optional(), useMemory: z.boolean().optional(), message: z.string().max(16000).default("") }).strict();
export const parseContext = (schema, value) => {
    const result = schema.safeParse(value);
    if (!result.success) throw new ServiceError(result.error.issues.map(issue => `${issue.path.join(".") || "request"}: ${issue.message}`).join("; "), 400);
    return result.data;
};
