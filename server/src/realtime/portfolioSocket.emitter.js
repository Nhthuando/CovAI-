/**
 * @file portfolioSocket.emitter.js
 * @description Real-time Socket.IO emitter for the Multi-Project Portfolio Dashboard.
 * Broadcasts throttled test run progress, run completion, and project status mutations
 * to user rooms and project subscribers.
 */

import { invalidatePortfolioCache } from "../services/portfolioDashboard.service.js";

function getIo() {
  return global.io || null;
}

/**
 * Emit when a test run is scheduled/started
 */
export function emitPortfolioRunStarted({
  projectId,
  snapshotId,
  jobId,
  jobType,
  pillar = "unit",
  userId = null,
}) {
  const io = getIo();
  if (!io) return;

  const payload = {
    projectId,
    snapshotId,
    jobId,
    jobType,
    pillar,
    status: "RUNNING",
    progress: 0,
    startedAt: new Date().toISOString(),
  };

  if (userId) {
    io.to(`user:${userId}`).emit("portfolio:run_started", payload);
  }
  io.to(`project:${projectId}`).emit("portfolio:run_started", payload);
  invalidatePortfolioCache(userId);
}

/**
 * Emit throttled progress during test execution (e.g. 25%, 50%, 75%)
 */
export function emitPortfolioRunProgress({
  projectId,
  snapshotId,
  jobId,
  jobType,
  pillar = "unit",
  progress = 0,
  elapsedMs = 0,
  activeWorkers = 3,
  queuedJobs = 0,
  userId = null,
}) {
  const io = getIo();
  if (!io) return;

  const payload = {
    projectId,
    snapshotId,
    jobId,
    jobType,
    pillar,
    progress: Math.min(100, Math.max(0, Number(progress) || 0)),
    elapsedMs,
    activeWorkers,
    queuedJobs,
  };

  if (userId) {
    io.to(`user:${userId}`).emit("portfolio:run_progress", payload);
  }
  io.to(`project:${projectId}`).emit("portfolio:run_progress", payload);
}

/**
 * Emit when a test run completes (success or failure)
 */
export function emitPortfolioRunCompleted({
  projectId,
  snapshotId,
  jobId,
  jobType,
  pillar = "unit",
  status = "SUCCESS",
  durationMs = 0,
  userId = null,
  newFeedItem = null,
}) {
  const io = getIo();
  if (!io) return;

  const payload = {
    projectId,
    snapshotId,
    jobId,
    jobType,
    pillar,
    status,
    durationMs,
    completedAt: new Date().toISOString(),
    newFeedItem,
  };

  if (userId) {
    io.to(`user:${userId}`).emit("portfolio:run_completed", payload);
  }
  io.to(`project:${projectId}`).emit("portfolio:run_completed", payload);
  invalidatePortfolioCache(userId);
}

/**
 * Emit when a project lifecycle status, pin status, or metadata is updated
 */
export function emitPortfolioProjectUpdated({
  projectId,
  userId = null,
  lifecycleStatus = null,
  isPinned = null,
  action = "UPDATED",
}) {
  const io = getIo();
  if (!io) return;

  const payload = {
    projectId,
    lifecycleStatus,
    isPinned,
    action,
    updatedAt: new Date().toISOString(),
  };

  if (userId) {
    io.to(`user:${userId}`).emit("portfolio:project_updated", payload);
  }
  io.to(`project:${projectId}`).emit("portfolio:project_updated", payload);
  invalidatePortfolioCache(userId);
}

