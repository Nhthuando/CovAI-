import { z } from "zod";
import { ServiceError } from "../utils/serviceError.js";

const querySchema = z.object({
    type: z.enum(["project", "analysis"]).default("analysis"),
    format: z.enum(["pdf", "json"]).optional(),
    snapshotId: z.string().trim().min(1).max(128).regex(/^[a-zA-Z0-9_-]+$/).optional(),
}).strict();

export const parseExportQuery = (query) => {
    const parsed = querySchema.safeParse(query);
    if (!parsed.success || (parsed.data.type === "project" && parsed.data.format)) {
        throw new ServiceError("Use type=project for ZIP, or type=analysis with format=pdf|json and optional snapshotId", 400);
    }
    return { ...parsed.data, format: parsed.data.type === "analysis" ? parsed.data.format || "pdf" : "zip" };
};
