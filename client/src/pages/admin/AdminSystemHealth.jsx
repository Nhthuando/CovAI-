import React, { useState, useEffect, useCallback } from "react";
import {
  Activity,
  Database,
  Server,
  HardDrive,
  Trash2,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Cpu,
  Layers,
  Sparkles,
} from "lucide-react";
import { TelemetryWidget } from "../../components/admin/TelemetryWidget.jsx";
import { adminService } from "../../services/admin.service.js";

/**
 * AdminSystemHealth — Infrastructure & Telemetry Monitor
 */
export default function AdminSystemHealth() {
  const [health, setHealth] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isCleaning, setIsCleaning] = useState(false);
  const [maxAgeHours, setMaxAgeHours] = useState(2);
  const [cleanupResult, setCleanupResult] = useState(null);

  const fetchHealth = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await adminService.getHealthOverview();
      setHealth(res);
    } catch (err) {
      console.error("[AdminSystemHealth] Error fetching health:", err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchHealth();
    const interval = setInterval(fetchHealth, 15000);
    return () => clearInterval(interval);
  }, [fetchHealth]);

  const handleCleanupTemp = async () => {
    if (!window.confirm(`Clean up temporary test runners older than ${maxAgeHours} hours?`)) return;
    setIsCleaning(true);
    try {
      const res = await adminService.cleanupTempWorkspace(maxAgeHours);
      setCleanupResult(res);
      fetchHealth();
    } catch (err) {
      alert(`Cleanup failed: ${err.message}`);
    } finally {
      setIsCleaning(false);
    }
  };

  const isDbHealthy = health?.postgres?.status === "HEALTHY";
  const memory = health?.runtime?.memory || {};
  const temp = health?.tempStorage || {};

  return (
    <div className="p-6 h-full flex flex-col space-y-6 max-w-[1600px] mx-auto overflow-y-auto">
      {/* 1. Header Toolbar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-[var(--admin-border-subtle)] flex-shrink-0">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold tracking-tight text-[var(--admin-text-high)]">
              Infrastructure Telemetry & Health
            </h1>
            <span
              className={`px-2 py-0.5 rounded text-[11px] font-mono font-bold uppercase tracking-wider border ${
                health?.status === "HEALTHY"
                  ? "bg-[var(--admin-accent-primary-muted)] text-[var(--admin-accent-primary)] border-[var(--admin-border-accent)]"
                  : "bg-[var(--admin-status-danger-muted)] text-[var(--admin-status-danger)] border-[var(--admin-status-danger)]/40"
              }`}
            >
              {health?.status || "PENDING"}
            </span>
          </div>
          <p className="text-xs text-[var(--admin-text-medium)] mt-1">
            Real-time ping round-trips to remote PostgreSQL, Node.js process heap memory, and disk maintenance.
          </p>
        </div>

        <button
          type="button"
          onClick={fetchHealth}
          disabled={isLoading}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded bg-[var(--admin-surface-raised)] text-[var(--admin-text-high)] hover:bg-[var(--admin-surface-overlay)] border border-[var(--admin-border-strong)] transition-colors admin-tactile-btn cursor-pointer"
        >
          <RefreshCw size={13} className={isLoading ? "animate-spin" : ""} />
          <span>Ping System</span>
        </button>
      </div>

      {/* 2. Top Telemetry Metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <TelemetryWidget
          title="PostgreSQL Latency"
          value={health?.postgres?.latencyMs >= 0 ? `${health.postgres.latencyMs}` : "FAIL"}
          unit="ms"
          status={isDbHealthy ? "healthy" : "danger"}
          icon={Database}
          trendData={[180, 220, 260, 240, 280, health?.postgres?.latencyMs || 250]}
          footerNote="Railway Gondola Host"
        />

        <TelemetryWidget
          title="Node Process Memory"
          value={`${memory.rssMb || 0}`}
          unit="MB RSS"
          status={memory.rssMb > 800 ? "warning" : "healthy"}
          icon={Server}
          trendData={[80, 95, 110, 125, 135, memory.rssMb || 140]}
          footerNote={`Heap: ${memory.heapUsedMb || 0} MB`}
        />

        <TelemetryWidget
          title="Runtime Uptime"
          value={
            health?.runtime?.uptimeSeconds
              ? `${Math.floor(health.runtime.uptimeSeconds / 3600)}h ${Math.floor((health.runtime.uptimeSeconds % 3600) / 60)}m`
              : "0m"
          }
          status="healthy"
          icon={Clock}
          footerNote={`PID: ${health?.runtime?.pid || "—"}`}
        />

        <TelemetryWidget
          title="Temp Runner Disk"
          value={`${temp.totalSizeMb || 0}`}
          unit="MB"
          status={parseFloat(temp.totalSizeMb || 0) > 1000 ? "warning" : "healthy"}
          icon={HardDrive}
          footerNote={`${temp.totalFolders || 0} workspaces`}
        />
      </div>

      {/* 3. Deep Telemetry Panels */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Node.js Memory Breakdown */}
        <div className="p-5 rounded-lg bg-[var(--admin-surface-raised)] border border-[var(--admin-border-subtle)] space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Cpu size={16} className="text-[var(--admin-accent-primary)]" />
              <h2 className="text-xs font-bold uppercase tracking-wider text-[var(--admin-text-high)]">
                Node.js Memory Allocation
              </h2>
            </div>
            <span className="font-mono text-xs text-[var(--admin-accent-telemetry)]">
              {health?.runtime?.nodeVersion ? `Node ${health?.runtime?.nodeVersion}` : "Node.js Runtime"}
            </span>
          </div>

          <div className="space-y-3 font-mono text-xs">
            <div>
              <div className="flex items-center justify-between text-[11px] mb-1">
                <span className="text-[var(--admin-text-medium)]">Heap Usage (Used / Total)</span>
                <span className="text-[var(--admin-text-high)] font-bold">
                  {memory.heapUsedMb || 0} MB / {memory.heapTotalMb || 0} MB
                </span>
              </div>
              <div className="w-full h-2 rounded-full bg-[var(--admin-surface-base)] overflow-hidden border border-[var(--admin-border-subtle)]">
                <div
                  className="h-full bg-[var(--admin-accent-primary)] transition-all duration-300"
                  style={{
                    width: `${Math.min(
                      100,
                      Math.round(((memory.heapUsedMb || 1) / (memory.heapTotalMb || 1)) * 100)
                    )}%`,
                  }}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 pt-2">
              <div className="p-3 rounded bg-[var(--admin-surface-base)] border border-[var(--admin-border-subtle)]">
                <span className="text-[10px] text-[var(--admin-text-low)] uppercase block">Resident Set Size (RSS)</span>
                <span className="text-base font-bold text-[var(--admin-text-high)] mt-1 block">
                  {memory.rssMb || 0} MB
                </span>
              </div>

              <div className="p-3 rounded bg-[var(--admin-surface-base)] border border-[var(--admin-border-subtle)]">
                <span className="text-[10px] text-[var(--admin-text-low)] uppercase block">External C++ Memory</span>
                <span className="text-base font-bold text-[var(--admin-text-high)] mt-1 block">
                  {memory.externalMb || 0} MB
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Temporary Sandbox Maintenance */}
        <div className="p-5 rounded-lg bg-[var(--admin-surface-raised)] border border-[var(--admin-border-subtle)] space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <HardDrive size={16} className="text-[var(--admin-accent-telemetry)]" />
              <h2 className="text-xs font-bold uppercase tracking-wider text-[var(--admin-text-high)]">
                Runner Workspace Maintenance
              </h2>
            </div>
            <span className="font-mono text-xs text-[var(--admin-text-low)]">
              server/.covai-temp/
            </span>
          </div>

          <p className="text-xs text-[var(--admin-text-medium)]">
            Docker runners and code operations create temporary sandboxes. Clean up old workspaces to reclaim disk storage.
          </p>

          <div className="grid grid-cols-3 gap-2 text-xs font-mono">
            <div className="p-2.5 rounded bg-[var(--admin-surface-base)] border border-[var(--admin-border-subtle)]">
              <span className="text-[10px] text-[var(--admin-text-low)] block">Disk Used</span>
              <span className="text-sm font-bold text-[var(--admin-text-high)]">
                {temp.totalSizeMb || 0} MB
              </span>
            </div>
            <div className="p-2.5 rounded bg-[var(--admin-surface-base)] border border-[var(--admin-border-subtle)]">
              <span className="text-[10px] text-[var(--admin-text-low)] block">Folders</span>
              <span className="text-sm font-bold text-[var(--admin-text-high)]">
                {temp.totalFolders || 0}
              </span>
            </div>
            <div className="p-2.5 rounded bg-[var(--admin-surface-base)] border border-[var(--admin-border-subtle)]">
              <span className="text-[10px] text-[var(--admin-text-low)] block">Files</span>
              <span className="text-sm font-bold text-[var(--admin-text-high)]">
                {temp.totalFiles || 0}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-3 pt-2">
            <select
              value={maxAgeHours}
              onChange={(e) => setMaxAgeHours(Number(e.target.value))}
              className="px-2.5 py-1.5 text-xs font-mono rounded bg-[var(--admin-surface-base)] border border-[var(--admin-border-strong)] text-[var(--admin-text-high)] focus:outline-none"
            >
              <option value={1}>Older than 1 hour</option>
              <option value={2}>Older than 2 hours (Recommended)</option>
              <option value={6}>Older than 6 hours</option>
              <option value={24}>Older than 24 hours</option>
            </select>

            <button
              type="button"
              disabled={isCleaning}
              onClick={handleCleanupTemp}
              className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold rounded bg-[var(--admin-status-danger-muted)] text-[var(--admin-status-danger)] hover:bg-[var(--admin-status-danger)] hover:text-white border border-[var(--admin-status-danger)]/40 transition-colors admin-tactile-btn cursor-pointer"
            >
              <Trash2 size={13} />
              <span>{isCleaning ? "Cleaning..." : "Purge Temp Files"}</span>
            </button>
          </div>

          {cleanupResult && (
            <div className="p-2 rounded bg-[var(--admin-accent-primary-muted)] text-[var(--admin-accent-primary)] text-xs font-mono border border-[var(--admin-border-accent)]">
              ✓ Successfully removed {cleanupResult.cleanedFolders} workspace folder(s).
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
