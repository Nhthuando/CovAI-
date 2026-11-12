import React, { useState, useEffect, useCallback } from "react";
import {
  Layers,
  RotateCcw,
  Trash2,
  Pause,
  Play,
  AlertTriangle,
  CheckCircle2,
  Clock,
  RefreshCw,
  HelpCircle,
  FileCode,
} from "lucide-react";
import { TelemetryWidget } from "../../components/admin/TelemetryWidget.jsx";
import { DangerousActionModal } from "../../components/admin/DangerousActionModal.jsx";
import { adminService } from "../../services/admin.service.js";
import { useAdminSocket } from "../../hooks/useAdminSocket.js";

/**
 * AdminQueueConsole — BullMQ Job & Worker Orchestration
 */
export default function AdminQueueConsole() {
  const [queueData, setQueueData] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isActing, setIsActing] = useState(false);
  const [isPurgeModalOpen, setIsPurgeModalOpen] = useState(false);
  const [selectedError, setSelectedError] = useState(null);

  // Real-time queue stream via WebSocket
  const { latestQueueUpdate } = useAdminSocket();

  useEffect(() => {
    if (latestQueueUpdate) {
      setQueueData(latestQueueUpdate);
    }
  }, [latestQueueUpdate]);

  const fetchQueues = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await adminService.getQueuesStatus();
      setQueueData(res);
    } catch (err) {
      console.error("[AdminQueueConsole] Error fetching queues:", err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchQueues();
    const interval = setInterval(fetchQueues, 10000);
    return () => clearInterval(interval);
  }, [fetchQueues]);

  const mainQueue = queueData?.queues?.[0] || {
    name: "covai-jobs-main",
    isPaused: false,
    counts: { active: 0, waiting: 0, completed: 0, failed: 0, delayed: 0, total: 0 },
    recentFailed: [],
  };

  const queueCounts = mainQueue.counts || {
    active: 0,
    waiting: 0,
    completed: 0,
    failed: 0,
    delayed: 0,
    total: 0,
  };

  // Retry all failed jobs
  const handleRetryAll = async () => {
    if (!window.confirm("Retry all failed BullMQ jobs in this queue?")) return;
    setIsActing(true);
    try {
      const res = await adminService.retryAllFailedJobs(mainQueue.name);
      alert(`Retried ${res.retriedCount} job(s).`);
      fetchQueues();
    } catch (err) {
      alert(`Retry failed: ${err.message}`);
    } finally {
      setIsActing(false);
    }
  };

  // Pause / Resume toggle
  const handleTogglePause = async () => {
    setIsActing(true);
    try {
      if (mainQueue.isPaused) {
        await adminService.resumeQueue(mainQueue.name);
      } else {
        await adminService.pauseQueue(mainQueue.name);
      }
      fetchQueues();
    } catch (err) {
      alert(`Toggle queue failed: ${err.message}`);
    } finally {
      setIsActing(false);
    }
  };

  // Purge dead letter jobs
  const handlePurge = async () => {
    setIsActing(true);
    try {
      const res = await adminService.purgeQueue(mainQueue.name, "failed");
      setIsPurgeModalOpen(false);
      alert(`Purged ${res.purgedCount} failed jobs.`);
      fetchQueues();
    } catch (err) {
      alert(`Purge failed: ${err.message}`);
    } finally {
      setIsActing(false);
    }
  };

  return (
    <div className="p-6 h-full flex flex-col space-y-6 max-w-[1600px] mx-auto overflow-y-auto">
      {/* 1. Header Toolbar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-[var(--admin-border-subtle)] flex-shrink-0">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold tracking-tight text-[var(--admin-text-high)]">
              BullMQ Job Orchestrator
            </h1>
            <span
              className={`px-2 py-0.5 rounded text-[11px] font-mono font-bold uppercase tracking-wider border ${
                mainQueue.isPaused
                  ? "bg-[var(--admin-status-warning-muted)] text-[var(--admin-status-warning)] border-[var(--admin-status-warning)]/40"
                  : "bg-[var(--admin-accent-primary-muted)] text-[var(--admin-accent-primary)] border-[var(--admin-border-accent)]"
              }`}
            >
              {mainQueue.isPaused ? "PAUSED" : "ACTIVE"}
            </span>
          </div>
          <p className="text-xs text-[var(--admin-text-medium)] mt-1">
            Manage worker concurrency, monitor queue backpressure, retry failed runner tasks, and purge dead-letters.
          </p>
        </div>

        {/* Global Action Controls */}
        <div className="flex items-center gap-2.5 flex-wrap">
          <button
            type="button"
            disabled={isActing}
            onClick={handleTogglePause}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded bg-[var(--admin-surface-raised)] text-[var(--admin-text-high)] hover:bg-[var(--admin-surface-overlay)] border border-[var(--admin-border-strong)] transition-colors admin-tactile-btn cursor-pointer"
          >
            {mainQueue.isPaused ? <Play size={13} /> : <Pause size={13} />}
            <span>{mainQueue.isPaused ? "Resume Queue" : "Pause Queue"}</span>
          </button>

          <button
            type="button"
            disabled={isActing || queueCounts.failed === 0}
            onClick={handleRetryAll}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded bg-[var(--admin-accent-primary-muted)] text-[var(--admin-accent-primary)] hover:bg-[var(--admin-accent-primary)] hover:text-black border border-[var(--admin-border-accent)] transition-all admin-tactile-btn cursor-pointer disabled:opacity-40"
          >
            <RotateCcw size={13} />
            <span>Retry Failed ({queueCounts.failed})</span>
          </button>

          <button
            type="button"
            disabled={isActing || queueCounts.failed === 0}
            onClick={() => setIsPurgeModalOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded bg-[var(--admin-status-danger-muted)] text-[var(--admin-status-danger)] hover:bg-[var(--admin-status-danger)] hover:text-white border border-[var(--admin-status-danger)]/40 transition-colors admin-tactile-btn cursor-pointer disabled:opacity-40"
          >
            <Trash2 size={13} />
            <span>Purge Failed</span>
          </button>

          <button
            type="button"
            onClick={fetchQueues}
            disabled={isLoading}
            className="p-2 rounded bg-[var(--admin-surface-raised)] text-[var(--admin-text-medium)] hover:text-[var(--admin-text-high)] border border-[var(--admin-border-subtle)] transition-colors"
            title="Refresh Queues"
          >
            <RefreshCw size={13} className={isLoading ? "animate-spin" : ""} />
          </button>
        </div>
      </div>

      {/* 2. Queue Status Breakdown Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <div className="p-4 rounded-lg bg-[var(--admin-surface-raised)] border border-[var(--admin-border-subtle)] flex flex-col justify-between">
          <span className="text-[11px] font-semibold text-[var(--admin-text-medium)] uppercase">
            Active Running
          </span>
          <div className="text-2xl font-bold font-mono text-[var(--admin-accent-telemetry)] mt-1">
            {queueCounts.active}
          </div>
          <span className="text-[10px] text-[var(--admin-text-low)] mt-1">Workers busy</span>
        </div>

        <div className="p-4 rounded-lg bg-[var(--admin-surface-raised)] border border-[var(--admin-border-subtle)] flex flex-col justify-between">
          <span className="text-[11px] font-semibold text-[var(--admin-text-medium)] uppercase">
            Waiting in Line
          </span>
          <div className="text-2xl font-bold font-mono text-[var(--admin-text-high)] mt-1">
            {queueCounts.waiting}
          </div>
          <span className="text-[10px] text-[var(--admin-text-low)] mt-1">Pending dispatch</span>
        </div>

        <div className="p-4 rounded-lg bg-[var(--admin-surface-raised)] border border-[var(--admin-border-subtle)] flex flex-col justify-between">
          <span className="text-[11px] font-semibold text-[var(--admin-text-medium)] uppercase">
            Completed
          </span>
          <div className="text-2xl font-bold font-mono text-[var(--admin-accent-primary)] mt-1">
            {queueCounts.completed.toLocaleString()}
          </div>
          <span className="text-[10px] text-[var(--admin-text-low)] mt-1">Finished clean</span>
        </div>

        <div className="p-4 rounded-lg bg-[var(--admin-surface-raised)] border border-[var(--admin-border-subtle)] flex flex-col justify-between">
          <span className="text-[11px] font-semibold text-[var(--admin-text-medium)] uppercase">
            Failed / Dead
          </span>
          <div className="text-2xl font-bold font-mono text-[var(--admin-status-danger)] mt-1">
            {queueCounts.failed}
          </div>
          <span className="text-[10px] text-[var(--admin-text-low)] mt-1">Need attention</span>
        </div>

        <div className="p-4 rounded-lg bg-[var(--admin-surface-raised)] border border-[var(--admin-border-subtle)] flex flex-col justify-between">
          <span className="text-[11px] font-semibold text-[var(--admin-text-medium)] uppercase">
            Delayed
          </span>
          <div className="text-2xl font-bold font-mono text-[var(--admin-status-warning)] mt-1">
            {queueCounts.delayed}
          </div>
          <span className="text-[10px] text-[var(--admin-text-low)] mt-1">Scheduled retry</span>
        </div>

        <div className="p-4 rounded-lg bg-[var(--admin-surface-raised)] border border-[var(--admin-border-subtle)] flex flex-col justify-between">
          <span className="text-[11px] font-semibold text-[var(--admin-text-medium)] uppercase">
            Total Ingestion
          </span>
          <div className="text-2xl font-bold font-mono text-[var(--admin-text-high)] mt-1">
            {queueCounts.total.toLocaleString()}
          </div>
          <span className="text-[10px] text-[var(--admin-text-low)] mt-1">Lifetime queue jobs</span>
        </div>
      </div>

      {/* 3. Recent Failed Jobs Diagnostic Table */}
      <div className="p-5 rounded-lg bg-[var(--admin-surface-raised)] border border-[var(--admin-border-subtle)] space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertTriangle size={15} className="text-[var(--admin-status-danger)]" />
            <h2 className="text-xs font-bold uppercase tracking-wider text-[var(--admin-text-high)]">
              Diagnostic Log: Recent Failed Jobs ({mainQueue.recentFailed?.length || 0})
            </h2>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead className="bg-[var(--admin-surface-overlay)] border-b border-[var(--admin-border-strong)] text-[10px] font-mono uppercase text-[var(--admin-text-medium)]">
              <tr>
                <th className="py-2.5 px-4 w-28">Job ID</th>
                <th className="py-2.5 px-4">Task Name</th>
                <th className="py-2.5 px-4 w-24 text-center">Attempts</th>
                <th className="py-2.5 px-4">Failure Reason</th>
                <th className="py-2.5 px-4 w-40">Failed At</th>
                <th className="py-2.5 px-4 w-24 text-right">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--admin-border-subtle)] font-mono text-[11px]">
              {!mainQueue.recentFailed || mainQueue.recentFailed.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-[var(--admin-text-medium)]">
                    <div className="flex flex-col items-center justify-center gap-1.5 text-xs">
                      <CheckCircle2 size={18} className="text-[var(--admin-accent-primary)]" />
                      <span>Zero failed jobs in current queue buffer.</span>
                    </div>
                  </td>
                </tr>
              ) : (
                mainQueue.recentFailed.map((job) => (
                  <tr key={job.id} className="hover:bg-[var(--admin-surface-base)] transition-colors">
                    <td className="py-2.5 px-4 text-[var(--admin-accent-telemetry)] font-bold">
                      #{job.id}
                    </td>
                    <td className="py-2.5 px-4 text-[var(--admin-text-high)] font-sans">
                      {job.name || "UNNAMED_TASK"}
                    </td>
                    <td className="py-2.5 px-4 text-center text-[var(--admin-status-warning)]">
                      {job.attemptsMade}
                    </td>
                    <td className="py-2.5 px-4 text-[var(--admin-status-danger)] truncate max-w-[320px]">
                      {job.failedReason || "Unknown Worker Crash"}
                    </td>
                    <td className="py-2.5 px-4 text-[var(--admin-text-low)]">
                      {job.finishedOn ? new Date(job.finishedOn).toLocaleTimeString() : "—"}
                    </td>
                    <td className="py-2.5 px-4 text-right">
                      <button
                        type="button"
                        onClick={() => setSelectedError(job)}
                        className="text-[11px] text-[var(--admin-accent-primary)] hover:underline"
                      >
                        Inspect
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Error Details Modal */}
      {selectedError && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-xs">
          <div className="w-full max-w-lg rounded-lg bg-[var(--admin-surface-raised)] border border-[var(--admin-border-strong)] p-5 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-[var(--admin-border-subtle)] pb-3">
              <span className="text-sm font-bold font-mono text-[var(--admin-status-danger)]">
                Job Failure Inspection: #{selectedError.id}
              </span>
              <button
                type="button"
                onClick={() => setSelectedError(null)}
                className="text-xs text-[var(--admin-text-medium)] hover:text-white"
              >
                Close
              </button>
            </div>

            <div className="space-y-3 text-xs font-mono">
              <div>
                <span className="text-[var(--admin-text-medium)] block mb-1">Reason:</span>
                <div className="p-2.5 rounded bg-[var(--admin-status-danger-muted)] text-[var(--admin-status-danger)] border border-[var(--admin-status-danger)]/30">
                  {selectedError.failedReason || "No error reason provided."}
                </div>
              </div>

              <div>
                <span className="text-[var(--admin-text-medium)] block mb-1">Payload:</span>
                <pre className="p-2.5 rounded bg-[var(--admin-surface-base)] text-[var(--admin-text-high)] max-h-48 overflow-y-auto">
                  {JSON.stringify(selectedError.data, null, 2)}
                </pre>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Purge Modal */}
      <DangerousActionModal
        isOpen={isPurgeModalOpen}
        onClose={() => setIsPurgeModalOpen(false)}
        onConfirm={handlePurge}
        title="Purge Dead Letter Queue"
        description="This will permanently delete all failed jobs currently stored in the BullMQ Redis store. You will not be able to inspect or retry these jobs afterwards."
        confirmTargetName="PURGE FAILED"
        itemCount={queueCounts.failed}
        isProcessing={isActing}
      />
    </div>
  );
}
