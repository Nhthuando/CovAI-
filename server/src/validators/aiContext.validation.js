import { z } from "zod";
import { ServiceError } from "../utils/serviceError.js";

export const contextId = z.string().min(1).max(128).regex(/^[\w-]+$/);
// Do not store common credential forms as durable guidance/memory.
export const hasCredential = (text) => /-----BEGIN [\w ]*PRIVATE KEY-----|\b(?:AIza[\w-]{25,}|gh[pousr]_[\w]{20,}|github_pat_[\w]{20,}|sk-[\w-]{20,})|\b(?:password|api[_ -]?key|access[_ -]?token|secret)\s*[:=]\s*["']?[^\s"']{8,}/i.test(text);
const safeText = (max) => z.string().trim().max(max).refine(value => !hasCredential(value), "Remove credentials before saving context.");
export const settingsSchema = z.object({ automaticMemory: z.boolean(), guidance: safeText(8000), revision: z.number().int().nonnegative() }).strict();
export const noteSchema = z.object({ content: safeText(1000).refine(value => value.length > 0, "Memory cannot be empty."), pinned: z.boolean().default(false) }).strict();
export const editNoteSchema = noteSchema.extend({ revision: z.number().int().nonnegative() }).strict();
export const sessionSchema = z.object({ title: z.string().trim().min(1).max(120).optional(), useMemory: z.boolean().default(true), snapshotId: contextId.nullable().optional() }).strict();
export const branchSchema = z.object({ throughMessageId: contextId.optional(), useMemory: z.boolean().default(true), snapshotId: contextId.nullable().optional(), title: z.string().trim().min(1).max(120).optional() }).strict();
const attachment = z.object({ type: z.enum(["image", "file", "project_file", "text", "code"]), name: z.string().max(240).optional(), path: z.string().max(500).optional(), content: z.string().max(100000).optional(), data: z.string().max(1500000).optional(), mimeType: z.string().max(100).optional() }).passthrough();
export const screenContextSchema = z.object({ activity: z.string().max(40).regex(/^[a-z-]+$/), testType: z.enum(["unit", "integration", "system"]).optional(), filePath: z.string().max(500).optional() }).strict();
export const chatSchema = z.object({ screenContext: screenContextSchema.optional(), message: z.string().trim().min(1).max(16000), sessionId: contextId.nullable().optional(), snapshotId: contextId.nullable().optional(), useMemory: z.boolean().optional(), model: z.string().max(100).regex(/^gemini-[\w.-]+$/).optional(), attachments: z.array(attachment).max(5).default([]), history: z.array(z.unknown()).max(1000).optional() }).strict();
export const previewSchema = z.object({ screenContext: screenContextSchema.optional(), sessionId: contextId.nullable().optional(), snapshotId: contextId.nullable().optional(), useMemory: z.boolean().optional(), message: z.string().max(16000).default("") }).strict();
export const parseContext = (schema, value) => {
    const result = schema.safeParse(value);
    if (!result.success) throw new ServiceError(result.error.issues.map(issue => `${issue.path.join(".") || "request"}: ${issue.message}`).join("; "), 400);
    return result.data;
};
