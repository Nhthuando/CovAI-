import React, { useState, useMemo } from "react";
import {
  Search,
  CheckCircle2,
  XCircle,
  Play,
  Zap,
  ChevronDown,
  ChevronRight,
  FileCode,
  Layers,
  RefreshCw,
  Network,
  Plus,
  Edit3,
  Trash2,
  Sparkles,
  Radar,
  Code2,
  AlertTriangle,
  ShieldCheck,
  Terminal,
  Copy,
  Check,
  Power,
  Eye,
  Wrench,
  HardDriveDownload,
} from "lucide-react";
import {
  CATEGORY_LABELS,
  classifyScenario,
  getEndpointCaseCoverage,
} from "./integrationCaseCoverage.js";

export const METHOD_STYLES = {
  GET: "bg-sky-500/10 text-sky-400 border-sky-500/25",
  POST: "bg-indigo-500/10 text-indigo-400 border-indigo-500/25",
  PUT: "bg-amber-500/10 text-amber-400 border-amber-500/25",
  PATCH: "bg-purple-500/10 text-purple-400 border-purple-500/25",
  DELETE: "bg-rose-500/10 text-rose-400 border-rose-500/25",
  DEFAULT:
    "bg-[var(--color-surface-secondary)] text-[var(--color-text-secondary)] border-[var(--color-border)]",
};

const HTTP_METHODS = ["ALL", "GET", "POST", "PUT", "PATCH", "DELETE"];

function normalizePathForMatch(p = "") {
  const clean = String(p || "")
    .split("?")[0]
    .trim()
    .replace(/\/+$/, "");
  return clean || "/";
}

function doesRouteMatch(routePath = "", requestPath = "") {
  const normRoute = normalizePathForMatch(routePath);
  const normReq = normalizePathForMatch(requestPath);
  if (normRoute.toLowerCase() === normReq.toLowerCase()) return true;

  const routeParts = normRoute.split("/").filter(Boolean);
  const reqParts = normReq.split("/").filter(Boolean);
  if (routeParts.length !== reqParts.length) return false;

  for (let i = 0; i < routeParts.length; i++) {
    const rp = routeParts[i];
    const qp = reqParts[i];
    if (
      rp.startsWith(":") ||
      (rp.startsWith("{") && rp.endsWith("}")) ||
      (rp.startsWith("[") && rp.endsWith("]")) ||
      rp === "*"
    ) {
      continue;
    }
    if (rp.toLowerCase() !== qp.toLowerCase()) return false;
  }
  return true;
}

