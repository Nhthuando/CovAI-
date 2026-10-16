/* eslint-disable no-unused-vars */
import { useState } from "react";
import {
  Database,
  FileCode,
  Shield,
  Sparkles,
  Clock,
  CheckCircle,
  XCircle,
  Eye,
  Activity,
  ArrowLeft,
  CheckCircle2,
  AlertTriangle,
  HelpCircle,
  Layers,
  Server,
  Code,
  ExternalLink,
  Copy,
  Check,
  ChevronRight,
  Hash,
} from "lucide-react";
import SourceCodeViewerModal from "./SourceCodeViewerModal.jsx";

const HTTP_STATUS_LABELS = {
  200: "200 OK",
  201: "201 Created",
  202: "202 Accepted",
  204: "204 No Content",
  400: "400 Bad Request",
  401: "401 Unauthorized",
  403: "403 Forbidden",
  404: "404 Not Found",
  409: "409 Conflict",
  422: "422 Unprocessable Entity",
  500: "500 Internal Server Error",
};

export default function IntegrationEndpointDetail({
  endpoint,
  aiTests,
  hasGeneratedTests,
  isApproved,
  selectedTestIds,
  setSelectedTestIds,
  snapshotId,
  projectId,
  endpoints,
  onOpenCFG,
  onSuggestTestcase,
  onOpenArchitecture,
  onScenarioChange,
  onError,
  onGenerateThisEndpoint,
  onOpenFile,
  onBackToTargets,
  isGenerating = false,
}) {
  const [tab, setTab] = useState("EVIDENCE"); // EVIDENCE | EXECUTION
  const [codeModalOpen, setCodeModalOpen] = useState(false);
  const [codeModalInitialIdx, setCodeModalInitialIdx] = useState(0);
  const [copiedSnippet, setCopiedSnippet] = useState(null);

  if (!endpoint) return null;

  // Extract source & verification data with safe fallbacks
  const source = endpoint.source || {};
  const verification = endpoint.verification || {};
  const processingChain = endpoint.requestProcessingChain || source.requestProcessingChain || null;
  const behavior = endpoint.behaviorEvidence || source.behaviorEvidence || {};

  // Build files available for quick inspection in the code viewer modal
  const fileOptions = [];
  if (source.controllerFile) {
    fileOptions.push({
      label: "Controller Handler",
      filePath: source.controllerFile,
      line: source.controllerLineStart || source.controllerLine,
      method: source.controllerMethod,
    });
  }
  if (source.sourceFile) {
    fileOptions.push({
      label: "Route Declaration",
      filePath: source.sourceFile,
      line: source.sourceLineStart || source.sourceLine || endpoint.provenance?.sourceLine,
      method: `${endpoint.method} ${endpoint.path || ""}`,
    });
  }
  if (processingChain?.service?.file) {
    fileOptions.push({
      label: "Service Layer",
      filePath: processingChain.service.file,
      line: processingChain.service.lineStart || 1,
      method: processingChain.service.name,
    });
  }

  const handleCopy = (text, key) => {
    if (!text) return;
    navigator.clipboard.writeText(text);
    setCopiedSnippet(key);
    setTimeout(() => setCopiedSnippet(null), 2000);
  };

  // Verification status facets
  const sourceStatus = verification.source?.status || (source.sourceFile ? "FOUND_IN_SOURCE" : "SOURCE_UNVERIFIED");
  const runtimeStatus = verification.runtime?.status || (endpoint.executedCount > 0 ? "RUNTIME_VERIFIED" : "NOT_EXECUTED");
  const contractStatus = verification.contract?.status || "CONTRACT_UNVERIFIED";

  // Formatted discovery timestamp
  const analyzedAtFormatted = verification.discovery?.analyzedAt
    ? new Date(verification.discovery.analyzedAt).toLocaleString("vi-VN", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "Current Session";

  return (
    <div className="flex flex-col h-full min-h-0 font-sans text-[var(--color-text)] overflow-hidden bg-[var(--color-bg)]">
      {/* Top Identity & Action Header */}
      <div className="px-6 py-4 border-b border-[var(--color-border)] bg-[var(--color-surface)] shrink-0">
        <div className="flex items-center justify-between gap-4 mb-3">
          <div className="flex items-center gap-3 min-w-0">
            {onBackToTargets && (
              <button
                type="button"
                onClick={onBackToTargets}
                className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded bg-[var(--color-surface-secondary)] text-[var(--color-text-secondary)] hover:text-[var(--color-text)] border border-[var(--color-border)] transition-colors cursor-pointer shrink-0"
                title="Return to full endpoint targets list"
              >
                <ArrowLeft size={13} />
                <span>All Targets</span>
              </button>
            )}

            <span
              className={`px-2 py-0.5 rounded text-xs font-bold border font-mono tracking-tight shrink-0
              ${endpoint.method === "GET" ? "bg-[var(--color-info)]/10 text-[var(--color-info)] border-[var(--color-info)]/20" : ""}
              ${endpoint.method === "POST" ? "bg-[var(--color-success)]/10 text-[var(--color-success)] border-[var(--color-success)]/20" : ""}
              ${endpoint.method === "PUT" ? "bg-[var(--color-warning)]/10 text-[var(--color-warning)] border-[var(--color-warning)]/20" : ""}
              ${endpoint.method === "PATCH" ? "bg-purple-500/10 text-purple-400 border-purple-500/20" : ""}
              ${endpoint.method === "DELETE" ? "bg-[var(--color-danger)]/10 text-[var(--color-danger)] border-[var(--color-danger)]/20" : ""}
              ${!["GET", "POST", "PUT", "PATCH", "DELETE"].includes(endpoint.method) ? "bg-[var(--color-surface-secondary)] text-[var(--color-text-secondary)] border-[var(--color-border)]" : ""}
            `}
            >
              {endpoint.method}
            </span>

            <h2 className="text-lg font-bold font-mono text-[var(--color-text)] m-0 truncate" title={endpoint.path}>
              {endpoint.path}
            </h2>

            {source.controllerMethod && (
              <span className="text-xs font-mono text-[var(--color-primary)] bg-[var(--color-primary)]/10 px-2 py-0.5 rounded border border-[var(--color-primary)]/20 hidden md:inline truncate">
                #{source.controllerMethod}
              </span>
            )}
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {onGenerateThisEndpoint && (
              <button
                type="button"
                onClick={() => onGenerateThisEndpoint(endpoint)}
                disabled={isGenerating}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--radius-md)] bg-[var(--color-primary)] text-white text-xs font-semibold hover:bg-[var(--color-primary)]/90 transition-colors shadow-sm disabled:opacity-50 cursor-pointer"
                title={`Generate tests for ${endpoint.method} ${endpoint.path}`}
              >
                <Sparkles size={13} />
                <span>{isGenerating ? "Generating..." : "Generate This API"}</span>
              </button>
            )}
          </div>
        </div>

        {/* 3 Distinct Verification Status Chips + Provenance Bar */}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-[var(--color-border)]/60 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            {/* 1. Source Verification Chip */}
            <div
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full font-mono text-[11px] font-semibold border ${
                sourceStatus === "FOUND_IN_SOURCE"
                  ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/25"
                  : "bg-amber-500/10 text-amber-400 border-amber-500/25"
              }`}
              title={
                sourceStatus === "FOUND_IN_SOURCE"
                  ? `Route definition confirmed in ${source.sourceFile || "source"}`
                  : "Route definition not located in static source code"
              }
            >
              {sourceStatus === "FOUND_IN_SOURCE" ? (
                <CheckCircle2 size={13} className="text-emerald-400 shrink-0" />
              ) : (
                <AlertTriangle size={13} className="text-amber-400 shrink-0" />
              )}
              <span>{sourceStatus === "FOUND_IN_SOURCE" ? "FOUND_IN_SOURCE" : "SOURCE_UNVERIFIED"}</span>
            </div>

            {/* 2. Runtime Verification Chip */}
            <div
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full font-mono text-[11px] font-semibold border ${
                runtimeStatus === "RUNTIME_VERIFIED"
                  ? "bg-blue-500/10 text-blue-400 border-blue-500/25"
                  : "bg-[var(--color-surface-secondary)] text-[var(--color-text-muted)] border-[var(--color-border)]"
              }`}
              title={
                runtimeStatus === "RUNTIME_VERIFIED"
                  ? `Runtime evidence observed (${endpoint.passedCount || 0} passed, ${endpoint.failedCount || 0} failed)`
                  : "No live test execution observed for this endpoint yet"
              }
            >
              <Activity size={13} className={runtimeStatus === "RUNTIME_VERIFIED" ? "text-blue-400 shrink-0" : "text-[var(--color-text-muted)] shrink-0"} />
              <span>{runtimeStatus}</span>
            </div>

            {/* 3. Contract Verification Chip */}
            <div
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full font-mono text-[11px] font-semibold border ${
                contractStatus === "CONTRACT_VERIFIED"
                  ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/25"
                  : "bg-amber-500/10 text-amber-400 border-amber-500/25"
              }`}
              title={
                contractStatus === "CONTRACT_VERIFIED"
                  ? "Validated against independent authoritative API contract (e.g. OpenAPI spec)"
                  : "No independent API contract specification (OpenAPI/Swagger) provided in repository. Contract is unverified independently."
              }
            >
              {contractStatus === "CONTRACT_VERIFIED" ? (
                <CheckCircle2 size={13} className="text-emerald-400 shrink-0" />
              ) : (
                <HelpCircle size={13} className="text-amber-400 shrink-0" />
              )}
              <span>{contractStatus}</span>
            </div>

            {/* 4. Phase 3: Version Diff Chip */}
            {endpoint.diffStatus && (
              <div
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full font-mono text-[11px] font-semibold border ${
                  endpoint.diffStatus === "NEW"
                    ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/25"
                    : endpoint.diffStatus === "CHANGED"
                    ? "bg-amber-500/10 text-amber-400 border-amber-500/25"
                    : endpoint.diffStatus === "REMOVED"
                    ? "bg-rose-500/10 text-rose-400 border-rose-500/25"
                    : "bg-[var(--color-surface-secondary)] text-[var(--color-text-secondary)] border-[var(--color-border)]"
                }`}
                title={
                  endpoint.diffStatus === "CHANGED" && endpoint.changedFields?.length
                    ? `Differences detected: ${endpoint.changedFields.join(", ")}`
                    : `Version tracking: ${endpoint.diffStatus}`
                }
              >
                <Hash size={13} className="shrink-0" />
                <span>VERSION: {endpoint.diffStatus}</span>
              </div>
            )}
          </div>

          <div className="flex items-center gap-3 text-[11px] font-mono text-[var(--color-text-muted)]">
            <span title="Analyze Session Snapshot ID">
              Snapshot: <strong className="text-[var(--color-text)]">{snapshotId ? snapshotId.substring(0, 8) : "Active"}</strong>
            </span>
            <span>•</span>
            <span title="Discovered at">{analyzedAtFormatted}</span>
          </div>
        </div>

        {/* Phase 3: Version Diff Banner if CHANGED or REMOVED */}
        {endpoint.diffStatus === "CHANGED" && endpoint.diffDetails && (
          <div className="mt-2.5 p-3 rounded-md bg-amber-500/10 border border-amber-500/25 text-xs font-mono flex flex-col gap-1.5">
            <div className="flex items-center justify-between text-amber-400 font-bold">
              <span>Endpoint Modified Across Analyze Versions:</span>
              <span className="text-[10px] uppercase font-semibold">Previous vs Current</span>
            </div>
            <div className="grid grid-cols-1 gap-1 text-[11px] text-[var(--color-text-secondary)]">
              {Object.entries(endpoint.diffDetails).map(([field, detail]) => (
                <div key={field} className="flex items-start gap-2 bg-[var(--color-bg)]/60 p-1.5 rounded border border-[var(--color-border)]/40">
                  <span className="text-amber-400 font-semibold min-w-[120px]">{field}:</span>
                  <span className="line-through text-rose-400/80">{JSON.stringify(detail.previous)}</span>
                  <span className="text-[var(--color-text-muted)]">→</span>
                  <span className="text-emerald-400 font-semibold">{JSON.stringify(detail.current)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
        {endpoint.diffStatus === "REMOVED" && (
          <div className="mt-2.5 p-3 rounded-md bg-rose-500/10 border border-rose-500/25 text-xs font-mono text-rose-400 flex items-center justify-between">
            <span>Notice: This endpoint was present in a previous analysis inventory but is absent from the latest completed analysis run.</span>
            <span className="font-bold uppercase text-[10px] px-2 py-0.5 rounded bg-rose-500/20 border border-rose-500/40">REMOVED</span>
          </div>
        )}

        {/* Navigation Tabs */}
        <div className="flex items-center gap-6 mt-3">
          <button
            onClick={() => setTab("EVIDENCE")}
            className={`pb-2 text-xs font-semibold uppercase tracking-wider transition-colors border-b-2 cursor-pointer ${
              tab === "EVIDENCE"
                ? "text-[var(--color-primary)] border-[var(--color-primary)]"
                : "text-[var(--color-text-secondary)] border-transparent hover:text-[var(--color-text)]"
            }`}
          >
            Source Evidence & Traceability Chain
          </button>
          <button
            onClick={() => setTab("EXECUTION")}
            className={`pb-2 text-xs font-semibold uppercase tracking-wider transition-colors border-b-2 cursor-pointer flex items-center gap-1.5 ${
              tab === "EXECUTION"
                ? "text-[var(--color-primary)] border-[var(--color-primary)]"
                : "text-[var(--color-text-secondary)] border-transparent hover:text-[var(--color-text)]"
            }`}
          >
            <span>Runtime Execution & Scenarios</span>
            {endpoint.executedCount > 0 && (
              <span className="px-1.5 py-0.2 rounded-full bg-[var(--color-primary)]/15 text-[var(--color-primary)] font-mono text-[10px]">
                {endpoint.executedCount}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* Content Area */}
      <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar p-6">
        {tab === "EVIDENCE" && (
          <div className="max-w-5xl mx-auto space-y-6">
            {/* 1. Request Processing Chain */}
            <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg p-5">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-[var(--color-text-secondary)]">
                  <Layers size={15} className="text-[var(--color-primary)]" />
                  <span>Request Processing Chain (Static Traceability)</span>
                </div>
                <span className="text-[11px] text-[var(--color-text-muted)] font-mono">
                  Route Registration → Middleware → Handler → Service → Data Model
                </span>
              </div>

              {/* Chain Steps Horizontal Visualization */}
              <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
                {/* 1. Route Registration */}
                <div className="p-3 rounded-md bg-[var(--color-bg)] border border-[var(--color-border)] flex flex-col justify-between">
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded">
                        1. Route Mount
                      </span>
                      <CheckCircle2 size={13} className="text-emerald-400" />
                    </div>
                    <div className="font-mono text-xs font-semibold text-[var(--color-text)] truncate" title={processingChain?.routeRegistration?.mountPrefix || "/"}>
                      Prefix: {processingChain?.routeRegistration?.mountPrefix || "/"}
                    </div>
                    <div className="text-[11px] font-mono text-[var(--color-text-muted)] truncate mt-1" title={source.sourceFile || "Route file"}>
                      {source.sourceFile ? source.sourceFile.split("/").pop() : "Direct app file"}
                    </div>
                  </div>
                  {source.sourceLine && (
                    <div className="mt-2 pt-2 border-t border-[var(--color-border)] text-[10px] font-mono text-emerald-400 font-semibold flex items-center justify-between">
                      <span>Line {source.sourceLineStart || source.sourceLine}</span>
                      <button
                        type="button"
                        onClick={() => {
                          setCodeModalInitialIdx(fileOptions.findIndex((f) => f.filePath === source.sourceFile) >= 0 ? fileOptions.findIndex((f) => f.filePath === source.sourceFile) : 0);
                          setCodeModalOpen(true);
                        }}
                        className="text-[10px] text-[var(--color-primary)] hover:underline flex items-center gap-0.5 cursor-pointer"
                      >
                        <Eye size={11} /> View
                      </button>
                    </div>
                  )}
                </div>

                {/* 2. Middleware */}
                <div className="p-3 rounded-md bg-[var(--color-bg)] border border-[var(--color-border)] flex flex-col justify-between">
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-purple-400 bg-purple-500/10 px-1.5 py-0.5 rounded">
                        2. Middleware
                      </span>
                      <Shield size={13} className="text-purple-400" />
                    </div>
                    {source.middlewares && source.middlewares.length > 0 ? (
                      <div className="space-y-1">
                        {source.middlewares.map((m, i) => (
                          <div key={i} className="flex items-center justify-between text-[11px] font-mono">
                            <span className="truncate text-[var(--color-text)]" title={m.name}>
                              {m.name}
                            </span>
                            <span className="text-[9px] px-1 py-0.2 rounded bg-purple-500/10 text-purple-300 font-semibold uppercase">
                              {m.type === "AUTHENTICATION" ? "AUTH" : m.type === "VALIDATION" ? "VAL" : "MID"}
                            </span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-[11px] text-[var(--color-text-muted)] italic">
                        No custom middleware detected (Direct Route)
                      </div>
                    )}
                  </div>
                  <div className="mt-2 pt-2 border-t border-[var(--color-border)] text-[10px] font-mono text-[var(--color-text-muted)]">
                    {source.middlewares?.length ? `${source.middlewares.length} middleware(s)` : "None"}
                  </div>
                </div>

                {/* 3. Controller Handler */}
                <div className="p-3 rounded-md bg-[var(--color-bg)] border border-[var(--color-border)] flex flex-col justify-between">
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-blue-400 bg-blue-500/10 px-1.5 py-0.5 rounded">
                        3. Controller
                      </span>
                      <FileCode size={13} className="text-blue-400" />
                    </div>
                    <div className="font-mono text-xs font-semibold text-[var(--color-text)] truncate" title={source.controllerMethod || "Inline Route Handler"}>
                      {source.controllerMethod || "Inline Handler"}
                    </div>
                    <div className="text-[11px] font-mono text-[var(--color-text-muted)] truncate mt-1" title={source.controllerFile || "Source file"}>
                      {source.controllerFile ? source.controllerFile.split("/").pop() : "Inline in route"}
                    </div>
                  </div>
                  {source.controllerLine && (
                    <div className="mt-2 pt-2 border-t border-[var(--color-border)] text-[10px] font-mono text-blue-400 font-semibold flex items-center justify-between">
                      <span>Line {source.controllerLineStart || source.controllerLine}</span>
                      <button
                        type="button"
                        onClick={() => {
                          setCodeModalInitialIdx(fileOptions.findIndex((f) => f.filePath === source.controllerFile) >= 0 ? fileOptions.findIndex((f) => f.filePath === source.controllerFile) : 0);
                          setCodeModalOpen(true);
                        }}
                        className="text-[10px] text-[var(--color-primary)] hover:underline flex items-center gap-0.5 cursor-pointer"
                      >
                        <Eye size={11} /> View
                      </button>
                    </div>
                  )}
                </div>

                {/* 4. Service Layer */}
                <div className="p-3 rounded-md bg-[var(--color-bg)] border border-[var(--color-border)] flex flex-col justify-between">
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-amber-400 bg-amber-500/10 px-1.5 py-0.5 rounded">
                        4. Service Layer
                      </span>
                      <Server size={13} className="text-amber-400" />
                    </div>
                    {processingChain?.service?.status === "FOUND_IN_SOURCE" ? (
                      <div>
                        <div className="font-mono text-xs font-semibold text-[var(--color-text)] truncate" title={processingChain.service.name}>
                          {processingChain.service.name}
                        </div>
                        <div className="text-[11px] font-mono text-[var(--color-text-muted)] truncate mt-1">
                          {processingChain.service.file?.split("/").pop()}
                        </div>
                      </div>
                    ) : (
                      <div className="text-[11px] text-[var(--color-text-muted)] italic leading-tight" title="Controller directly accesses models/logic">
                        Direct Controller execution (No separate service layer)
                      </div>
                    )}
                  </div>
                  <div className="mt-2 pt-2 border-t border-[var(--color-border)] text-[10px] font-mono text-[var(--color-text-muted)]">
                    {processingChain?.service?.status === "FOUND_IN_SOURCE" ? "Verified Service" : "Verified Direct"}
                  </div>
                </div>

                {/* 5. Data Access / Model */}
                <div className="p-3 rounded-md bg-[var(--color-bg)] border border-[var(--color-border)] flex flex-col justify-between">
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-teal-400 bg-teal-500/10 px-1.5 py-0.5 rounded">
                        5. Data Model
                      </span>
                      <Database size={13} className="text-teal-400" />
                    </div>
                    {source.databaseModels && source.databaseModels.length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {source.databaseModels.map((m, i) => (
                          <span key={i} className="px-1.5 py-0.5 bg-teal-500/10 text-teal-300 border border-teal-500/20 rounded font-mono text-[10px]">
                            {m}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <div className="text-[11px] text-[var(--color-text-muted)] italic">
                        No direct ORM models detected
                      </div>
                    )}
                  </div>
                  <div className="mt-2 pt-2 border-t border-[var(--color-border)] text-[10px] font-mono text-teal-400 font-semibold">
                    {source.databaseModels?.length ? "ORM: Prisma" : "None"}
                  </div>
                </div>
              </div>
            </div>

            {/* 2. Source Code Snippets with Line Highlighting */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Card A: Route Declaration Snippet */}
              <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg p-4 flex flex-col">
                <div className="flex items-center justify-between mb-2 pb-2 border-b border-[var(--color-border)]">
                  <div className="flex items-center gap-2">
                    <FileCode size={14} className="text-emerald-400" />
                    <span className="text-xs font-bold uppercase tracking-wider text-[var(--color-text)]">
                      Route Declaration
                    </span>
                  </div>
                  {source.sourceLine && (
                    <span className="px-2 py-0.5 rounded text-[11px] font-mono font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/25">
                      Line {source.sourceLineStart || source.sourceLine}{source.sourceLineEnd && source.sourceLineEnd !== source.sourceLineStart ? `-${source.sourceLineEnd}` : ""}
                    </span>
                  )}
                </div>

                <div className="font-mono text-xs text-[var(--color-text-muted)] mb-3 truncate" title={source.sourceFile || "Route file"}>
                  {source.sourceFile || "Route declaration file not located"}
                </div>

                {source.routeSnippet ? (
                  <div className="relative group/code flex-1 min-h-[90px] mb-3">
                    <pre className="p-3 rounded bg-[var(--color-bg)] border border-[var(--color-border)] font-mono text-xs text-emerald-300 overflow-x-auto whitespace-pre-wrap leading-relaxed custom-scrollbar">
                      <code>{source.routeSnippet}</code>
                    </pre>
                    <button
                      type="button"
                      onClick={() => handleCopy(source.routeSnippet, "route")}
                      className="absolute top-2 right-2 p-1.5 rounded bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] opacity-0 group-hover/code:opacity-100 transition-opacity cursor-pointer"
                      title="Copy route snippet"
                    >
                      {copiedSnippet === "route" ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
                    </button>
                  </div>
                ) : (
                  <div className="p-3 rounded bg-[var(--color-bg)] border border-[var(--color-border)] text-xs text-[var(--color-text-muted)] italic mb-3">
                    Route declaration source code snippet not available in cached AST.
                  </div>
                )}

                <div className="mt-auto pt-2 flex items-center justify-between">
                  <span className="text-[11px] text-[var(--color-text-muted)]">Verified AST Node</span>
                  {source.sourceFile && (
                    <button
                      type="button"
                      onClick={() => {
                        setCodeModalInitialIdx(fileOptions.findIndex((f) => f.filePath === source.sourceFile) >= 0 ? fileOptions.findIndex((f) => f.filePath === source.sourceFile) : 0);
                        setCodeModalOpen(true);
                      }}
                      className="flex items-center gap-1 text-xs text-[var(--color-primary)] font-semibold hover:underline cursor-pointer"
                    >
                      <Eye size={13} />
                      <span>Open in Full Viewer</span>
                    </button>
                  )}
                </div>
              </div>

              {/* Card B: Controller Handler Snippet */}
              <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg p-4 flex flex-col">
                <div className="flex items-center justify-between mb-2 pb-2 border-b border-[var(--color-border)]">
                  <div className="flex items-center gap-2">
                    <Code size={14} className="text-blue-400" />
                    <span className="text-xs font-bold uppercase tracking-wider text-[var(--color-text)]">
                      Controller Handler
                    </span>
                  </div>
                  {source.controllerLine && (
                    <span className="px-2 py-0.5 rounded text-[11px] font-mono font-bold bg-blue-500/10 text-blue-400 border border-blue-500/25">
                      Line {source.controllerLineStart || source.controllerLine}{source.controllerLineEnd && source.controllerLineEnd !== source.controllerLineStart ? `-${source.controllerLineEnd}` : ""}
                    </span>
                  )}
                </div>

                <div className="font-mono text-xs text-[var(--color-text-muted)] mb-3 truncate" title={source.controllerFile || "Controller file"}>
                  {source.controllerFile || "Controller file not referenced"}
                  {source.controllerMethod && (
                    <span className="text-[var(--color-primary)] ml-1 font-bold">#{source.controllerMethod}</span>
                  )}
                </div>

                {source.controllerSnippet ? (
                  <div className="relative group/code flex-1 min-h-[90px] mb-3">
                    <pre className="p-3 rounded bg-[var(--color-bg)] border border-[var(--color-border)] font-mono text-xs text-blue-300 overflow-x-auto whitespace-pre-wrap max-h-[160px] leading-relaxed custom-scrollbar">
                      <code>{source.controllerSnippet}</code>
                    </pre>
                    <button
                      type="button"
                      onClick={() => handleCopy(source.controllerSnippet, "ctrl")}
                      className="absolute top-2 right-2 p-1.5 rounded bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] opacity-0 group-hover/code:opacity-100 transition-opacity cursor-pointer"
                      title="Copy controller snippet"
                    >
                      {copiedSnippet === "ctrl" ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
                    </button>
                  </div>
                ) : (
                  <div className="p-3 rounded bg-[var(--color-bg)] border border-[var(--color-border)] text-xs text-[var(--color-text-muted)] italic mb-3">
                    Controller implementation snippet is not extracted or route uses inline function.
                  </div>
                )}

                <div className="mt-auto pt-2 flex items-center justify-between">
                  <span className="text-[11px] text-[var(--color-text-muted)]">
                    {source.controllerMethod ? `Function: ${source.controllerMethod}` : "Inline callback"}
                  </span>
                  {source.controllerFile && (
                    <button
                      type="button"
                      onClick={() => {
                        setCodeModalInitialIdx(fileOptions.findIndex((f) => f.filePath === source.controllerFile) >= 0 ? fileOptions.findIndex((f) => f.filePath === source.controllerFile) : 0);
                        setCodeModalOpen(true);
                      }}
                      className="flex items-center gap-1 text-xs text-[var(--color-primary)] font-semibold hover:underline cursor-pointer"
                    >
                      <Eye size={13} />
                      <span>Open in Full Viewer</span>
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* 3. Behavioral Evidence Grid */}
            <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg p-5">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-[var(--color-text-secondary)]">
                  <Activity size={15} className="text-[var(--color-primary)]" />
                  <span>Behavioral Evidence (Static AST Inferences)</span>
                </div>
                <span className="text-[11px] text-[var(--color-text-muted)]">
                  Inferred from AST static analysis of routes and handlers
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
                {/* Path Parameters */}
                <div className="p-3 rounded-md bg-[var(--color-bg)] border border-[var(--color-border)]">
                  <div className="text-[11px] font-bold text-[var(--color-text-secondary)] uppercase tracking-wider mb-2">
                    Path Parameters
                  </div>
                  {source.params && source.params.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5">
                      {source.params.map((p, i) => (
                        <span key={i} className="px-2 py-0.5 rounded font-mono text-xs bg-[var(--color-surface)] text-purple-400 border border-purple-500/20">
                          :{p}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <div className="text-xs text-[var(--color-text-muted)] italic">No path parameters</div>
                  )}
                </div>

                {/* Query Parameters */}
                <div className="p-3 rounded-md bg-[var(--color-bg)] border border-[var(--color-border)]">
                  <div className="text-[11px] font-bold text-[var(--color-text-secondary)] uppercase tracking-wider mb-2">
                    Query Parameters
                  </div>
                  {source.queryParams && source.queryParams.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5">
                      {source.queryParams.map((q, i) => (
                        <span key={i} className="px-2 py-0.5 rounded font-mono text-xs bg-[var(--color-surface)] text-blue-400 border border-blue-500/20">
                          ?{q}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <div className="text-xs text-[var(--color-text-muted)] italic">No query parameters inferred</div>
                  )}
                </div>

                {/* Request Body Fields */}
                <div className="p-3 rounded-md bg-[var(--color-bg)] border border-[var(--color-border)]">
                  <div className="text-[11px] font-bold text-[var(--color-text-secondary)] uppercase tracking-wider mb-2">
                    Request Body Fields
                  </div>
                  {source.requestBodySchema && source.requestBodySchema.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5">
                      {source.requestBodySchema.map((field, i) => (
                        <span key={i} className="px-2 py-0.5 rounded font-mono text-xs bg-[var(--color-surface)] text-emerald-400 border border-emerald-500/20">
                          {field}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <div className="text-xs text-[var(--color-text-muted)] italic">No request body accessed</div>
                  )}
                </div>

                {/* Response Status Codes */}
                <div className="p-3 rounded-md bg-[var(--color-bg)] border border-[var(--color-border)]">
                  <div className="text-[11px] font-bold text-[var(--color-text-secondary)] uppercase tracking-wider mb-2">
                    Response Status Codes
                  </div>
                  {source.responseStatusCodes && source.responseStatusCodes.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5">
                      {source.responseStatusCodes.map((code, i) => (
                        <span
                          key={i}
                          className={`px-2 py-0.5 rounded font-mono text-xs border font-semibold ${
                            code >= 200 && code < 300
                              ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                              : code >= 400 && code < 500
                              ? "bg-amber-500/10 text-amber-400 border-amber-500/20"
                              : "bg-red-500/10 text-red-400 border-red-500/20"
                          }`}
                        >
                          {HTTP_STATUS_LABELS[code] || `${code} HTTP`}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <div className="text-xs text-[var(--color-text-muted)] italic">200 OK (Implicit)</div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {tab === "EXECUTION" && (
          <div className="max-w-5xl mx-auto space-y-6">
            {/* Executive Runtime Metrics */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg p-4">
                <div className="text-xs text-[var(--color-text-secondary)] font-semibold uppercase tracking-wider mb-1">
                  Total Executed
                </div>
                <div className="text-2xl font-bold font-mono text-[var(--color-text)]">
                  {endpoint.executedCount || 0}
                </div>
              </div>

              <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg p-4">
                <div className="text-xs text-emerald-400 font-semibold uppercase tracking-wider mb-1">
                  Passed Tests
                </div>
                <div className="text-2xl font-bold font-mono text-emerald-400">
                  {endpoint.passedCount || 0}
                </div>
              </div>

              <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg p-4">
                <div className="text-xs text-red-400 font-semibold uppercase tracking-wider mb-1">
                  Failed Tests
                </div>
                <div className="text-2xl font-bold font-mono text-red-400">
                  {endpoint.failedCount || 0}
                </div>
              </div>

              <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg p-4">
                <div className="text-xs text-blue-400 font-semibold uppercase tracking-wider mb-1">
                  Avg Latency
                </div>
                <div className="text-2xl font-bold font-mono text-blue-400 flex items-center gap-1.5">
                  <Clock size={18} />
                  <span>{endpoint.avgDurationMs || 0}ms</span>
                </div>
              </div>
            </div>

            {/* Runtime Disclaimer Banner */}
            <div className="px-4 py-3 rounded-md bg-blue-500/10 border border-blue-500/25 flex items-center justify-between text-xs text-blue-300">
              <div className="flex items-center gap-2">
                <Activity size={15} className="shrink-0 text-blue-400" />
                <span>
                  <strong>Runtime Observed Evidence:</strong> Results captured directly from in-process Supertest execution against the isolated application test server. Distinct from static source code inferences.
                </span>
              </div>
            </div>

            {/* Mapped Integration Scenarios */}
            <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg p-5">
              <div className="flex items-center justify-between mb-4">
                <div className="text-xs font-bold uppercase tracking-wider text-[var(--color-text-secondary)]">
                  Associated Integration Scenarios ({endpoint.scenarios?.length || 0})
                </div>
                <span className="text-[11px] text-[var(--color-text-muted)] font-mono">
                  Framework: Supertest (Jest Test Environment)
                </span>
              </div>

              {endpoint.scenarios && endpoint.scenarios.length > 0 ? (
                <div className="space-y-2.5">
                  {endpoint.scenarios.map((sc, i) => {
                    const sType = sc.scenarioType || (sc.title?.toLowerCase().includes("happy") ? "HAPPY_PATH" : "NEGATIVE");
                    const sTypeColor =
                      sType === "HAPPY_PATH" ? "#38bdf8" : sType === "VALIDATION" ? "#c084fc" : sType === "EDGE_CASE" ? "#818cf8" : "#fb923c";
                    const sTypeBg =
                      sType === "HAPPY_PATH"
                        ? "rgba(56,189,248,0.12)"
                        : sType === "VALIDATION"
                        ? "rgba(192,132,252,0.12)"
                        : sType === "EDGE_CASE"
                        ? "rgba(129,140,248,0.12)"
                        : "rgba(251,146,60,0.12)";

                    return (
                      <div key={i} className="p-3 rounded bg-[var(--color-bg)] border border-[var(--color-border)] flex flex-col gap-2 text-xs">
                        <div className="flex items-center justify-between flex-wrap gap-2">
                          <div className="flex items-center gap-2 flex-wrap">
                            {sc.status === "passed" ? (
                              <CheckCircle2 size={15} className="text-emerald-400 shrink-0" />
                            ) : sc.status === "failed" ? (
                              <XCircle size={15} className="text-red-400 shrink-0" />
                            ) : (
                              <span className="text-yellow-400 font-bold shrink-0">○</span>
                            )}
                            <span
                              style={{
                                fontSize: 9,
                                padding: "2px 6px",
                                borderRadius: 4,
                                fontWeight: 700,
                                background: sTypeBg,
                                color: sTypeColor,
                                border: `1px solid ${sTypeColor}33`,
                              }}
                            >
                              {sType.replace(/_/g, " ")}
                            </span>
                            <span className="font-medium text-[var(--color-text)]">{sc.title}</span>
                          </div>

                          <div className="flex items-center gap-2 shrink-0 font-mono text-[11px]">
                            {sc.actualStatusFromRuntime && (
                              <span className="px-1.5 py-0.5 rounded bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-text)]">
                                Status: <strong>{sc.actualStatusFromRuntime}</strong>
                              </span>
                            )}
                            <span className="text-[var(--color-text-muted)] flex items-center gap-1">
                              <Clock size={12} />
                              {sc.duration || sc.durationMs || 0}ms
                            </span>
                          </div>
                        </div>

                        {sc.failureMessages && (Array.isArray(sc.failureMessages) ? sc.failureMessages.length > 0 : Boolean(sc.failureMessages)) && (
                          <pre className="p-2.5 rounded bg-red-950/20 border border-red-500/20 font-mono text-[11px] text-red-300 overflow-x-auto whitespace-pre-wrap mt-1">
                            {Array.isArray(sc.failureMessages) ? sc.failureMessages.join("\n") : String(sc.failureMessages)}
                          </pre>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="p-6 text-center text-xs text-[var(--color-text-muted)] italic">
                  No integration test scenarios have been generated or mapped for this endpoint yet.
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Code Viewer Modal */}
      {codeModalOpen && (
        <SourceCodeViewerModal
          isOpen={codeModalOpen}
          onClose={() => setCodeModalOpen(false)}
          projectId={projectId}
          snapshotId={snapshotId}
          fileOptions={fileOptions}
          initialIndex={codeModalInitialIdx}
          onOpenFile={onOpenFile}
        />
      )}
    </div>
  );
}
