import prisma from "../config/prisma.js";

const snapshotProjectCache = new Map();
const lastProgressEmitted = new Map();

/**
 * Resolves projectId for a snapshotId, using an in-memory cache to prevent DB queries.
 */
export async function resolveProjectIdFromSnapshot(snapshotId) {
  if (!snapshotId) return null;
  if (snapshotProjectCache.has(snapshotId)) {
    return snapshotProjectCache.get(snapshotId);
  }

  try {
    const snap = await prisma.projectSnapshot.findUnique({
      where: { id: snapshotId },
      select: { projectId: true },
    });
    if (snap?.projectId) {
      if (snapshotProjectCache.size > 2000) snapshotProjectCache.clear();
      snapshotProjectCache.set(snapshotId, snap.projectId);
      return snap.projectId;
    }
  } catch (err) {
    console.warn("[DashboardEvents] Failed to resolve projectId for snapshot:", snapshotId, err.message);
  }
  return null;
}

/**
 * Emit a typed event to all connected clients in the project room: `project:${projectId}`
 */
export async function emitDashboardEvent(projectIdOrSnapshotId, event, payload = {}) {
  let projectId = projectIdOrSnapshotId;
  const snapshotId = payload.snapshotId || (typeof projectIdOrSnapshotId === "string" && !projectIdOrSnapshotId.startsWith("prj_") ? projectIdOrSnapshotId : null);

  if (!projectId || projectId === snapshotId) {
    projectId = await resolveProjectIdFromSnapshot(snapshotId);
  }

  if (!projectId && payload.snapshotId) {
    projectId = await resolveProjectIdFromSnapshot(payload.snapshotId);
  }

  if (!projectId) {
    return false;
  }

  if (payload.snapshotId) {
    snapshotProjectCache.set(payload.snapshotId, projectId);
  }

  const message = {
    ...payload,
    projectId,
    at: Date.now(),
  };

  const io = global.io;
  if (!io) return false;

  io.to(`project:${projectId}`).emit(event, message);
  return true;
}

/**
 * Broadcast run status change: 'QUEUED' | 'RUNNING' | 'SUCCESS' | 'FAILED' | 'CANCELED'
 */
export async function emitDashboardRunStatus(projectId, { snapshotId, jobId, pillar, status }) {
  return emitDashboardEvent(projectId, "dashboard:run-status", {
    snapshotId,
    jobId,
    pillar,
    status,
  });
}

/**
 * Broadcast job progress (throttled to avoid flooding the socket channel)
 */
export async function emitDashboardJobProgress(projectId, { snapshotId, jobId, pillar, progress, stage }) {
  const key = `${jobId}`;
  const now = Date.now();
  const last = lastProgressEmitted.get(key) || 0;

  // Throttle intermediate progress emissions (unless starting 0% or completed 100%)
  if (progress > 0 && progress < 100 && now - last < 400) {
    return false;
  }

  lastProgressEmitted.set(key, now);
  if (progress >= 100) {
    lastProgressEmitted.delete(key);
  }

  return emitDashboardEvent(projectId, "dashboard:job-progress", {
    snapshotId,
    jobId,
    pillar,
    progress,
    stage,
  });
}

/**
 * Broadcast a notification that metrics/test runs changed, prompting client React Query invalidation
 */
export async function emitDashboardMetricsUpdated(projectId, { snapshotId, reason = "metrics-updated", testRunId = null }) {
  return emitDashboardEvent(projectId, "dashboard:metrics-updated", {
    snapshotId,
    reason,
    testRunId,
  });
}

export default {
  resolveProjectIdFromSnapshot,
  emitDashboardEvent,
  emitDashboardRunStatus,
  emitDashboardJobProgress,
  emitDashboardMetricsUpdated,
};