export default function IntegrationRouteMatrixTable({
  endpoints = [],
  aiTests = [],
  hasScanned = false,
  hasAnalyzedCoverage = false,
  isScanning = false,
  onScanEndpoints,
  onGenerateTest,
  onGenerateSelected,
  onGenerateAllTests,
  onOpenSetupModal,
  onRunEndpoint,
  onRunSelected,
  onRunSelectedScenarios,
  onRunScenario,
  onOpenAddScenario,
  onOpenEditScenario,
  onDeleteScenario,
  onToggleScenario,
  onAIFixScenario,
  onApplyScenario,
  onOpenSourceFile,
  isGenerating = false,
  isRunning = false,
  generatingKey = null,
  runningKey = null,
}) {
  const [searchQuery, setSearchQuery] = useState("");
  const [methodFilter, setMethodFilter] = useState("ALL");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [moduleFilter, setModuleFilter] = useState("ALL");
  const [expandedRows, setExpandedRows] = useState(new Set());
  const [expandedLogicKeys, setExpandedLogicKeys] = useState(new Set());
  const [selectedEndpointKeys, setSelectedEndpointKeys] = useState(new Set());
  const [selectedScenarioKeys, setSelectedScenarioKeys] = useState(new Set());
  const [expandedScenarioCodeKey, setExpandedScenarioCodeKey] = useState(null);
  const [confirmDeleteKey, setConfirmDeleteKey] = useState(null);
  const [copiedKey, setCopiedKey] = useState(null);

  // Merge endpoint scenarios + aiTests requests so 100% of scenarios (AI, Repo, Custom) live inside the matrix
  const { enrichedEndpoints, unmappedScenarios, totalScenarioCount } = useMemo(() => {
    const allAiRequests = [];
    for (const testFile of aiTests || []) {
      const requests = Array.isArray(testFile.requests) ? testFile.requests : [];
      for (const req of requests) {
        const resolvedTitle = req.title || req.testName || req.name || "";
        allAiRequests.push({
          ...req,
          title: resolvedTitle,
          aiTestId: req.aiTestId || testFile.id,
          scenarioId: req.scenarioId || req.id,
          version: testFile.version ?? req.version ?? 1,
          filePath: req.filePath || testFile.filePath,
          fullFileCode: testFile.code || "",
          origin: req.origin || testFile.origin || "AI",
          enabled: req.enabled !== false,
          userEdited: Boolean(req.userEdited),
        });
      }
    }

    const usedAiRequestKeys = new Set();
    let scenarioCounter = 0;

    const mappedEndpoints = (endpoints || []).map((ep) => {
      const epMethod = (ep.method || "GET").toUpperCase();
      const epPath = ep.path || "/";
      const baseScenarios = Array.isArray(ep.scenarios) ? ep.scenarios : [];

      // Match AI/Repo test requests targeting this endpoint
      const matchingAiReqs = allAiRequests.filter((req) => {
        const reqMethod = (req.method || "GET").toUpperCase();
        if (reqMethod !== epMethod) return false;
        return doesRouteMatch(epPath, req.path || "/");
      });

      const merged = [];
      const seenScenarioIds = new Set();
      const seenTitles = new Set();

      // 1. Merge base scenarios from endpoint with metadata from matchingAiReqs
      for (const sc of baseScenarios) {
        const scTitleNorm = String(sc.title || sc.name || "")
          .trim()
          .toLowerCase();
        const matchedReq = matchingAiReqs.find((r) => {
          if (sc.scenarioId && r.scenarioId && sc.scenarioId === r.scenarioId) {
            return true;
          }
          const rTitleNorm = String(r.title || r.testName || r.name || "")
            .trim()
            .toLowerCase();
          return scTitleNorm && rTitleNorm === scTitleNorm;
        });

        if (matchedReq) {
          usedAiRequestKeys.add(`${matchedReq.aiTestId}::${matchedReq.scenarioId || matchedReq.title}`);
        }

        const mergedSc = {
          ...matchedReq,
          ...sc,
          title: sc.title || sc.name || matchedReq?.title || `${epMethod} ${epPath} scenario`,
          aiTestId: sc.aiTestId || matchedReq?.aiTestId || null,
          scenarioId: sc.scenarioId || matchedReq?.scenarioId || null,
          version: sc.version ?? matchedReq?.version ?? 1,
          code: sc.code || matchedReq?.code || "",
          fullFileCode: sc.fullFileCode || matchedReq?.fullFileCode || "",
          filePath: sc.filePath || sc.testFile || matchedReq?.filePath || null,
          origin: sc.origin || matchedReq?.origin || "AI",
          enabled: sc.enabled !== undefined ? sc.enabled !== false : matchedReq?.enabled !== false,
          userEdited: Boolean(sc.userEdited || matchedReq?.userEdited),
          expectedStatus: sc.expectedStatus ?? matchedReq?.expectedStatus ?? 200,
          method: epMethod,
          path: epPath,
        };

        const idKey = mergedSc.scenarioId ? `${mergedSc.aiTestId || "ep"}::${mergedSc.scenarioId}` : null;
        const titleKey = scTitleNorm ? `${epMethod}::${epPath}::${scTitleNorm}` : null;

        if ((idKey && seenScenarioIds.has(idKey)) || (titleKey && seenTitles.has(titleKey))) {
          continue;
        }
        if (idKey) seenScenarioIds.add(idKey);
        if (titleKey) seenTitles.add(titleKey);
        merged.push(mergedSc);
      }

      // 2. Append any remaining matchingAiReqs not yet in baseScenarios
      for (const req of matchingAiReqs) {
        const reqKey = `${req.aiTestId}::${req.scenarioId || req.title}`;
        const reqTitleNorm = String(req.title || req.testName || req.name || "")
          .trim()
          .toLowerCase();
        const idKey = req.scenarioId ? `${req.aiTestId}::${req.scenarioId}` : null;
        const titleKey = reqTitleNorm ? `${epMethod}::${epPath}::${reqTitleNorm}` : null;

        if ((idKey && seenScenarioIds.has(idKey)) || (titleKey && seenTitles.has(titleKey))) {
          usedAiRequestKeys.add(reqKey);
          continue;
        }
        if (idKey) seenScenarioIds.add(idKey);
        if (titleKey) seenTitles.add(titleKey);
        usedAiRequestKeys.add(reqKey);
        merged.push({
          ...req,
          title: req.title || req.testName || req.name || `${epMethod} ${epPath} scenario`,
          status: req.status || "READY",
          method: epMethod,
          path: epPath,
        });
      }

      scenarioCounter += merged.length;

      return {
        ...ep,
        scenarios: merged,
        scenarioCount: Math.max(ep.scenarioCount || 0, merged.length),
      };
    });

    const leftover = allAiRequests.filter(
      (req) => !usedAiRequestKeys.has(`${req.aiTestId}::${req.scenarioId || req.title}`),
    );
    scenarioCounter += leftover.length;

    return {
      enrichedEndpoints: mappedEndpoints,
      unmappedScenarios: leftover,
      totalScenarioCount: scenarioCounter,
    };
  }, [endpoints, aiTests]);

  const modules = useMemo(() => {
    const set = new Set();
    enrichedEndpoints.forEach((ep) => {
      if (ep.module) set.add(ep.module);
    });
    return ["ALL", ...Array.from(set).sort()];
  }, [enrichedEndpoints]);

  const getEndpointStatus = (ep) => {
    const raw = (ep.status || "").toUpperCase();
    const scenarios = ep.scenarios || [];
    const hasFailed =
      raw === "FAILED" ||
      raw === "FAIL" ||
      scenarios.some((s) => {
        const st = (s.status || "").toUpperCase();
        return st === "FAILED" || st === "FAIL";
      });
    if (hasFailed) return "FAIL";

    const hasPassed =
      raw === "COVERED" ||
      raw === "PASS" ||
      raw === "PASSED" ||
      ep.covered === true ||
      scenarios.some((s) => {
        const st = (s.status || "").toUpperCase();
        return st === "PASSED" || st === "PASS";
      });
    if (hasPassed) return "PASS";

    if (scenarios.length > 0) return "READY";
    return "UNCOVERED";
  };

  const filteredEndpoints = useMemo(() => {
    return enrichedEndpoints.filter((ep) => {
      const m = (ep.method || "GET").toUpperCase();
      if (methodFilter !== "ALL" && m !== methodFilter) return false;
      if (moduleFilter !== "ALL" && ep.module !== moduleFilter) return false;

      const status = getEndpointStatus(ep);
      if (statusFilter === "PASS" && status !== "PASS") return false;
      if (statusFilter === "FAIL" && status !== "FAIL") return false;
      if (
        statusFilter === "UNCOVERED" &&
        status !== "UNCOVERED" &&
        status !== "READY"
      )
        return false;

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const pathMatch = (ep.path || "").toLowerCase().includes(q);
        const ctrlMatch = (ep.controller || ep.handler || "")
          .toLowerCase()
          .includes(q);
        const fileMatch = (ep.file || ep.sourceFile || "")
          .toLowerCase()
          .includes(q);
        const modMatch = (ep.module || "").toLowerCase().includes(q);
        const scenarioMatch = (ep.scenarios || []).some((sc) =>
          (sc.title || sc.name || "").toLowerCase().includes(q),
        );
        return pathMatch || ctrlMatch || fileMatch || modMatch || scenarioMatch;
      }

      return true;
    });
  }, [enrichedEndpoints, methodFilter, statusFilter, moduleFilter, searchQuery]);

  const stats = useMemo(() => {
    const total = enrichedEndpoints.length;
    const passed = enrichedEndpoints.filter(
      (e) => getEndpointStatus(e) === "PASS",
    ).length;
    const failed = enrichedEndpoints.filter(
      (e) => getEndpointStatus(e) === "FAIL",
    ).length;
    const ready = enrichedEndpoints.filter(
      (e) => getEndpointStatus(e) === "READY",
    ).length;
    const uncovered = Math.max(0, total - passed - failed - ready);
    return { total, passed, failed, ready, uncovered };
  }, [enrichedEndpoints]);

  const toggleLogicSnippet = (key) => {
    setExpandedLogicKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleRow = (key) => {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const expandAll = () => {
    setExpandedRows(
      new Set(
        filteredEndpoints.map(
          (ep, idx) => `${ep.method || "GET"}-${ep.path}-${idx}`,
        ),
      ),
    );
  };

  const collapseAll = () => {
    setExpandedRows(new Set());
  };

  const handleCopyCode = (key, text) => {
    if (!text) return;
    navigator.clipboard?.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 1500);
  };

  const getEpIdentityKey = (ep) =>
    `${(ep.method || "GET").toUpperCase()}:${ep.path || ep.fullPath || "/"}`;

  const getScenarioIdentityKey = (sc, epKey = "") =>
    sc.id || `${epKey}::${sc.scenarioId || sc.title || sc.testName || ""}`;

  const toggleSelectEndpoint = (epKey) => {
    const isCurrentlySelected = selectedEndpointKeys.has(epKey);
    const targetEp = enrichedEndpoints.find((ep) => getEpIdentityKey(ep) === epKey);
    const childKeys = (targetEp?.scenarios || []).map((sc) =>
      getScenarioIdentityKey(sc, epKey),
    );

    setSelectedEndpointKeys((prev) => {
      const next = new Set(prev);
      if (isCurrentlySelected) next.delete(epKey);
      else next.add(epKey);
      return next;
    });

    if (childKeys.length > 0) {
      setSelectedScenarioKeys((prev) => {
        const next = new Set(prev);
        for (const ck of childKeys) {
          if (isCurrentlySelected) next.delete(ck);
          else next.add(ck);
        }
        return next;
      });
    }
  };

  const toggleSelectAllFiltered = () => {
    const filteredKeys = filteredEndpoints.map(getEpIdentityKey);
    const allSelected =
      filteredKeys.length > 0 &&
      filteredKeys.every((k) => selectedEndpointKeys.has(k));
    const allChildKeys = filteredEndpoints.flatMap((ep) => {
      const epKey = getEpIdentityKey(ep);
      return (ep.scenarios || []).map((sc) => getScenarioIdentityKey(sc, epKey));
    });

    if (allSelected) {
      setSelectedEndpointKeys(new Set());
      setSelectedScenarioKeys((prev) => {
        const next = new Set(prev);
        for (const ck of allChildKeys) next.delete(ck);
        return next;
      });
    } else {
      setSelectedEndpointKeys(new Set(filteredKeys));
      setSelectedScenarioKeys((prev) => {
        const next = new Set(prev);
        for (const ck of allChildKeys) next.add(ck);
        return next;
      });
    }
  };

  const selectedEndpointsList = useMemo(
    () =>
      enrichedEndpoints.filter((ep) =>
        selectedEndpointKeys.has(getEpIdentityKey(ep)),
      ),
    [enrichedEndpoints, selectedEndpointKeys],
  );

  const toggleSelectScenario = (scKey) => {
    setSelectedScenarioKeys((prev) => {
      const next = new Set(prev);
      if (next.has(scKey)) next.delete(scKey);
      else next.add(scKey);
      return next;
    });
  };

  const selectedScenariosList = useMemo(() => {
    if (selectedScenarioKeys.size === 0) return [];
    const list = [];
    for (const ep of enrichedEndpoints) {
      const epKey = getEpIdentityKey(ep);
      for (const sc of ep.scenarios || []) {
        const scKey = getScenarioIdentityKey(sc, epKey);
        if (selectedScenarioKeys.has(scKey)) {
          list.push(sc);
        }
      }
    }
    return list;
  }, [enrichedEndpoints, selectedScenarioKeys]);

  const selectedHasScenarios = selectedEndpointsList.some(
    (ep) => (ep.scenarios || []).length > 0,
  );

  // STATE 1: Not yet scanned & 0 endpoints loaded
  if (!hasScanned && enrichedEndpoints.length === 0) {
    return (
      <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg overflow-hidden">
        <div className="px-5 py-3 border-b border-[var(--color-border)] bg-[var(--color-surface-secondary)] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Layers className="w-4 h-4 text-[var(--color-primary)]" />
            <h3 className="text-xs font-semibold text-[var(--color-text)]">
              Endpoints Matrix
            </h3>
          </div>
          <span className="px-2 py-0.5 rounded bg-[var(--color-bg)] border border-[var(--color-border)] text-[11px] font-mono text-[var(--color-text-muted)]">
            Awaiting scan
          </span>
        </div>

        <div className="py-12 px-6 max-w-2xl mx-auto">
          <div className="text-center mb-7">
            <h4 className="text-sm font-semibold text-[var(--color-text)] tracking-tight mb-1.5">
              Map your API routes before running coverage
            </h4>
            <p className="text-xs text-[var(--color-text-secondary)] max-w-md mx-auto leading-relaxed">
              Scan your Express/Node router AST to inspect route handlers, purpose, and logic, then run existing tests or generate a 100% Supertest suite.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-6">
            <div className="p-3.5 rounded-md bg-[var(--color-bg)] border border-[var(--color-border)]">
              <div className="flex items-center gap-2 text-xs font-semibold text-[var(--color-text)] mb-1">
                <Radar className="w-3.5 h-3.5 text-[var(--color-primary)]" />
                <span>1. Scan API routes</span>
              </div>
              <p className="text-[11px] text-[var(--color-text-muted)] leading-relaxed m-0">
                Extracts HTTP methods, paths, controller names, and source handler code without executing tests.
              </p>
            </div>
            <div className="p-3.5 rounded-md bg-[var(--color-bg)] border border-[var(--color-border)]">
              <div className="flex items-center gap-2 text-xs font-semibold text-[var(--color-text)] mb-1">
                <Sparkles className="w-3.5 h-3.5 text-[var(--color-primary)]" />
                <span>2. Run or generate tests</span>
              </div>
              <p className="text-[11px] text-[var(--color-text-muted)] leading-relaxed m-0">
                Measure Supertest coverage per endpoint, generate missing scenarios, and apply passing tests to your repo.
              </p>
            </div>
          </div>

          <div className="flex justify-center">
            <button
              type="button"
              onClick={onScanEndpoints}
              disabled={isScanning}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-md text-xs font-semibold bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white transition-colors duration-150 active:scale-[0.98] disabled:opacity-50 cursor-pointer"
            >
              {isScanning ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  <span>Scanning Express/Node AST...</span>
                </>
              ) : (
                <>
                  <Radar className="w-3.5 h-3.5" />
                  <span>Scan API Endpoints</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg overflow-hidden">
      {/* Compact Filter & Inspection Toolbar (No duplicate global header buttons) */}
      <div className="px-4 py-3 border-b border-[var(--color-border)] bg-[var(--color-surface-secondary)] flex flex-col gap-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          {/* Search Input */}
          <div className="relative flex-1 min-w-[240px]">
            <Search className="w-3.5 h-3.5 text-[var(--color-text-muted)] absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Filter by route path, handler, source file, or scenario..."
              className="w-full pl-8 pr-3 py-1.5 text-xs bg-[var(--color-bg)] border border-[var(--color-border)] rounded-md text-[var(--color-text)] placeholder:text-[var(--color-text-muted)] focus:outline-none focus:border-[var(--color-primary)] font-mono"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* HTTP Method Filter */}
            <div className="flex items-center gap-0.5 bg-[var(--color-bg)] p-0.5 rounded-md border border-[var(--color-border)]">
              {HTTP_METHODS.map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMethodFilter(m)}
                  className={`px-2 py-1 rounded text-[10px] font-mono font-bold transition-colors cursor-pointer ${
                    methodFilter === m
                      ? "bg-[var(--color-surface-secondary)] text-[var(--color-text)] border border-[var(--color-border)]"
                      : "text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
                  }`}
                >
                  {m}
                </button>
              ))}
            </div>

            {/* Status Filter */}
            <div className="flex items-center gap-0.5 bg-[var(--color-bg)] p-0.5 rounded-md border border-[var(--color-border)]">
              {[
                { id: "ALL", label: "All" },
                { id: "PASS", label: "Pass" },
                { id: "FAIL", label: "Fail" },
                { id: "UNCOVERED", label: "Uncovered" },
              ].map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setStatusFilter(s.id)}
                  className={`px-2 py-1 rounded text-[10px] font-medium transition-colors cursor-pointer ${
                    statusFilter === s.id
                      ? "bg-[var(--color-surface-secondary)] text-[var(--color-text)] border border-[var(--color-border)]"
                      : "text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>

            {modules.length > 2 && (
              <select
                value={moduleFilter}
                onChange={(e) => setModuleFilter(e.target.value)}
                className="px-2.5 py-1 text-[11px] bg-[var(--color-bg)] border border-[var(--color-border)] rounded-md text-[var(--color-text-secondary)] focus:outline-none focus:border-[var(--color-primary)] font-mono"
              >
                {modules.map((mod) => (
                  <option key={mod} value={mod}>
                    {mod === "ALL" ? "All modules" : mod.toUpperCase()}
                  </option>
                ))}
              </select>
            )}

            {onScanEndpoints && (
              <button
                type="button"
                onClick={onScanEndpoints}
                disabled={isScanning || isRunning}
                title="Rescan Express/Node AST to discover API routes and controllers"
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium bg-[var(--color-bg)] hover:bg-[var(--color-surface-hover)] text-[var(--color-text-secondary)] hover:text-[var(--color-text)] border border-[var(--color-border)] transition-colors duration-150 active:scale-[0.98] disabled:opacity-50 cursor-pointer"
              >
                <RefreshCw
                  className={`w-3.5 h-3.5 ${
                    isScanning
                      ? "animate-spin text-[var(--color-primary)]"
                      : "text-[var(--color-text-muted)]"
                  }`}
                />
                <span>{isScanning ? "Scanning..." : "Rescan APIs"}</span>
              </button>
            )}

            {onOpenAddScenario && (
              <button
                type="button"
                onClick={() => onOpenAddScenario(null)}
                disabled={isRunning}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-medium bg-[var(--color-bg)] hover:bg-[var(--color-surface-hover)] text-[var(--color-text)] border border-[var(--color-border)] transition-colors duration-150 active:scale-[0.98] disabled:opacity-50 cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5 text-[var(--color-primary)]" />
                <span>New Scenario</span>
              </button>
            )}

            <div className="flex items-center gap-2 text-[11px] text-[var(--color-text-muted)] pl-1">
              <button
                type="button"
                onClick={expandAll}
                className="hover:text-[var(--color-text)] transition-colors cursor-pointer"
              >
                Expand all
              </button>
              <button
                type="button"
                onClick={collapseAll}
                className="hover:text-[var(--color-text)] transition-colors cursor-pointer"
              >
                Collapse all
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Unified Selection Action Bar (Endpoints & Scenarios) */}
      {(selectedEndpointsList.length > 0 || selectedScenariosList.length > 0) && (
        <div className="px-4 py-2 border-b border-[var(--color-border)] bg-[var(--color-primary)]/5 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-xs font-mono text-[var(--color-text)] tabular-nums">
            {selectedEndpointsList.length > 0 && (
              <span>
                <span className="font-semibold text-[var(--color-primary)]">
                  {selectedEndpointsList.length}
                </span>{" "}
                {selectedEndpointsList.length === 1 ? "endpoint" : "endpoints"}
              </span>
            )}
            {selectedEndpointsList.length > 0 && selectedScenariosList.length > 0 && (
              <span className="text-[var(--color-text-muted)]">·</span>
            )}
            {selectedScenariosList.length > 0 && (
              <span>
                <span className="font-semibold text-emerald-400">
                  {selectedScenariosList.length}
                </span>{" "}
                {selectedScenariosList.length === 1 ? "scenario" : "scenarios"}
              </span>
            )}
            <span className="text-[var(--color-text-muted)]">selected</span>
          </div>

          <div className="flex items-center gap-2">
            {onGenerateSelected && selectedEndpointsList.length > 0 && (
              <button
                type="button"
                onClick={() => onGenerateSelected(selectedEndpointsList)}
                disabled={isGenerating || isRunning}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold bg-[var(--color-surface)] hover:bg-[var(--color-surface-hover)] text-[var(--color-primary)] border border-[var(--color-primary)]/40 transition-colors disabled:opacity-50 cursor-pointer"
              >
                <Sparkles className="w-3 h-3" />
                <span className="tabular-nums">
                  Generate Tests ({selectedEndpointsList.length})
                </span>
              </button>
            )}

            {(selectedScenariosList.length > 0
              ? onRunSelectedScenarios
              : onRunSelected && selectedHasScenarios) && (
              <button
                type="button"
                onClick={() =>
                  selectedScenariosList.length > 0
                    ? onRunSelectedScenarios(selectedScenariosList)
                    : onRunSelected(selectedEndpointsList)
                }
                disabled={isRunning || isGenerating}
                className="inline-flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-semibold bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white transition-colors disabled:opacity-50 cursor-pointer"
              >
                <Play className="w-3 h-3" fill="currentColor" />
                <span className="tabular-nums">
                  Run (
                  {selectedScenariosList.length > 0
                    ? selectedScenariosList.length
                    : selectedEndpointsList.length}
                  )
                </span>
              </button>
            )}

            {onApplyScenario &&
              selectedScenariosList.some((sc) => sc.aiTestId && sc.scenarioId) && (
                <button
                  type="button"
                  onClick={() => {
                    const first = selectedScenariosList[0];
                    if (first) onApplyScenario(first);
                  }}
                  disabled={isRunning || isGenerating}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold bg-[var(--color-surface)] hover:bg-[var(--color-surface-hover)] text-[var(--color-text)] border border-[var(--color-border)] transition-colors disabled:opacity-50 cursor-pointer"
                >
                  <HardDriveDownload className="w-3 h-3 text-[var(--color-primary)]" />
                  <span className="tabular-nums">
                    Apply ({selectedScenariosList.length})
                  </span>
                </button>
              )}

            <button
              type="button"
              onClick={() => {
                setSelectedEndpointKeys(new Set());
                setSelectedScenarioKeys(new Set());
              }}
              className="px-2 py-1 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)] cursor-pointer"
            >
              Clear
            </button>
          </div>
        </div>
      )}

      {/* Unified 5-Column Route Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-[var(--color-border)] bg-[var(--color-surface-secondary)]/50 text-[11px] font-medium text-[var(--color-text-muted)]">
              <th className="py-2.5 pl-4 pr-2 w-10">
                <input
                  type="checkbox"
                  aria-label="Select all visible endpoints"
                  checked={
                    filteredEndpoints.length > 0 &&
                    filteredEndpoints.every((ep) =>
                      selectedEndpointKeys.has(getEpIdentityKey(ep)),
                    )
                  }
                  onChange={toggleSelectAllFiltered}
                  className="rounded border-[var(--color-border)] bg-[var(--color-bg)] accent-[var(--color-primary)] cursor-pointer"
                />
              </th>
              <th className="py-2.5 px-3">Endpoint</th>
              <th className="py-2.5 px-3 w-52">Handler</th>
              <th className="py-2.5 px-3 w-28">Status</th>
              <th className="py-2.5 px-3 w-24 text-right">Scenarios</th>
              <th className="py-2.5 pl-3 pr-4 w-48 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--color-border)] text-xs">
            {filteredEndpoints.length === 0 ? (
              <tr>
                <td
                  colSpan={6}
                  className="py-12 text-center text-[var(--color-text-muted)] font-mono text-xs"
                >
                  {enrichedEndpoints.length === 0
                    ? "No Express/Node API endpoints were detected in this snapshot."
                    : "No API endpoints match the current filter criteria."}
                </td>
              </tr>
            ) : (
              filteredEndpoints.map((ep, idx) => {
                const method = (ep.method || "GET").toUpperCase();
                const rowKey = `${method}-${ep.path}-${idx}`;
                const isExpanded = expandedRows.has(rowKey);
                const status = getEndpointStatus(ep);
                const scenarios = ep.scenarios || [];
                const scenarioCount = scenarios.length;
                const epActionKey = getEpIdentityKey(ep);
                const isSelected = selectedEndpointKeys.has(epActionKey);
                const isThisGenerating =
                  isGenerating && generatingKey === epActionKey;
                const isThisRunning = isRunning && runningKey === epActionKey;
                const sourceFile = ep.file || ep.sourceFile || "express-router";
                const sourceLine = ep.source?.sourceLine || ep.line || null;
                const hasLogicSnippet = Boolean(
                  ep.source?.controllerSnippet || ep.source?.routeSnippet,
                );
                const showLogic =
                  hasLogicSnippet &&
                  (expandedLogicKeys.has(rowKey) || scenarioCount === 0);

                return (
                  <React.Fragment key={rowKey}>
                    <tr
                      onClick={() => toggleRow(rowKey)}
                      className={`group transition-colors cursor-pointer ${
                        isExpanded
                          ? "bg-[var(--color-surface-secondary)]/50"
                          : isSelected
                            ? "bg-[var(--color-primary)]/[0.04]"
                            : "hover:bg-[var(--color-surface-secondary)]/30"
                      }`}
                    >
                      <td
                        className="py-3.5 pl-4 pr-2 text-[var(--color-text-muted)] align-top"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="flex items-center gap-2 pt-0.5">
                          <input
                            type="checkbox"
                            aria-label={`Select ${method} ${ep.path}`}
                            checked={isSelected}
                            onChange={() => toggleSelectEndpoint(epActionKey)}
                            className="rounded border-[var(--color-border)] bg-[var(--color-bg)] accent-[var(--color-primary)] cursor-pointer"
                          />
                          <button
                            type="button"
                            onClick={() => toggleRow(rowKey)}
                            className="text-[var(--color-text-muted)] hover:text-[var(--color-text)] cursor-pointer"
                          >
                            {isExpanded ? (
                              <ChevronDown className="w-3.5 h-3.5 text-[var(--color-primary)]" />
                            ) : (
                              <ChevronRight className="w-3.5 h-3.5 group-hover:text-[var(--color-text)]" />
                            )}
                          </button>
                        </div>
                      </td>

                      {/* Endpoint (Method + Path + Description) */}
                      <td className="py-3.5 px-3 align-top">
                        <div className="flex items-center gap-2.5">
                          <span
                            className={`inline-flex items-center justify-center w-14 py-0.5 rounded text-[10px] font-mono font-bold border shrink-0 ${
                              METHOD_STYLES[method] || METHOD_STYLES.DEFAULT
                            }`}
                          >
                            {method}
                          </span>
                          <span className="font-mono text-[13px] font-semibold text-[var(--color-text)] tracking-tight">
                            {ep.path}
                          </span>
                          {ep.authRequired && (
                            <span
                              title="Authentication Middleware Detected"
                              className="px-1.5 py-0.2 rounded text-[9px] font-mono bg-purple-500/10 text-purple-400 border border-purple-500/20"
                            >
                              Auth
                            </span>
                          )}
                        </div>
                        {ep.description && (
                          <p className="text-[11px] text-[var(--color-text-muted)] mt-1 pl-[66px] line-clamp-1 font-sans">
                            {ep.description}
                          </p>
                        )}
                      </td>

                      {/* Handler + Source File merged cleanly */}
                      <td className="py-3.5 px-3 align-top">
                        <div className="font-mono text-[11px] text-[var(--color-text-secondary)] truncate max-w-[190px]">
                          {ep.controller || ep.handler || "anonymousHandler"}
                        </div>
                        <button
                          type="button"
                          onClick={(e) => {
                            if (
                              onOpenSourceFile &&
                              sourceFile &&
                              sourceFile !== "express-router"
                            ) {
                              e.stopPropagation();
                              onOpenSourceFile(sourceFile, sourceLine || 1);
                            }
                          }}
                          className={`mt-0.5 inline-flex items-center gap-1 font-mono text-[10px] text-[var(--color-text-muted)] ${
                            onOpenSourceFile && sourceFile !== "express-router"
                              ? "hover:text-[var(--color-primary)] hover:underline cursor-pointer"
                              : "cursor-default"
                          }`}
                          title={sourceFile}
                        >
                          <FileCode className="w-2.5 h-2.5 shrink-0 opacity-70" />
                          <span className="truncate max-w-[175px]">
                            {sourceFile}
                            {sourceLine ? `:${sourceLine}` : ""}
                          </span>
                        </button>
                      </td>

                      {/* Clean Status Indicator */}
                      <td className="py-3.5 px-3 align-top">
                        <div className="pt-0.5">
                          {!hasAnalyzedCoverage && scenarioCount === 0 ? (
                            <span className="inline-flex items-center gap-1.5 text-[11px] text-[var(--color-text-muted)]">
                              <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-text-muted)]" />
                              Discovered
                            </span>
                          ) : status === "PASS" ? (
                            <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-emerald-400">
                              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                              Covered
                            </span>
                          ) : status === "FAIL" ? (
                            <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-rose-400">
                              <span className="w-1.5 h-1.5 rounded-full bg-rose-400" />
                              Failed
                            </span>
                          ) : status === "READY" ? (
                            <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-sky-400">
                              <span className="w-1.5 h-1.5 rounded-full bg-sky-400" />
                              Ready
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1.5 text-[11px] text-amber-400">
                              <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                              Uncovered
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Scenarios Count */}
                      <td className="py-3.5 px-3 text-right font-mono tabular-nums text-[11px] align-top">
                        <div className="pt-0.5">
                          {!hasAnalyzedCoverage && scenarioCount === 0 ? (
                            <span className="text-[var(--color-text-muted)]">—</span>
                          ) : (
                            <span className="text-[var(--color-text-secondary)]">
                              {scenarioCount}{" "}
                              {scenarioCount === 1 ? "test" : "tests"}
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Quiet Row Actions */}
                      <td
                        className="py-3.5 pl-3 pr-4 text-right align-top"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="inline-flex items-center justify-end gap-1 opacity-80 group-hover:opacity-100 transition-opacity">
                          {onOpenAddScenario && (
                            <button
                              type="button"
                              onClick={() => onOpenAddScenario(ep)}
                              disabled={isRunning}
                              title="Add a test scenario for this endpoint"
                              className="inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-secondary)] transition-colors cursor-pointer"
                            >
                              <Plus className="w-3 h-3" />
                              <span>Add</span>
                            </button>
                          )}

                          {onGenerateTest && (
                            <button
                              type="button"
                              onClick={() => onGenerateTest(ep)}
                              disabled={isGenerating || isRunning}
                              title="Generate AI multi-scenario suite for this endpoint"
                              className="inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium text-[var(--color-primary)] hover:bg-[var(--color-primary)]/10 transition-colors disabled:opacity-50 cursor-pointer"
                            >
                              {isThisGenerating ? (
                                <RefreshCw className="w-3 h-3 animate-spin" />
                              ) : (
                                <Zap className="w-3 h-3" />
                              )}
                              <span>AI Gen</span>
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>

                    {/* Expanded API Details, Logic Code & Scenarios */}
                    {isExpanded && (
                      <tr className="bg-[#0D1219]">
                        <td colSpan={6} className="p-0">
                          <div className="px-6 py-4 border-l-2 border-[var(--color-primary)] space-y-3.5">
                            {/* Compact Contract Metadata + Handler Code Toggle */}
                            <div className="flex flex-wrap items-center justify-between gap-3 text-[11px] font-mono text-[var(--color-text-muted)] pb-2.5 border-b border-[var(--color-border)]/70">
                              <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                                {(ep.source?.behaviorEvidence?.bodyParams || []).length > 0 && (
                                  <span>
                                    Body:{" "}
                                    <span className="text-[var(--color-text-secondary)]">
                                      {ep.source.behaviorEvidence.bodyParams.join(", ")}
                                    </span>
                                  </span>
                                )}
                                {(ep.source?.behaviorEvidence?.pathParams || ep.source?.params || []).length > 0 && (
                                  <span>
                                    Params:{" "}
                                    <span className="text-[var(--color-text-secondary)]">
                                      {(ep.source?.behaviorEvidence?.pathParams || ep.source?.params).join(", ")}
                                    </span>
                                  </span>
                                )}
                                {(ep.source?.behaviorEvidence?.queryParams || ep.source?.queryParams || []).length > 0 && (
                                  <span>
                                    Query:{" "}
                                    <span className="text-[var(--color-text-secondary)]">
                                      {(ep.source?.behaviorEvidence?.queryParams || ep.source?.queryParams).join(", ")}
                                    </span>
                                  </span>
                                )}
                                <span>
                                  Status:{" "}
                                  <span className="text-[var(--color-text-secondary)]">
                                    {(ep.source?.behaviorEvidence?.responseStatusCodes || ep.source?.responseStatusCodes || []).join(", ") || "200"}
                                  </span>
                                </span>
                                {ep.source?.controllerFile && (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      onOpenSourceFile?.(
                                        ep.source.controllerFile,
                                        ep.source.controllerLine || 1,
                                      )
                                    }
                                    className="inline-flex items-center gap-1 hover:text-[var(--color-primary)] cursor-pointer"
                                  >
                                    <FileCode className="w-3 h-3" />
                                    <span>
                                      {ep.source.controllerFile.split(/[\\/]/).pop()}
                                      {ep.source.controllerLine ? `:${ep.source.controllerLine}` : ""}
                                    </span>
                                  </button>
                                )}
                              </div>

                              {hasLogicSnippet && (
                                <button
                                  type="button"
                                  onClick={() => toggleLogicSnippet(rowKey)}
                                  className="inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] bg-[var(--color-surface)] hover:bg-[var(--color-surface-secondary)] text-[var(--color-text-secondary)] border border-[var(--color-border)] cursor-pointer transition-colors"
                                >
                                  <Code2 className="w-3 h-3 text-[var(--color-primary)]" />
                                  <span>{showLogic ? "Hide Handler Code" : "Handler Code"}</span>
                                </button>
                              )}
                            </div>

                            {/* Collapsible Handler Logic Code */}
                            {showLogic && (
                              <div className="rounded-md border border-[var(--color-border)] bg-[#090D12] overflow-hidden">
                                <div className="px-3 py-1.5 bg-[var(--color-surface)] border-b border-[var(--color-border)] flex items-center justify-between text-[11px] font-mono text-[var(--color-text-muted)]">
                                  <span>Handler Logic</span>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      handleCopyCode(
                                        `logic-${rowKey}`,
                                        ep.source?.controllerSnippet || ep.source?.routeSnippet,
                                      )
                                    }
                                    className="inline-flex items-center gap-1 text-[10px] hover:text-[var(--color-text)] cursor-pointer"
                                  >
                                    {copiedKey === `logic-${rowKey}` ? (
                                      <>
                                        <Check className="w-3 h-3 text-emerald-400" />
                                        <span>Copied</span>
                                      </>
                                    ) : (
                                      <>
                                        <Copy className="w-3 h-3" />
                                        <span>Copy</span>
                                      </>
                                    )}
                                  </button>
                                </div>
                                <pre className="p-3 text-[11px] font-mono text-slate-300 overflow-x-auto max-h-48 custom-scrollbar leading-relaxed">
                                  {ep.source?.controllerSnippet || ep.source?.routeSnippet}
                                </pre>
                              </div>
                            )}

                            {/* Case Coverage & Execution Readiness Strip */}
                            {(() => {
                              const cov = getEndpointCaseCoverage(ep, scenarios);
                              return (
                                <div className="flex flex-wrap items-center justify-between gap-3 px-3 py-2 rounded-md border border-[var(--color-border)]/80 bg-[var(--color-surface)]/70 text-[11px] font-mono">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <span className="text-[var(--color-text-muted)]">
                                      Case coverage ({cov.coveredCount}/{cov.totalRequired}):
                                    </span>
                                    {cov.cases.map((c) => (
                                      <span
                                        key={c.key}
                                        className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border ${
                                          c.covered
                                            ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/25"
                                            : "bg-amber-500/10 text-amber-400 border-amber-500/25"
                                        }`}
                                      >
                                        <span>{c.covered ? "✓" : "○"}</span>
                                        <span>{c.label}</span>
                                      </span>
                                    ))}
                                  </div>
                                  <div className="flex items-center gap-2 text-[var(--color-text-secondary)] tabular-nums">
                                    {scenarios.length === 0 ? (
                                      <span className="text-[var(--color-text-muted)]">No scenarios</span>
                                    ) : cov.passedCount + cov.failedCount === 0 ? (
                                      <span className="text-[var(--color-text-muted)]">
                                        {scenarios.length} ready • not run yet
                                      </span>
                                    ) : (
                                      <span>
                                        <span className="text-emerald-400">{cov.passedCount} passed</span>
                                        {cov.failedCount > 0 && (
                                          <span className="text-rose-400"> • {cov.failedCount} failed</span>
                                        )}
                                        {cov.notRunCount > 0 && (
                                          <span className="text-[var(--color-text-muted)]"> • {cov.notRunCount} pending</span>
                                        )}
                                      </span>
                                    )}
                                  </div>
                                </div>
                              );
                            })()}

                            {/* Test Scenarios Section (Shown after Run Coverage or if scenarios already exist) */}
                            {!hasAnalyzedCoverage && scenarios.length === 0 ? (
                              <div className="px-4 py-3 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--color-text-secondary)]">
                                <span>
                                  Test scenarios have not been scanned yet. Click{" "}
                                  <span className="font-semibold text-[var(--color-text)]">Run Coverage</span>{" "}
                                  above to scan project tests and measure coverage, or generate 100% tests for this API.
                                </span>
                                {onGenerateTest && (
                                  <button
                                    type="button"
                                    onClick={() => onGenerateTest(ep)}
                                    disabled={isGenerating || isRunning}
                                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded text-[11px] font-semibold bg-[var(--color-surface-secondary)] hover:bg-[var(--color-surface-hover)] text-[var(--color-primary)] border border-[var(--color-primary)]/30 cursor-pointer"
                                  >
                                    <Sparkles className="w-3 h-3" />
                                    <span>Generate 100% Tests</span>
                                  </button>
                                )}
                              </div>
                            ) : scenarios.length > 0 ? (
                              <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] divide-y divide-[var(--color-border)]/70 overflow-hidden">
                                {scenarios.map((sc, sIdx) => {
                                  const scStatus = (
                                    sc.status || "READY"
                                  ).toUpperCase();
                                  const scPassed =
                                    scStatus === "PASSED" || scStatus === "PASS";
                                  const scFailed =
                                    scStatus === "FAILED" || scStatus === "FAIL";
                                  const catInfo = classifyScenario(sc);
                                  const scKey = `${rowKey}-sc-${sc.scenarioId || sIdx}`;
                                  const isCodeOpen =
                                    expandedScenarioCodeKey === scKey;
                                  const canMutate = Boolean(
                                    sc.aiTestId && sc.scenarioId,
                                  );
                                  const isEnabled = sc.enabled !== false;

                                  const scIdentityKey = getScenarioIdentityKey(
                                    sc,
                                    getEpIdentityKey(ep),
                                  );
                                  const isSelectedSc = selectedScenarioKeys.has(
                                    scIdentityKey,
                                  );

                                  return (
                                    <div
                                      key={scKey}
                                      className={`group/sc transition-colors ${
                                        !isEnabled
                                          ? "opacity-55"
                                          : isSelectedSc
                                            ? "bg-emerald-500/[0.04]"
                                            : scFailed
                                              ? "bg-rose-500/[0.03]"
                                              : "hover:bg-[var(--color-surface-secondary)]/35"
                                      }`}
                                    >
                                      <div className="px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-3">
                                        <div className="flex items-start gap-2.5 min-w-0 flex-1">
                                          {/* Scenario Multi-Select Checkbox */}
                                          <input
                                            type="checkbox"
                                            checked={isSelectedSc}
                                            onChange={() =>
                                              toggleSelectScenario(scIdentityKey)
                                            }
                                            aria-label={`Select scenario ${sc.title || sIdx + 1}`}
                                            className="mt-1 rounded border-[var(--color-border)] bg-[var(--color-surface)] text-emerald-500 focus:ring-0 cursor-pointer shrink-0"
                                          />

                                          {/* Pass/Fail Status Icon */}
                                          {scPassed ? (
                                            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                                          ) : scFailed ? (
                                            <XCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                                          ) : null}

                                          <div className="min-w-0 flex-1">
                                            <div className="text-xs font-medium text-[var(--color-text)] break-words">
                                              {sc.title ||
                                                sc.name ||
                                                `Scenario #${sIdx + 1}`}
                                            </div>
                                            <div className="flex flex-wrap items-center gap-2 mt-1 text-[10px] font-mono text-[var(--color-text-muted)]">
                                              <span
                                                className={`px-1.5 py-0.2 rounded border font-semibold ${catInfo.color}`}
                                              >
                                                {catInfo.label}
                                              </span>
                                              <span className="px-1.5 py-0.2 rounded bg-[var(--color-bg)] border border-[var(--color-border)] text-[var(--color-text-muted)]">
                                                {sc.userEdited
                                                  ? "Edited"
                                                  : sc.origin === "AI_GENERATED" || sc.origin === "AI"
                                                    ? "AI"
                                                    : sc.origin || "AI"}
                                              </span>
                                              {sc.expectedStatus && (
                                                <span className="tabular-nums">
                                                  Expected{" "}
                                                  <strong className="text-[var(--color-text-secondary)]">
                                                    {sc.expectedStatus}
                                                  </strong>
                                                </span>
                                              )}
                                              {sc.actualStatus && (
                                                <span
                                                  className={`tabular-nums ${
                                                    Number(sc.actualStatus) ===
                                                    Number(sc.expectedStatus)
                                                      ? "text-emerald-400"
                                                      : "text-rose-400 font-semibold"
                                                  }`}
                                                >
                                                  Actual {sc.actualStatus}
                                                </span>
                                              )}
                                              {sc.duration !== undefined &&
                                                sc.duration !== null && (
                                                  <span className="tabular-nums">
                                                    {sc.duration}ms
                                                  </span>
                                                )}
                                              {scFailed && sc.failureLayer && (
                                                <span className="px-1.5 py-0.2 rounded bg-rose-500/10 border border-rose-500/25 text-rose-400 font-semibold">
                                                  {sc.failureLayer}
                                                </span>
                                              )}
                                            </div>
                                          </div>
                                        </div>

                                        {/* Quiet Ghost Scenario Actions */}
                                        <div className="flex items-center gap-0.5 shrink-0 opacity-75 group-hover/sc:opacity-100 transition-opacity">
                                          {scFailed &&
                                            canMutate &&
                                            onAIFixScenario && (
                                              <button
                                                type="button"
                                                onClick={() =>
                                                  onAIFixScenario(sc, ep)
                                                }
                                                disabled={isRunning}
                                                title="Auto-repair this failed scenario using AI diagnostics"
                                                className="inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium text-amber-400 hover:bg-amber-500/10 transition-colors cursor-pointer"
                                              >
                                                <Wrench className="w-2.5 h-2.5" />
                                                <span>AI Fix</span>
                                              </button>
                                            )}

                                          {onOpenEditScenario && (
                                            <button
                                              type="button"
                                              onClick={() =>
                                                onOpenEditScenario(sc, ep)
                                              }
                                              title={
                                                canMutate
                                                  ? "Edit scenario code in Monaco Editor"
                                                  : "Inspect scenario code in Monaco Editor"
                                              }
                                              className="inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-secondary)] transition-colors cursor-pointer"
                                            >
                                              <Edit3 className="w-2.5 h-2.5 text-[var(--color-primary)]" />
                                              <span>
                                                {canMutate ? "Edit" : "Editor"}
                                              </span>
                                            </button>
                                          )}

                                          <button
                                            type="button"
                                            onClick={() =>
                                              setExpandedScenarioCodeKey(
                                                isCodeOpen ? null : scKey,
                                              )
                                            }
                                            className={`inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium transition-colors cursor-pointer ${
                                              isCodeOpen
                                                ? "bg-[var(--color-primary)]/15 text-[var(--color-primary)]"
                                                : "text-[var(--color-text-secondary)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-secondary)]"
                                            }`}
                                          >
                                            <Code2 className="w-2.5 h-2.5" />
                                            <span>
                                              {isCodeOpen ? "Hide" : "Code"}
                                            </span>
                                          </button>

                                          {canMutate && onDeleteScenario && (
                                            <>
                                              {confirmDeleteKey === scKey ? (
                                                <div className="inline-flex items-center gap-1">
                                                  <button
                                                    type="button"
                                                    onClick={() => {
                                                      onDeleteScenario(sc);
                                                      setConfirmDeleteKey(null);
                                                    }}
                                                    className="px-2 py-1 rounded text-[10px] font-semibold bg-rose-500 text-white hover:bg-rose-600 transition-colors cursor-pointer"
                                                  >
                                                    Confirm
                                                  </button>
                                                  <button
                                                    type="button"
                                                    onClick={() =>
                                                      setConfirmDeleteKey(null)
                                                    }
                                                    className="px-1.5 py-1 rounded text-[10px] text-[var(--color-text-muted)] hover:text-[var(--color-text)] cursor-pointer"
                                                  >
                                                    Cancel
                                                  </button>
                                                </div>
                                              ) : (
                                                <button
                                                  type="button"
                                                  onClick={() =>
                                                    setConfirmDeleteKey(scKey)
                                                  }
                                                  title="Delete this scenario"
                                                  className="p-1 rounded text-[var(--color-text-muted)] hover:text-rose-400 hover:bg-rose-500/10 transition-colors cursor-pointer"
                                                >
                                                  <Trash2 className="w-3.5 h-3.5" />
                                                </button>
                                              )}
                                            </>
                                          )}
                                        </div>
                                      </div>

                                      {/* Inline Preview & Failure Diagnostics Drawer */}
                                      {isCodeOpen && (
                                        <div className="px-3.5 pb-3 pt-2 border-t border-[var(--color-border)] bg-[var(--color-bg)] space-y-2">
                                          {(sc.executionReason ||
                                            (sc.failureMessages &&
                                              sc.failureMessages.length >
                                                0)) && (
                                            <div className="p-2.5 rounded bg-rose-500/10 border border-rose-500/25 text-[11px] font-mono text-rose-300 space-y-1">
                                              <div className="flex items-center gap-1.5 font-semibold text-rose-400">
                                                <AlertTriangle className="w-3.5 h-3.5" />
                                                <span>
                                                  Execution Diagnostics
                                                </span>
                                              </div>
                                              <pre className="whitespace-pre-wrap break-words text-[10px] max-h-40 overflow-y-auto">
                                                {sc.executionReason ||
                                                  sc.failureMessages?.join(
                                                    "\n",
                                                  )}
                                              </pre>
                                            </div>
                                          )}

                                          {sc.code ? (
                                            <div className="rounded border border-[var(--color-border)] overflow-hidden">
                                              <div className="px-3 py-1.5 bg-[var(--color-surface-secondary)] border-b border-[var(--color-border)] flex items-center justify-between text-[10px] font-mono text-[var(--color-text-muted)]">
                                                <span>
                                                  {sc.filePath ||
                                                    "integration.test.js"}
                                                </span>
                                                <button
                                                  type="button"
                                                  onClick={() =>
                                                    handleCopyCode(
                                                      scKey,
                                                      sc.code,
                                                    )
                                                  }
                                                  className="inline-flex items-center gap-1 hover:text-[var(--color-text)] cursor-pointer"
                                                >
                                                  {copiedKey === scKey ? (
                                                    <>
                                                      <Check className="w-3 h-3 text-emerald-400" />
                                                      <span className="text-emerald-400">
                                                        Copied
                                                      </span>
                                                    </>
                                                  ) : (
                                                    <>
                                                      <Copy className="w-3 h-3" />
                                                      <span>Copy</span>
                                                    </>
                                                  )}
                                                </button>
                                              </div>
                                              <pre className="p-3 text-[11px] font-mono text-[var(--color-text)] overflow-x-auto max-h-64">
                                                {sc.code}
                                              </pre>
                                            </div>
                                          ) : (
                                            <div className="text-[11px] font-mono text-[var(--color-text-muted)] py-2">
                                              No inline snippet available. Click{" "}
                                              <strong>Edit Code</strong> to
                                              open the test file in Monaco.
                                            </div>
                                          )}
                                        </div>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            ) : (
                              <div className="p-5 rounded-md border border-dashed border-[var(--color-border)] bg-[var(--color-surface)] flex flex-col sm:flex-row items-center justify-between gap-4">
                                <div>
                                  <div className="text-xs font-semibold text-[var(--color-text)]">
                                    Uncovered API Endpoint (0 Scenarios)
                                  </div>
                                  <div className="text-[11px] text-[var(--color-text-muted)] mt-0.5">
                                    Generate a complete 5-layer test suite
                                    (Happy Path, Validation 400, Auth 401/403,
                                    Not Found 404, Edge Cases) or write a custom
                                    scenario.
                                  </div>
                                </div>
                                <div className="flex items-center gap-2 shrink-0">
                                  {onOpenAddScenario && (
                                    <button
                                      type="button"
                                      onClick={() => onOpenAddScenario(ep)}
                                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-[var(--color-bg)] hover:bg-[var(--color-surface-hover)] text-[var(--color-text)] border border-[var(--color-border)] transition-colors cursor-pointer"
                                    >
                                      <Plus className="w-3.5 h-3.5" />
                                      <span>Add Custom Scenario</span>
                                    </button>
                                  )}
                                  {onGenerateTest && (
                                    <button
                                      type="button"
                                      onClick={() => onGenerateTest(ep)}
                                      disabled={isGenerating || isRunning}
                                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white transition-colors disabled:opacity-50 cursor-pointer"
                                    >
                                      <Sparkles className="w-3.5 h-3.5" />
                                      <span>Generate AI Scenarios</span>
                                    </button>
                                  )}
                                </div>
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

      {/* Unmapped / General Scenarios Section (if any exist) */}
      {unmappedScenarios.length > 0 && (
        <div className="border-t border-[var(--color-border)] bg-[var(--color-surface-secondary)]/50 p-4 space-y-2">
          <div className="flex items-center justify-between">
            <div className="text-[11px] font-bold uppercase tracking-wider text-[var(--color-text-secondary)]">
              Additional Suite Scenarios ({unmappedScenarios.length})
            </div>
          </div>
          <div className="space-y-1.5">
            {unmappedScenarios.map((sc, idx) => (
              <div
                key={`unmapped-${sc.scenarioId || idx}`}
                className="px-3 py-2 rounded bg-[var(--color-surface)] border border-[var(--color-border)] flex items-center justify-between gap-3 text-xs"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-bold border ${
                      METHOD_STYLES[(sc.method || "GET").toUpperCase()] ||
                      METHOD_STYLES.DEFAULT
                    }`}
                  >
                    {(sc.method || "GET").toUpperCase()}
                  </span>
                  <span className="font-mono text-[11px] text-[var(--color-text-secondary)]">
                    {sc.path || "/"}
                  </span>
                  <span className="text-[var(--color-text)] truncate">
                    {sc.title}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {onOpenEditScenario && (
                    <button
                      type="button"
                      onClick={() =>
                        onOpenEditScenario(sc, {
                          method: sc.method || "GET",
                          path: sc.path || "/",
                        })
                      }
                      className="inline-flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium bg-[var(--color-bg)] hover:bg-[var(--color-surface-hover)] text-[var(--color-text-secondary)] hover:text-[var(--color-text)] border border-[var(--color-border)] cursor-pointer"
                    >
                      <Edit3 className="w-2.5 h-2.5" />
                      <span>Edit Code</span>
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
