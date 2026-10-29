import React, { useState, useMemo } from "react";
import {
  Search,
  Filter,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Play,
  Zap,
  Plus,
  ChevronDown,
  ChevronRight,
  FileCode,
  Layers,
  Code2,
  RefreshCw,
  ExternalLink,
} from "lucide-react";

const METHOD_STYLES = {
  GET: "bg-sky-500/10 text-sky-400 border-sky-500/25",
  POST: "bg-emerald-500/10 text-emerald-400 border-emerald-500/25",
  PUT: "bg-amber-500/10 text-amber-400 border-amber-500/25",
  PATCH: "bg-purple-500/10 text-purple-400 border-purple-500/25",
  DELETE: "bg-rose-500/10 text-rose-400 border-rose-500/25",
  DEFAULT: "bg-[var(--color-surface-secondary)] text-[var(--color-text-secondary)] border-[var(--color-border)]",
};

const CATEGORY_LABELS = {
  HAPPY_PATH: { label: "Happy Path", color: "text-emerald-400 border-emerald-500/30 bg-emerald-500/10" },
  VALIDATION: { label: "Validation", color: "text-amber-400 border-amber-500/30 bg-amber-500/10" },
  NOT_FOUND: { label: "Not Found", color: "text-sky-400 border-sky-500/30 bg-sky-500/10" },
  RESILIENCY: { label: "Resiliency", color: "text-purple-400 border-purple-500/30 bg-purple-500/10" },
};

function getEndpointModule(path) {
  if (!path) return "GENERAL";
  const segments = path.split("/").filter(Boolean);
  let idx = 0;
  while (idx < segments.length && /^(api|v\d+)$/i.test(segments[idx])) {
    idx++;
  }
  if (idx < segments.length) {
    const raw = segments[idx].replace(/^:/, "").toUpperCase();
    return raw || "ROOT";
  }
  return "ROOT";
}

