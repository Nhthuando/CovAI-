import { SAFE_JOB_STATUSES } from "./projectStructure.constants.js";

export const analysisJobResponse = (job) => ({
    id: job.id, type: job.type, projectId: job.projectId, snapshotId: job.snapshotId,
    status: SAFE_JOB_STATUSES.includes(job.status) ? job.status : "FAILED",
    progress: job.progress, errorMessage: job.errorMessage || null,
    createdAt: job.createdAt, startedAt: job.startedAt || null, finishedAt: job.finishedAt || null,
});

export const snapshotResponse = (snapshot) => ({
    id: snapshot.id, source: snapshot.source, checksum: snapshot.checksum,
    commitSha: snapshot.commitSha, createdAt: snapshot.createdAt,
    hasStructureAnalysis: Boolean(snapshot.structureAnalysis),
    schemaVersion: snapshot.structureAnalysis?.schemaVersion || null,
});

export const analysisResultResponse = (analysis) => JSON.parse(analysis.resultJson);
