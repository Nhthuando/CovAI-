import React, { useState, useEffect, useCallback } from "react";
import {
  FileText,
  Search,
  Filter,
  RefreshCw,
  Eye,
  ChevronLeft,
  ChevronRight,
  Shield,
  Clock,
  ArrowRight,
} from "lucide-react";
import { adminService } from "../../services/admin.service.js";

/**
 * AdminAuditLogsView — Immutable Security & Governance Audit Trail
 */
export default function AdminAuditLogsView() {
  const [logs, setLogs] = useState([]);
  const [meta, setMeta] = useState({ page: 1, limit: 20, total: 0, totalPages: 1 });
  const [targetModelFilter, setTargetModelFilter] = useState("");
  const [actionFilter, setActionFilter] = useState("");
  const [actorIdFilter, setActorIdFilter] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [inspectingDiff, setInspectingDiff] = useState(null);

  const fetchLogs = useCallback(
    async (pageToLoad = meta.page) => {
      setIsLoading(true);
      try {
        const res = await adminService.listAuditLogs({
          page: pageToLoad,
          limit: meta.limit,
          targetModel: targetModelFilter || undefined,
          action: actionFilter || undefined,
          actorId: actorIdFilter || undefined,
        });

        setLogs(res.auditLogs || []);
        setMeta(res.meta || { page: 1, limit: 20, total: 0, totalPages: 1 });
      } catch (err) {
        console.error("[AdminAuditLogsView] Error loading audit logs:", err);
      } finally {
        setIsLoading(false);
      }
    },
    [meta.limit, meta.page, targetModelFilter, actionFilter, actorIdFilter]
  );

  useEffect(() => {
    fetchLogs(1);
  }, [targetModelFilter, actionFilter]);

  const handleFilterSubmit = (e) => {
    e.preventDefault();
    fetchLogs(1);
  };

  return (
    <div className="p-6 h-full flex flex-col space-y-4 max-w-[1600px] mx-auto overflow-hidden">
      {/* 1. Header & Filters */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-[var(--admin-border-subtle)] flex-shrink-0">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold tracking-tight text-[var(--admin-text-high)]">
              Security & Audit Trail
            </h1>
            <span className="px-2 py-0.5 rounded text-[11px] font-mono bg-[var(--admin-surface-raised)] border border-[var(--admin-border-subtle)] text-[var(--admin-accent-telemetry)]">
              {meta.total} Entries
            </span>
          </div>
          <p className="text-xs text-[var(--admin-text-medium)] mt-1">
            Tamper-proof record of every mutation, role escalation, data export, and infrastructure intervention.
          </p>
        </div>

        {/* Filter Controls */}
        <div className="flex items-center gap-2.5 flex-wrap">
          {/* Action Filter */}
          <select
            value={actionFilter}
            onChange={(e) => setActionFilter(e.target.value)}
            className="px-2.5 py-1.5 text-xs rounded bg-[var(--admin-surface-raised)] border border-[var(--admin-border-strong)] text-[var(--admin-text-high)] font-mono focus:outline-none"
          >
            <option value="">All Actions</option>
            <option value="CREATE">CREATE</option>
            <option value="UPDATE">UPDATE</option>
            <option value="DELETE">DELETE</option>
            <option value="BATCH_DELETE">BATCH_DELETE</option>
            <option value="BATCH_UPDATE">BATCH_UPDATE</option>
            <option value="ROLE_CHANGE">ROLE_CHANGE</option>
            <option value="SUSPEND_USER">SUSPEND_USER</option>
            <option value="RESET_QUOTA">RESET_QUOTA</option>
            <option value="RETRY_FAILED_JOBS">RETRY_FAILED_JOBS</option>
            <option value="PURGE_QUEUE">PURGE_QUEUE</option>
            <option value="CLEANUP_TEMP_FILES">CLEANUP_TEMP_FILES</option>
          </select>

          {/* Model Filter */}
          <input
            type="text"
            value={targetModelFilter}
            onChange={(e) => setTargetModelFilter(e.target.value)}
            placeholder="Target Model (e.g. User)..."
            className="px-3 py-1.5 text-xs font-mono rounded bg-[var(--admin-surface-raised)] border border-[var(--admin-border-strong)] text-[var(--admin-text-high)] focus:outline-none focus:border-[var(--admin-accent-primary)] w-44"
          />

          <button
            type="button"
            onClick={() => fetchLogs()}
            disabled={isLoading}
            className="p-2 rounded bg-[var(--admin-surface-raised)] text-[var(--admin-text-medium)] hover:text-[var(--admin-text-high)] border border-[var(--admin-border-subtle)] transition-colors"
            title="Reload Logs"
          >
            <RefreshCw size={13} className={isLoading ? "animate-spin" : ""} />
          </button>
        </div>
      </div>

      {/* 2. Audit Trail Table */}
      <div className="flex-1 overflow-auto rounded-lg border border-[var(--admin-border-subtle)] bg-[var(--admin-surface-base)] relative">
        <table className="w-full border-collapse text-left text-xs table-fixed">
          <thead className="sticky top-0 z-10 bg-[var(--admin-surface-raised)] border-b border-[var(--admin-border-strong)] text-[11px] font-semibold text-[var(--admin-text-medium)] uppercase tracking-wider font-mono">
            <tr>
              <th className="py-2.5 px-4 w-[160px]">Timestamp</th>
              <th className="py-2.5 px-3 w-[200px]">Actor</th>
              <th className="py-2.5 px-3 w-[150px]">Action</th>
              <th className="py-2.5 px-3 w-[150px]">Target Model</th>
              <th className="py-2.5 px-3 w-[220px]">Target ID</th>
              <th className="py-2.5 px-3 w-[140px]">IP / Client</th>
              <th className="py-2.5 px-4 w-[100px] text-right">State Diff</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--admin-border-subtle)] font-mono text-[11px]">
            {isLoading ? (
              Array.from({ length: 8 }).map((_, idx) => (
                <tr key={`skel-${idx}`} className="animate-pulse">
                  <td colSpan={7} className="py-3 px-4 bg-[var(--admin-surface-base)]">
                    <div className="h-4 bg-[var(--admin-surface-overlay)] rounded w-full" />
                  </td>
                </tr>
              ))
            ) : logs.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-16 text-center text-xs text-[var(--admin-text-medium)]">
                  No audit log entries recorded.
                </td>
              </tr>
            ) : (
              logs.map((log) => {
                const hasDiff = log.beforeSnapshot || log.afterSnapshot || log.diff;

                return (
                  <tr key={log.id} className="hover:bg-[var(--admin-surface-raised)]/60 transition-colors">
                    {/* Timestamp */}
                    <td className="py-2.5 px-4 text-[var(--admin-text-medium)] truncate">
                      {new Date(log.createdAt).toLocaleString()}
                    </td>

                    {/* Actor */}
                    <td className="py-2.5 px-3 text-[var(--admin-text-high)] font-bold truncate">
                      {log.actor?.email || log.actorId || "SYSTEM"}
                    </td>

                    {/* Action */}
                    <td className="py-2.5 px-3">
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-[var(--admin-surface-raised)] text-[var(--admin-accent-primary)] border border-[var(--admin-border-subtle)]">
                        {log.action}
                      </span>
                    </td>

                    {/* Target Model */}
                    <td className="py-2.5 px-3 text-[var(--admin-accent-telemetry)] truncate">
                      {log.targetModel}
                    </td>

                    {/* Target ID */}
                    <td className="py-2.5 px-3 text-[var(--admin-text-low)] truncate" title={log.targetId}>
                      {log.targetId || "—"}
                    </td>

                    {/* IP / User Agent */}
                    <td className="py-2.5 px-3 text-[var(--admin-text-low)] truncate" title={log.ipAddress}>
                      {log.ipAddress || "127.0.0.1"}
                    </td>

                    {/* State Diff */}
                    <td className="py-2.5 px-4 text-right">
                      {hasDiff ? (
                        <button
                          type="button"
                          onClick={() => setInspectingDiff(log)}
                          className="inline-flex items-center gap-1 text-[11px] text-[var(--admin-accent-primary)] hover:underline"
                        >
                          <Eye size={12} />
                          <span>View Diff</span>
                        </button>
                      ) : (
                        <span className="text-[var(--admin-text-low)]">—</span>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* 3. Pagination Footer */}
      <div className="flex items-center justify-between px-3 py-2 rounded-md bg-[var(--admin-surface-raised)] border border-[var(--admin-border-subtle)] text-xs flex-shrink-0">
        <div className="flex items-center gap-3 text-[var(--admin-text-medium)] font-mono text-[11px]">
          <span>
            Page <span className="text-[var(--admin-text-high)] font-bold">{meta.page}</span> of{" "}
            <span className="text-[var(--admin-text-high)] font-bold">{meta.totalPages}</span>
          </span>
          <span>·</span>
          <span>
            Total: <span className="text-[var(--admin-accent-primary)] font-bold">{meta.total}</span> events
          </span>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={meta.page <= 1 || isLoading}
            onClick={() => fetchLogs(meta.page - 1)}
            className="flex items-center gap-1 px-2.5 py-1 rounded bg-[var(--admin-surface-base)] border border-[var(--admin-border-subtle)] text-[var(--admin-text-medium)] hover:text-[var(--admin-text-high)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <ChevronLeft size={13} />
            <span>Prev</span>
          </button>
          <button
            type="button"
            disabled={meta.page >= meta.totalPages || isLoading}
            onClick={() => fetchLogs(meta.page + 1)}
            className="flex items-center gap-1 px-2.5 py-1 rounded bg-[var(--admin-surface-base)] border border-[var(--admin-border-subtle)] text-[var(--admin-text-medium)] hover:text-[var(--admin-text-high)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <span>Next</span>
            <ChevronRight size={13} />
          </button>
        </div>
      </div>

      {/* 4. Diff Inspection Modal */}
      {inspectingDiff && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-xs">
          <div className="w-full max-w-4xl max-h-[85vh] rounded-lg bg-[var(--admin-surface-raised)] border border-[var(--admin-border-strong)] flex flex-col shadow-2xl overflow-hidden">
            {/* Modal Header */}
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-[var(--admin-border-subtle)] bg-[var(--admin-surface-overlay)]">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold font-mono px-2 py-0.5 rounded bg-[var(--admin-accent-primary-muted)] text-[var(--admin-accent-primary)] border border-[var(--admin-border-accent)]">
                  {inspectingDiff.action}
                </span>
                <span className="text-sm font-semibold text-[var(--admin-text-high)]">
                  {inspectingDiff.targetModel} #{inspectingDiff.targetId || "N/A"}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setInspectingDiff(null)}
                className="text-xs text-[var(--admin-text-medium)] hover:text-white"
              >
                Close (ESC)
              </button>
            </div>

            {/* Modal Diff Body */}
            <div className="flex-1 overflow-y-auto p-5 grid grid-cols-1 md:grid-cols-2 gap-4 text-xs font-mono">
              {/* Before Snapshot */}
              <div className="space-y-2">
                <div className="flex items-center justify-between text-[11px] text-[var(--admin-status-danger)] font-bold">
                  <span>BEFORE MUTATION</span>
                  <span className="text-[10px] text-[var(--admin-text-low)]">Historical state</span>
                </div>
                <pre className="p-3 rounded bg-[var(--admin-surface-base)] border border-[var(--admin-border-subtle)] text-[var(--admin-text-medium)] max-h-96 overflow-auto">
                  {inspectingDiff.beforeSnapshot
                    ? JSON.stringify(inspectingDiff.beforeSnapshot, null, 2)
                    : "null (Created or Action-only)"}
                </pre>
              </div>

              {/* After Snapshot */}
              <div className="space-y-2">
                <div className="flex items-center justify-between text-[11px] text-[var(--admin-accent-primary)] font-bold">
                  <span>AFTER MUTATION</span>
                  <span className="text-[10px] text-[var(--admin-text-low)]">Committed state</span>
                </div>
                <pre className="p-3 rounded bg-[var(--admin-surface-base)] border border-[var(--admin-border-subtle)] text-[var(--admin-text-high)] max-h-96 overflow-auto">
                  {inspectingDiff.afterSnapshot
                    ? JSON.stringify(inspectingDiff.afterSnapshot, null, 2)
                    : "null (Deleted)"}
                </pre>
              </div>
            </div>

            {/* Footer */}
            <div className="px-5 py-3 border-t border-[var(--admin-border-subtle)] bg-[var(--admin-surface-base)] text-[11px] font-mono text-[var(--admin-text-low)] flex items-center justify-between">
              <span>Actor: {inspectingDiff.actor?.email || inspectingDiff.actorId || "SYSTEM"}</span>
              <span>Time: {new Date(inspectingDiff.createdAt).toISOString()}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