export default function IntegrationRouteMatrixTable({
  endpoints = [],
  onRunEndpoint = () => {},
  onGenerateThisEndpoint = () => {},
  onOpenFile = () => {},
  onAddScenario = () => {},
  onEditScenario = () => {},
  onRetryScenario = () => {},
  onAIFixScenario = () => {},
  isJobActive = false,
  pendingAction = null,
}) {
  const [searchQuery, setSearchQuery] = useState("");
  const [methodFilter, setMethodFilter] = useState("ALL");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [moduleFilter, setModuleFilter] = useState("ALL");
  const [expandedEndpoints, setExpandedEndpoints] = useState({});

  const toggleEndpointExpand = (key) => {
    setExpandedEndpoints((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  };

  const expandAll = () => {
    const next = {};
    endpoints.forEach((ep) => {
      next[`${ep.method} ${ep.path}`] = true;
    });
    setExpandedEndpoints(next);
  };

  const collapseAll = () => {
    setExpandedEndpoints({});
  };

  // Extract available modules
  const modulesList = useMemo(() => {
    const set = new Set();
    endpoints.forEach((ep) => {
      set.add(getEndpointModule(ep.path));
    });
    return Array.from(set).sort();
  }, [endpoints]);

  // Compute endpoint statuses and filter
  const processedEndpoints = useMemo(() => {
    return endpoints.map((ep) => {
      const epKey = `${ep.method} ${ep.path}`;
      const scenarios = ep.scenarios || [];
      const hasScenarios = scenarios.length > 0 || (ep.generatedCount || 0) > 0;
      
      const failedCount = (ep.failedCount || 0) + scenarios.filter((s) => s.status === "failed" || s.rawJestStatus === "failed" || s.executionVerdict === "FAIL").length;
      const passedCount = (ep.passedCount || 0) + scenarios.filter((s) => s.status === "passed" || s.rawJestStatus === "passed" || s.executionVerdict === "PASS").length;

      let status = "UNCOVERED";
      if (failedCount > 0) {
        status = "FAIL";
      } else if (passedCount > 0) {
        status = "PASS";
      }

      const mod = getEndpointModule(ep.path);

      return {
        ...ep,
        epKey,
        scenarios,
        hasScenarios,
        computedStatus: status,
        passedCount,
        failedCount,
        totalScenarios: scenarios.length || ep.generatedCount || 0,
        module: mod,
      };
    });
  }, [endpoints]);

  const filteredEndpoints = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    return processedEndpoints.filter((ep) => {
      if (methodFilter !== "ALL" && ep.method !== methodFilter) return false;
      if (statusFilter !== "ALL" && ep.computedStatus !== statusFilter) return false;
      if (moduleFilter !== "ALL" && ep.module !== moduleFilter) return false;

      if (q) {
        const matchPath = (ep.path || "").toLowerCase().includes(q);
        const matchHandler = (ep.controllerName || ep.handler || "").toLowerCase().includes(q);
        const matchFile = (ep.sourceFile || ep.filePath || "").toLowerCase().includes(q);
        const matchScenarios = (ep.scenarios || []).some((s) => (s.title || s.testName || "").toLowerCase().includes(q));
        if (!matchPath && !matchHandler && !matchFile && !matchScenarios) {
          return false;
        }
      }

      return true;
    });
  }, [processedEndpoints, searchQuery, methodFilter, statusFilter, moduleFilter]);

  const stats = useMemo(() => {
    const total = processedEndpoints.length;
    const passed = processedEndpoints.filter((ep) => ep.computedStatus === "PASS").length;
    const failed = processedEndpoints.filter((ep) => ep.computedStatus === "FAIL").length;
    const uncovered = processedEndpoints.filter((ep) => ep.computedStatus === "UNCOVERED").length;
    return { total, passed, failed, uncovered };
  }, [processedEndpoints]);

  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-xs overflow-hidden">
      {/* Table Header & Controls Bar */}
      <div className="p-4 border-b border-[var(--color-border)] bg-[var(--color-surface)] flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Layers size={18} className="text-[var(--color-primary)]" />
            <div>
              <h3 className="text-sm font-bold uppercase tracking-wider text-[var(--color-text)] m-0">
                Ma Trận Độ Bao Phủ Endpoint (Route Matrix)
              </h3>
              <p className="text-xs text-[var(--color-text-secondary)] m-0 mt-0.5">
                Danh sách toàn bộ các route Express/Node AST được phát hiện, trạng thái kiểm thử và kịch bản chi tiết
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 text-xs font-mono">
            <span className="px-2 py-0.5 rounded bg-[var(--color-surface-secondary)] border border-[var(--color-border)] text-[var(--color-text-secondary)]">
              {stats.total} routes
            </span>
            <span className="px-2 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/25 text-[var(--color-success)] font-semibold">
              ✓ {stats.passed} pass
            </span>
            <span className="px-2 py-0.5 rounded bg-rose-500/10 border border-rose-500/25 text-[var(--color-danger)] font-semibold">
              ✗ {stats.failed} fail
            </span>
            <span className="px-2 py-0.5 rounded bg-[var(--color-surface-secondary)] border border-[var(--color-border)] text-[var(--color-text-muted)]">
              ○ {stats.uncovered} uncovered
            </span>
          </div>
        </div>

        {/* Filter Toolbar */}
        <div className="flex flex-wrap items-center gap-2 pt-1">
          {/* Search box */}
          <div className="relative flex-1 min-w-[200px]">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Tìm kiếm theo URL, handler, file..."
              className="w-full pl-8 pr-3 py-1.5 text-xs rounded-[var(--radius-sm)] bg-[var(--color-surface-secondary)] border border-[var(--color-border)] text-[var(--color-text)] placeholder-[var(--color-text-muted)] focus:outline-none focus:border-[var(--color-primary)] transition-colors"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)] cursor-pointer"
              >
                ✕
              </button>
            )}
          </div>

          {/* Method Filter */}
          <div className="flex items-center gap-1 bg-[var(--color-surface-secondary)] p-0.5 rounded-[var(--radius-sm)] border border-[var(--color-border)] text-[11px] font-mono">
            {["ALL", "GET", "POST", "PUT", "PATCH", "DELETE"].map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMethodFilter(m)}
                className={`px-2 py-1 rounded transition-colors cursor-pointer ${
                  methodFilter === m
                    ? "bg-[var(--color-surface)] text-[var(--color-text)] font-bold shadow-xs border border-[var(--color-border)]"
                    : "text-[var(--color-text-secondary)] hover:text-[var(--color-text)]"
                }`}
              >
                {m}
              </button>
            ))}
          </div>

          {/* Status Filter */}
          <div className="flex items-center gap-1 bg-[var(--color-surface-secondary)] p-0.5 rounded-[var(--radius-sm)] border border-[var(--color-border)] text-[11px]">
            {[
              { id: "ALL", label: "Tất cả" },
              { id: "PASS", label: "✓ Pass" },
              { id: "FAIL", label: "✗ Fail" },
              { id: "UNCOVERED", label: "○ Chưa test" },
            ].map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setStatusFilter(s.id)}
                className={`px-2 py-1 rounded transition-colors cursor-pointer ${
                  statusFilter === s.id
                    ? "bg-[var(--color-surface)] text-[var(--color-text)] font-semibold shadow-xs border border-[var(--color-border)]"
                    : "text-[var(--color-text-secondary)] hover:text-[var(--color-text)]"
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>

          {/* Module Filter */}
          {modulesList.length > 1 && (
            <select
              value={moduleFilter}
              onChange={(e) => setModuleFilter(e.target.value)}
              className="px-2.5 py-1.5 text-xs rounded-[var(--radius-sm)] bg-[var(--color-surface-secondary)] border border-[var(--color-border)] text-[var(--color-text)] focus:outline-none cursor-pointer"
            >
              <option value="ALL">Mọi Module ({modulesList.length})</option>
              {modulesList.map((mod) => (
                <option key={mod} value={mod}>
                  Module: {mod}
                </option>
              ))}
            </select>
          )}

          {/* Expand / Collapse all */}
          <div className="flex items-center gap-1 ml-auto">
            <button
              type="button"
              onClick={expandAll}
              className="text-[11px] text-[var(--color-text-secondary)] hover:text-[var(--color-text)] px-2 py-1 cursor-pointer transition-colors"
            >
              Mở rộng tất cả
            </button>
            <span className="text-[var(--color-border)]">|</span>
            <button
              type="button"
              onClick={collapseAll}
              className="text-[11px] text-[var(--color-text-secondary)] hover:text-[var(--color-text)] px-2 py-1 cursor-pointer transition-colors"
            >
              Thu gọn
            </button>
          </div>
        </div>
      </div>

      {/* Route Matrix Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse text-xs">
          <thead>
            <tr className="border-b border-[var(--color-border)] bg-[var(--color-surface-secondary)]/50 text-[10px] uppercase font-bold text-[var(--color-text-muted)] tracking-wider">
              <th className="py-2.5 px-3 w-8"></th>
              <th className="py-2.5 px-2 w-20">Method</th>
              <th className="py-2.5 px-3">Endpoint Path</th>
              <th className="py-2.5 px-3">Handler / Controller</th>
              <th className="py-2.5 px-3">Source File</th>
              <th className="py-2.5 px-3 text-center w-28">Trạng thái</th>
              <th className="py-2.5 px-3 text-center w-24">Kịch bản</th>
              <th className="py-2.5 px-3 text-right w-44">Hành động</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--color-border)]/60 font-sans">
            {filteredEndpoints.length === 0 ? (
              <tr>
                <td colSpan={8} className="py-8 text-center text-xs text-[var(--color-text-muted)]">
                  Không tìm thấy endpoint nào phù hợp với bộ lọc.
                </td>
              </tr>
            ) : (
              filteredEndpoints.map((ep) => {
                const isExpanded = Boolean(expandedEndpoints[ep.epKey]);
                const methodBadgeClass = METHOD_STYLES[ep.method] || METHOD_STYLES.DEFAULT;
                const isPass = ep.computedStatus === "PASS";
                const isFail = ep.computedStatus === "FAIL";
                const isUncovered = ep.computedStatus === "UNCOVERED";

                return (
                  <React.Fragment key={ep.epKey}>
                    <tr
                      className={`hover:bg-[var(--color-surface-hover)] transition-colors cursor-pointer ${
                        isExpanded ? "bg-[var(--color-surface-secondary)]/30" : ""
                      }`}
                      onClick={() => toggleEndpointExpand(ep.epKey)}
                    >
                      {/* Expand Chevron */}
                      <td className="py-2.5 px-3 text-center text-[var(--color-text-muted)]">
                        {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                      </td>

                      {/* Method Tag */}
                      <td className="py-2.5 px-2">
                        <span className={`px-2 py-0.5 rounded font-mono text-[10px] font-bold border tracking-tight ${methodBadgeClass}`}>
                          {ep.method}
                        </span>
                      </td>

                      {/* Path */}
                      <td className="py-2.5 px-3 font-mono font-semibold text-[var(--color-text)]">
                        {ep.path}
                      </td>

                      {/* Handler */}
                      <td className="py-2.5 px-3 font-mono text-[var(--color-text-secondary)] text-[11px] truncate max-w-[180px]">
                        {ep.controllerName || ep.handler || "anonymousHandler"}
                      </td>

                      {/* Source File */}
                      <td className="py-2.5 px-3 text-[var(--color-text-muted)] text-[11px] font-mono truncate max-w-[180px]">
                        {ep.sourceFile || ep.filePath ? (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onOpenFile(ep.sourceFile || ep.filePath);
                            }}
                            className="hover:text-[var(--color-primary)] hover:underline inline-flex items-center gap-1 cursor-pointer"
                            title={ep.sourceFile || ep.filePath}
                          >
                            <FileCode size={12} />
                            <span>{(ep.sourceFile || ep.filePath).split(/[\\/]/).slice(-2).join("/")}</span>
                          </button>
                        ) : (
                          "express-router"
                        )}
                      </td>

                      {/* Status Badge */}
                      <td className="py-2.5 px-3 text-center">
                        {isPass ? (
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/10 text-[var(--color-success)] border border-emerald-500/25">
                            ✓ PASS
                          </span>
                        ) : isFail ? (
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-500/10 text-[var(--color-danger)] border border-rose-500/25">
                            ✗ FAIL ({ep.failedCount})
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-[var(--color-surface-secondary)] text-[var(--color-text-muted)] border border-[var(--color-border)]">
                            UNCOVERED
                          </span>
                        )}
                      </td>

                      {/* Scenarios Count */}
                      <td className="py-2.5 px-3 text-center font-mono text-xs">
                        <span className={`px-1.5 py-0.5 rounded ${ep.totalScenarios > 0 ? "bg-[var(--color-surface-secondary)] text-[var(--color-text)] border border-[var(--color-border)]" : "text-[var(--color-text-muted)]"}`}>
                          {ep.totalScenarios} tests
                        </span>
                      </td>

                      {/* Actions */}
                      <td className="py-2.5 px-3 text-right">
                        <div className="inline-flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                          {/* Run Endpoint */}
                          <button
                            type="button"
                            onClick={() => onRunEndpoint(ep)}
                            disabled={isJobActive || ep.totalScenarios === 0}
                            title={ep.totalScenarios === 0 ? "Chưa có kịch bản test để chạy" : "Chạy test cho endpoint này"}
                            className="p-1.5 rounded-[var(--radius-sm)] bg-[var(--color-surface-secondary)] hover:bg-[var(--color-surface-hover)] text-[var(--color-text)] border border-[var(--color-border)] hover:text-[var(--color-primary)] transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                          >
                            <Play size={12} fill="currentColor" />
                          </button>

                          {/* Generate AI Test */}
                          <button
                            type="button"
                            onClick={() => onGenerateThisEndpoint(`${ep.method} ${ep.path}`)}
                            disabled={isJobActive}
                            title="Sinh bổ sung kịch bản AI cho endpoint này"
                            className="p-1.5 rounded-[var(--radius-sm)] bg-[var(--color-surface-secondary)] hover:bg-[var(--color-surface-hover)] text-[var(--color-text)] border border-[var(--color-border)] hover:text-[var(--color-primary)] transition-colors cursor-pointer disabled:opacity-40"
                          >
                            <Zap size={12} />
                          </button>

                          {/* Add Scenario Monaco */}
                          <button
                            type="button"
                            onClick={() => onAddScenario(ep)}
                            title="Thêm kịch bản kiểm thử mới qua Monaco Editor"
                            className="p-1.5 rounded-[var(--radius-sm)] bg-[var(--color-surface-secondary)] hover:bg-[var(--color-surface-hover)] text-[var(--color-text)] border border-[var(--color-border)] hover:text-[var(--color-primary)] transition-colors cursor-pointer"
                          >
                            <Plus size={12} />
                          </button>
                        </div>
                      </td>
                    </tr>

                    {/* Inline Expanded Detail Row */}
                    {isExpanded && (
                      <tr className="bg-[var(--color-surface-secondary)]/20">
                        <td colSpan={8} className="p-4 border-b border-[var(--color-border)]">
                          <div className="space-y-3 pl-4 border-l-2 border-[var(--color-primary)]/40">
                            {/* Endpoint Meta Banner */}
                            <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
                              <div className="flex items-center gap-2 font-mono">
                                <span className="font-bold text-[var(--color-text)]">{ep.method} {ep.path}</span>
                                <span className="text-[var(--color-text-muted)]">• Module: {ep.module}</span>
                              </div>
                              <div className="flex items-center gap-2">
                                <button
                                  type="button"
                                  onClick={() => onAddScenario(ep)}
                                  className="flex items-center gap-1 px-2.5 py-1 rounded bg-[var(--color-primary)] text-[var(--color-primary-foreground)] text-xs font-semibold hover:opacity-90 transition-opacity cursor-pointer shadow-xs"
                                >
                                  <Plus size={12} />
                                  <span>Thêm kịch bản kiểm thử</span>
                                </button>
                              </div>
                            </div>

                            {/* Scenarios Under This Endpoint */}
                            {ep.scenarios && ep.scenarios.length > 0 ? (
                              <div className="space-y-2">
                                <div className="text-[11px] font-bold uppercase tracking-wider text-[var(--color-text-muted)]">
                                  Danh sách kịch bản kiểm thử ({ep.scenarios.length}):
                                </div>
                                <div className="grid grid-cols-1 gap-2">
                                  {ep.scenarios.map((sc, idx) => {
                                    const cat = CATEGORY_LABELS[sc.category] || CATEGORY_LABELS.HAPPY_PATH;
                                    const isScPass = sc.status === "passed" || sc.rawJestStatus === "passed" || sc.executionVerdict === "PASS";
                                    const isScFail = sc.status === "failed" || sc.rawJestStatus === "failed" || sc.executionVerdict === "FAIL";

                                    return (
                                      <div
                                        key={sc.id || idx}
                                        className="p-3 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] flex flex-wrap items-center justify-between gap-3"
                                      >
                                        <div className="flex items-center gap-2 min-w-0">
                                          {isScPass ? (
                                            <CheckCircle2 size={15} className="text-[var(--color-success)] shrink-0" />
                                          ) : isScFail ? (
                                            <XCircle size={15} className="text-[var(--color-danger)] shrink-0" />
                                          ) : (
                                            <div className="w-3.5 h-3.5 rounded-full border border-[var(--color-border)] shrink-0" />
                                          )}
                                          <div>
                                            <div className="font-semibold text-xs text-[var(--color-text)]">
                                              {sc.title || sc.testName || `Scenario #${idx + 1}`}
                                            </div>
                                            <div className="flex items-center gap-2 mt-0.5 text-[11px] font-mono text-[var(--color-text-secondary)]">
                                              <span className={`px-1.5 py-0.2 rounded text-[10px] border ${cat.color}`}>
                                                {cat.label}
                                              </span>
                                              <span>Expected HTTP {sc.expectedStatus || 200}</span>
                                              {sc.actualStatus && (
                                                <span className={isScFail ? "text-[var(--color-danger)] font-bold" : "text-[var(--color-success)]"}>
                                                  Received HTTP {sc.actualStatus}
                                                </span>
                                              )}
                                            </div>
                                          </div>
                                        </div>

                                        <div className="flex items-center gap-1.5 text-xs">
                                          {isScFail && (
                                            <button
                                              type="button"
                                              onClick={() => onAIFixScenario(ep, sc)}
                                              title="Sửa lỗi kịch bản này bằng AI"
                                              className="flex items-center gap-1 px-2 py-1 rounded bg-rose-500/10 text-[var(--color-danger)] border border-rose-500/25 hover:bg-rose-500/20 transition-colors cursor-pointer"
                                            >
                                              <Zap size={11} />
                                              <span>Sửa AI</span>
                                            </button>
                                          )}
                                          <button
                                            type="button"
                                            onClick={() => onRetryScenario(ep, sc)}
                                            title="Chạy lại kịch bản này"
                                            className="flex items-center gap-1 px-2 py-1 rounded bg-[var(--color-surface-secondary)] text-[var(--color-text)] border border-[var(--color-border)] hover:bg-[var(--color-surface-hover)] transition-colors cursor-pointer"
                                          >
                                            <Play size={11} fill="currentColor" />
                                            <span>Chạy lại</span>
                                          </button>
                                          <button
                                            type="button"
                                            onClick={() => onEditScenario(sc, ep)}
                                            title="Mở trình soạn thảo Monaco Editor"
                                            className="flex items-center gap-1 px-2 py-1 rounded bg-[var(--color-surface-secondary)] text-[var(--color-text)] border border-[var(--color-border)] hover:bg-[var(--color-surface-hover)] transition-colors cursor-pointer"
                                          >
                                            <Code2 size={11} />
                                            <span>Sửa code</span>
                                          </button>
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            ) : (
                              <div className="p-4 rounded border border-dashed border-[var(--color-border)] text-center text-xs text-[var(--color-text-muted)]">
                                Chưa có kịch bản kiểm thử nào cho endpoint này. Bấm <strong>"Thêm kịch bản kiểm thử"</strong> hoặc <strong>"Sinh test AI"</strong> ở trên để tạo kịch bản.
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

