import React, { useState, useEffect, useCallback } from "react";
import {
  Cpu,
  Coins,
  TrendingUp,
  Database,
  RefreshCw,
  Users,
  HardDrive,
  Layers,
  Sparkles,
  Zap,
} from "lucide-react";
import { TelemetryWidget } from "../../components/admin/TelemetryWidget.jsx";
import { adminService } from "../../services/admin.service.js";

/**
 * AdminAiGovernance — Gemini LLM Observability & Token Cost Control
 */
export default function AdminAiGovernance() {
  const [overview, setOverview] = useState(null);
  const [quotas, setQuotas] = useState([]);
  const [cacheStats, setCacheStats] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [activeSubTab, setActiveSubTab] = useState("topConsumers"); // 'topConsumers' | 'quotas' | 'caches'

  const fetchAiData = useCallback(async () => {
    setIsLoading(true);
    try {
      const [ovRes, quoRes, cacheRes] = await Promise.allSettled([
        adminService.getAiOverview(),
        adminService.getAiQuotas({ limit: 15 }),
        adminService.getAiCacheStats(),
      ]);

      if (ovRes.status === "fulfilled") setOverview(ovRes.value);
      if (quoRes.status === "fulfilled") setQuotas(quoRes.value?.reservations || []);
      if (cacheRes.status === "fulfilled") setCacheStats(cacheRes.value);
    } catch (err) {
      console.error("[AdminAiGovernance] Error loading AI telemetry:", err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAiData();
  }, [fetchAiData]);

  const totalTokens = overview?.totalTokens || 0;
  const totalCost = overview?.estimatedCostUsd || "0.00";
  const totalRequests = overview?.totalRequests || 0;

  return (
    <div className="p-6 h-full flex flex-col space-y-6 max-w-[1600px] mx-auto overflow-y-auto">
      {/* 1. Header Toolbar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-[var(--admin-border-subtle)] flex-shrink-0">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold tracking-tight text-[var(--admin-text-high)]">
              AI & Gemini Token Governance
            </h1>
            <span className="px-2 py-0.5 rounded text-[11px] font-mono bg-[var(--admin-accent-primary-muted)] text-[var(--admin-accent-primary)] border border-[var(--admin-border-accent)]">
              OBSERVABILITY
            </span>
          </div>
          <p className="text-xs text-[var(--admin-text-medium)] mt-1">
            Real-time LLM token metering, USD cost projections, rate limits, and context cache optimization.
          </p>
        </div>

        <button
          type="button"
          onClick={fetchAiData}
          disabled={isLoading}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded bg-[var(--admin-surface-raised)] text-[var(--admin-text-high)] hover:bg-[var(--admin-surface-overlay)] border border-[var(--admin-border-strong)] transition-colors admin-tactile-btn self-start md:self-auto cursor-pointer"
        >
          <RefreshCw size={13} className={isLoading ? "animate-spin" : ""} />
          <span>Refresh Metrics</span>
        </button>
      </div>

      {/* 2. Top Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <TelemetryWidget
          title="Total Tokens Ingested"
          value={totalTokens > 1000000 ? `${(totalTokens / 1000000).toFixed(2)}M` : totalTokens.toLocaleString()}
          unit="tokens"
          status="healthy"
          icon={Cpu}
          trendData={[10, 20, 35, 45, 60, 80, 100]}
          footerNote="Across all active users"
        />

        <TelemetryWidget
          title="Estimated Gemini Cost"
          value={`$${totalCost}`}
          unit="USD"
          status={parseFloat(totalCost) > 50 ? "warning" : "healthy"}
          icon={Coins}
          trendData={[2, 4, 8, 12, 18, 25]}
          footerNote="Standard Google AI rates"
        />

        <TelemetryWidget
          title="Total AI Invocations"
          value={totalRequests.toLocaleString()}
          unit="calls"
          status="healthy"
          icon={Zap}
          trendData={[15, 25, 40, 55, 70, 95]}
          footerNote="Tests, CFG & suggestions"
        />

        <TelemetryWidget
          title="Context Cache Entries"
          value={cacheStats?.totalCacheEntries?.toLocaleString() || "0"}
          unit="snapshots"
          status="healthy"
          icon={HardDrive}
          footerNote="Cached AST contexts"
        />
      </div>

      {/* 3. Sub-tabs Navigation */}
      <div className="flex items-center gap-2 border-b border-[var(--admin-border-subtle)] pb-2">
        <button
          onClick={() => setActiveSubTab("topConsumers")}
          className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
            activeSubTab === "topConsumers"
              ? "bg-[var(--admin-accent-primary-muted)] text-[var(--admin-accent-primary)] border border-[var(--admin-border-accent)]"
              : "text-[var(--admin-text-medium)] hover:text-[var(--admin-text-high)] hover:bg-[var(--admin-surface-raised)]"
          }`}
        >
          Top Token Consumers ({overview?.topConsumers?.length || 0})
        </button>

        <button
          onClick={() => setActiveSubTab("quotas")}
          className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
            activeSubTab === "quotas"
              ? "bg-[var(--admin-accent-primary-muted)] text-[var(--admin-accent-primary)] border border-[var(--admin-border-accent)]"
              : "text-[var(--admin-text-medium)] hover:text-[var(--admin-text-high)] hover:bg-[var(--admin-surface-raised)]"
          }`}
        >
          Quota Reservations ({quotas.length})
        </button>

        <button
          onClick={() => setActiveSubTab("caches")}
          className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
            activeSubTab === "caches"
              ? "bg-[var(--admin-accent-primary-muted)] text-[var(--admin-accent-primary)] border border-[var(--admin-border-accent)]"
              : "text-[var(--admin-text-medium)] hover:text-[var(--admin-text-high)] hover:bg-[var(--admin-surface-raised)]"
          }`}
        >
          Context Cache Storage ({cacheStats?.totalCacheEntries || 0})
        </button>
      </div>

      {/* 4. Tab Content */}
      <div className="flex-1 bg-[var(--admin-surface-raised)] border border-[var(--admin-border-subtle)] rounded-lg overflow-hidden">
        {/* SUBTAB 1: TOP CONSUMERS */}
        {activeSubTab === "topConsumers" && (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead className="bg-[var(--admin-surface-overlay)] border-b border-[var(--admin-border-strong)] text-[10px] font-mono uppercase text-[var(--admin-text-medium)]">
                <tr>
                  <th className="py-2.5 px-4 w-12 text-center">Rank</th>
                  <th className="py-2.5 px-4">User</th>
                  <th className="py-2.5 px-4">Email Address</th>
                  <th className="py-2.5 px-4 text-right">Tokens Consumed</th>
                  <th className="py-2.5 px-4 text-right">Est. Cost</th>
                  <th className="py-2.5 px-4 text-right">% of Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--admin-border-subtle)] font-mono text-[11px]">
                {!overview?.topConsumers || overview.topConsumers.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-12 text-center text-[var(--admin-text-low)]">
                      No token usage recorded yet.
                    </td>
                  </tr>
                ) : (
                  overview.topConsumers.map((consumer, idx) => {
                    const pct = totalTokens > 0 ? ((consumer.aiTokenUsage / totalTokens) * 100).toFixed(1) : "0.0";
                    const cost = ((consumer.aiTokenUsage / 1000000) * 0.15).toFixed(4);

                    return (
                      <tr key={consumer.id} className="hover:bg-[var(--admin-surface-base)] transition-colors">
                        <td className="py-2.5 px-4 text-center font-bold text-[var(--admin-accent-primary)]">
                          #{idx + 1}
                        </td>
                        <td className="py-2.5 px-4 font-sans font-medium text-[var(--admin-text-high)]">
                          {consumer.name || "Unnamed"}
                        </td>
                        <td className="py-2.5 px-4 text-[var(--admin-text-medium)]">
                          {consumer.email}
                        </td>
                        <td className="py-2.5 px-4 text-right font-bold text-[var(--admin-accent-telemetry)]">
                          {consumer.aiTokenUsage.toLocaleString()}
                        </td>
                        <td className="py-2.5 px-4 text-right text-[var(--admin-text-high)]">
                          ${cost}
                        </td>
                        <td className="py-2.5 px-4 text-right text-[var(--admin-text-medium)]">
                          {pct}%
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* SUBTAB 2: QUOTAS */}
        {activeSubTab === "quotas" && (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead className="bg-[var(--admin-surface-overlay)] border-b border-[var(--admin-border-strong)] text-[10px] font-mono uppercase text-[var(--admin-text-medium)]">
                <tr>
                  <th className="py-2.5 px-4">Reservation ID</th>
                  <th className="py-2.5 px-4">User</th>
                  <th className="py-2.5 px-4">Operation Scope</th>
                  <th className="py-2.5 px-4 text-right">Tokens Reserved</th>
                  <th className="py-2.5 px-4">Status</th>
                  <th className="py-2.5 px-4">Created At</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--admin-border-subtle)] font-mono text-[11px]">
                {quotas.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-12 text-center text-[var(--admin-text-low)]">
                      No active AI quota reservations found.
                    </td>
                  </tr>
                ) : (
                  quotas.map((q) => (
                    <tr key={q.id} className="hover:bg-[var(--admin-surface-base)] transition-colors">
                      <td className="py-2.5 px-4 text-[var(--admin-accent-telemetry)] truncate max-w-[150px]">
                        {q.id}
                      </td>
                      <td className="py-2.5 px-4 text-[var(--admin-text-high)]">
                        {q.user?.email || q.userId || "—"}
                      </td>
                      <td className="py-2.5 px-4 text-[var(--admin-text-medium)]">
                        {q.operationType || "AI_RUN"}
                      </td>
                      <td className="py-2.5 px-4 text-right font-bold text-[var(--admin-text-high)]">
                        {(q.estimatedTokens || 0).toLocaleString()}
                      </td>
                      <td className="py-2.5 px-4">
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-[var(--admin-surface-base)] text-[var(--admin-accent-primary)] border border-[var(--admin-border-subtle)]">
                          {q.status || "CONFIRMED"}
                        </span>
                      </td>
                      <td className="py-2.5 px-4 text-[var(--admin-text-low)]">
                        {new Date(q.createdAt).toLocaleString()}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* SUBTAB 3: CACHES */}
        {activeSubTab === "caches" && (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead className="bg-[var(--admin-surface-overlay)] border-b border-[var(--admin-border-strong)] text-[10px] font-mono uppercase text-[var(--admin-text-medium)]">
                <tr>
                  <th className="py-2.5 px-4">Cache ID</th>
                  <th className="py-2.5 px-4">Snapshot ID</th>
                  <th className="py-2.5 px-4">Project</th>
                  <th className="py-2.5 px-4">Input Hash</th>
                  <th className="py-2.5 px-4">Created At</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--admin-border-subtle)] font-mono text-[11px]">
                {!cacheStats?.recentCaches || cacheStats.recentCaches.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-12 text-center text-[var(--admin-text-low)]">
                      No AI context cache entries stored yet.
                    </td>
                  </tr>
                ) : (
                  cacheStats.recentCaches.map((c) => (
                    <tr key={c.id} className="hover:bg-[var(--admin-surface-base)] transition-colors">
                      <td className="py-2.5 px-4 text-[var(--admin-accent-telemetry)] truncate max-w-[150px]">
                        {c.id}
                      </td>
                      <td className="py-2.5 px-4 text-[var(--admin-text-medium)] truncate max-w-[150px]">
                        {c.snapshotId}
                      </td>
                      <td className="py-2.5 px-4 text-[var(--admin-text-high)]">
                        {c.snapshot?.project?.name || c.snapshot?.projectId || "—"}
                      </td>
                      <td className="py-2.5 px-4 text-[var(--admin-text-low)] truncate max-w-[180px]">
                        {c.inputHash}
                      </td>
                      <td className="py-2.5 px-4 text-[var(--admin-text-medium)]">
                        {new Date(c.createdAt).toLocaleString()}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
