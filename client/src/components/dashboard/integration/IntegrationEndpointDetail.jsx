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
  const [selectedChainStep, setSelectedChainStep] = useState("controller");
  const [showSplitView, setShowSplitView] = useState(false);

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
    ? new Date(verification.discovery.analyzedAt).toLocaleString("en-US", {
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
              ${endpoint.method === "PATCH" ? "bg-[var(--color-primary)]/10 text-purple-600 dark:text-[var(--color-primary)] border-[var(--color-primary)]/20" : ""}
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
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--radius-md)] bg-[var(--color-primary)] text-[var(--color-primary-foreground)] text-xs font-semibold hover:bg-[var(--color-primary-hover)] transition-colors shadow-xs disabled:opacity-50 cursor-pointer"
                title={`Generate tests for ${endpoint.method} ${endpoint.path}`}
              >
                <Sparkles size={13} />
                <span>{isGenerating ? "Generating..." : "Generate This API"}</span>
              </button>
            )}
          </div>
        </div>

        {/* Structured 3-Tier Verification Bar (Static Source prioritized; Runtime & Contract subdued in Analyze phase) */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-3 border-t border-[var(--color-border)] text-xs">
          {/* 1. Source Verification - Active Focus */}
          <div className="p-2.5 rounded-[var(--radius-sm)] border border-[var(--color-success)]/40 bg-[var(--color-success)]/5 shadow-xs flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              {sourceStatus === "FOUND_IN_SOURCE" ? (
                <CheckCircle2 size={16} className="text-[var(--color-success)] shrink-0" />
              ) : (
                <AlertTriangle size={16} className="text-[var(--color-warning)] shrink-0" />
              )}
              <div>
                <div className="text-[10px] uppercase font-bold text-[var(--color-success)] tracking-wider">Static Source</div>
                <div className="font-mono text-xs font-semibold text-[var(--color-text)]">
                  {sourceStatus === "FOUND_IN_SOURCE" ? "FOUND IN SOURCE" : "UNVERIFIED"}
                </div>
              </div>
            </div>
            {source.sourceLine && (
              <span className="text-[10px] font-mono font-semibold px-2 py-0.5 rounded bg-[var(--color-success)]/15 text-[var(--color-success)]">
                Line {source.sourceLineStart || source.sourceLine}
              </span>
            )}
          </div>

          {/* 2. Runtime Verification - Subdued during pure Analyze */}
          <div
            className={`p-2.5 rounded-[var(--radius-sm)] border flex items-center justify-between transition-all ${
              endpoint.executedCount > 0
                ? "border-[var(--color-border)] bg-[var(--color-surface-secondary)]/50 text-[var(--color-text)]"
                : "border-dashed border-[var(--color-border)] bg-[var(--color-surface)]/30 opacity-40 hover:opacity-80 cursor-default"
            }`}
          >
            <div className="flex items-center gap-2.5">
              <Activity
                size={15}
                className={endpoint.executedCount > 0 ? "text-[var(--color-info)] shrink-0" : "text-[var(--color-text-muted)] shrink-0"}
              />
              <div>
                <div className="text-[10px] uppercase font-bold text-[var(--color-text-muted)] tracking-wider flex items-center gap-1.5">
                  <span>Runtime Execution</span>
                  {endpoint.executedCount === 0 && (
                    <span className="text-[9px] font-normal lowercase tracking-normal text-[var(--color-text-muted)]">(Run stage)</span>
                  )}
                </div>
                <div className="font-mono text-xs font-semibold text-[var(--color-text-secondary)]">
                  {endpoint.executedCount > 0 ? `${endpoint.passedCount || 0} passed` : "NOT EXECUTED"}
                </div>
              </div>
            </div>
            <span className="text-[10px] font-mono text-[var(--color-text-muted)]">
              {endpoint.executedCount > 0 ? `${endpoint.executedCount} runs` : "Available in Run Tests"}
            </span>
          </div>

          {/* 3. Contract Verification - Subdued during pure Analyze */}
          <div
            className={`p-2.5 rounded-[var(--radius-sm)] border flex items-center justify-between transition-all ${
              contractStatus === "CONTRACT_VERIFIED"
                ? "border-[var(--color-border)] bg-[var(--color-surface-secondary)]/50 text-[var(--color-text)]"
                : "border-dashed border-[var(--color-border)] bg-[var(--color-surface)]/30 opacity-40 hover:opacity-80 cursor-default"
            }`}
          >
            <div className="flex items-center gap-2.5">
              {contractStatus === "CONTRACT_VERIFIED" ? (
                <CheckCircle2 size={15} className="text-[var(--color-success)] shrink-0" />
              ) : (
                <HelpCircle size={15} className="text-[var(--color-text-muted)] shrink-0" />
              )}
              <div>
                <div className="text-[10px] uppercase font-bold text-[var(--color-text-muted)] tracking-wider flex items-center gap-1.5">
                  <span>API Contract</span>
                  {contractStatus !== "CONTRACT_VERIFIED" && (
                    <span className="text-[9px] font-normal lowercase tracking-normal text-[var(--color-text-muted)]">(Optional)</span>
                  )}
                </div>
                <div className="font-mono text-xs font-semibold text-[var(--color-text-secondary)]">
                  {contractStatus === "CONTRACT_VERIFIED" ? "SPEC VALIDATED" : "SPEC UNVERIFIED"}
                </div>
              </div>
            </div>
            {endpoint.diffStatus && endpoint.diffStatus !== "UNCHANGED" ? (
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-[var(--color-warning)]/15 text-[var(--color-warning)] font-bold">
                {endpoint.diffStatus}
              </span>
            ) : (
              <span className="text-[10px] font-mono text-[var(--color-text-muted)]">
                {contractStatus === "CONTRACT_VERIFIED" ? "Verified" : "No Spec"}
              </span>
            )}
          </div>
        </div>

        {/* Phase 3: Version Diff Banner if CHANGED or REMOVED */}
        {endpoint.diffStatus === "CHANGED" && endpoint.diffDetails && (
          <div className="mt-2.5 p-3 rounded-md bg-[var(--color-warning)]/10 border border-[var(--color-warning)]/25 text-xs font-mono flex flex-col gap-1.5">
            <div className="flex items-center justify-between text-[var(--color-warning)] font-bold">
              <span>Endpoint Modified Across Analyze Versions:</span>
              <span className="text-[10px] uppercase font-semibold">Previous vs Current</span>
            </div>
            <div className="grid grid-cols-1 gap-1 text-[11px] text-[var(--color-text-secondary)]">
              {Object.entries(endpoint.diffDetails).map(([field, detail]) => (
                <div key={field} className="flex items-start gap-2 bg-[var(--color-bg)]/60 p-1.5 rounded border border-[var(--color-border)]/40">
                  <span className="text-[var(--color-warning)] font-semibold min-w-[120px]">{field}:</span>
                  <span className="line-through text-[var(--color-danger)]/80">{JSON.stringify(detail.previous)}</span>
                  <span className="text-[var(--color-text-muted)]">→</span>
                  <span className="text-[var(--color-success)] font-semibold">{JSON.stringify(detail.current)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
        {endpoint.diffStatus === "REMOVED" && (
          <div className="mt-2.5 p-3 rounded-md bg-[var(--color-danger)]/10 border border-[var(--color-danger)]/25 text-xs font-mono text-[var(--color-danger)] flex items-center justify-between">
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
            {/* 1. Unified Request Processing Chain & Source Code Inspector */}
            <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg overflow-hidden shadow-xs">
              {/* Header with Title and View Mode Toggle */}
              <div className="px-5 py-3.5 border-b border-[var(--color-border)] bg-[var(--color-surface-secondary)]/40 flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-2">
                  <Layers size={15} className="text-[var(--color-primary)] shrink-0" />
                  <span className="text-xs font-bold uppercase tracking-wider text-[var(--color-text)]">
                    Request Processing Chain &amp; Source Inspector
                  </span>
                </div>
                <div className="flex items-center gap-2.5">
                  <span className="text-[11px] text-[var(--color-text-muted)] font-mono hidden md:inline">
                    Click any step to inspect source code
                  </span>
                  <div className="flex items-center p-0.5 bg-[var(--color-bg)] rounded border border-[var(--color-border)] text-[11px] font-semibold">
                    <button
                      type="button"
                      onClick={() => setShowSplitView(false)}
                      className={`px-2.5 py-1 rounded cursor-pointer transition-colors ${
                        !showSplitView
                          ? "bg-[var(--color-primary)] text-[var(--color-primary-foreground)] shadow-xs"
                          : "text-[var(--color-text-secondary)] hover:text-[var(--color-text)]"
                      }`}
                      title="Inspect selected chain step"
                    >
                      Step Inspector
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowSplitView(true)}
                      className={`px-2.5 py-1 rounded cursor-pointer transition-colors ${
                        showSplitView
                          ? "bg-[var(--color-primary)] text-[var(--color-primary-foreground)] shadow-xs"
                          : "text-[var(--color-text-secondary)] hover:text-[var(--color-text)]"
                      }`}
                      title="View Route Declaration and Controller Handler side-by-side"
                    >
                      Split View
                    </button>
                  </div>
                </div>
              </div>

              {/* 5-Step Horizontal Stepper */}
              <div className="p-4 bg-[var(--color-bg)]/40 border-b border-[var(--color-border)]">
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-2.5">
                  {/* Step 1: Route Mount */}
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedChainStep("route");
                      setShowSplitView(false);
                    }}
                    className={`p-2.5 rounded-md text-left transition-all cursor-pointer relative flex flex-col justify-between min-w-0 overflow-hidden group ${
                      selectedChainStep === "route" && !showSplitView
                        ? "bg-[var(--color-surface)] border-2 border-[var(--color-success)] shadow-sm ring-2 ring-[var(--color-success)]/10"
                        : "bg-[var(--color-surface)] border border-[var(--color-border)] hover:border-[var(--color-success)]/40 hover:bg-[var(--color-surface-secondary)]/40"
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="flex items-center justify-between mb-1.5 gap-1">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-success)] bg-[var(--color-success)]/10 px-1.5 py-0.5 rounded truncate">
                          1. Mount
                        </span>
                        <CheckCircle2 size={13} className="text-[var(--color-success)] shrink-0" />
                      </div>
                      <div className="font-mono text-xs font-semibold text-[var(--color-text)] truncate" title={processingChain?.routeRegistration?.mountPrefix || "/"}>
                        {processingChain?.routeRegistration?.mountPrefix || "/"}
                      </div>
                      <div className="text-[11px] font-mono text-[var(--color-text-muted)] truncate mt-1" title={source.sourceFile || "Route file"}>
                        {source.sourceFile ? source.sourceFile.split("/").pop() : "Direct app"}
                      </div>
                    </div>
                    <div className="mt-2.5 pt-2 border-t border-[var(--color-border)]/60 text-[10px] font-mono text-[var(--color-success)] flex items-center justify-between gap-1">
                      <span className="truncate">Line {source.sourceLineStart || source.sourceLine || 1}</span>
                      {selectedChainStep === "route" && !showSplitView ? (
                        <span className="text-[9px] font-sans font-bold text-[var(--color-success)] px-1 rounded bg-[var(--color-success)]/10">Active</span>
                      ) : (
                        <ChevronRight size={12} className="text-[var(--color-text-muted)] group-hover:text-[var(--color-primary)] shrink-0 transition-colors" />
                      )}
                    </div>
                  </button>

                  {/* Step 2: Middleware */}
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedChainStep("middleware");
                      setShowSplitView(false);
                    }}
                    className={`p-2.5 rounded-md text-left transition-all cursor-pointer relative flex flex-col justify-between min-w-0 overflow-hidden group ${
                      selectedChainStep === "middleware" && !showSplitView
                        ? "bg-[var(--color-surface)] border-2 border-[var(--color-primary)] shadow-sm ring-2 ring-[var(--color-primary)]/10"
                        : "bg-[var(--color-surface)] border border-[var(--color-border)] hover:border-[var(--color-primary)]/40 hover:bg-[var(--color-surface-secondary)]/40"
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="flex items-center justify-between mb-1.5 gap-1">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-primary)] bg-[var(--color-primary)]/10 px-1.5 py-0.5 rounded truncate">
                          2. Middleware
                        </span>
                        <Shield size={13} className="text-[var(--color-primary)] shrink-0" />
                      </div>
                      <div className="font-mono text-xs font-semibold text-[var(--color-text)] truncate" title={source.middlewares && source.middlewares.length > 0 ? `${source.middlewares.length} configured` : "Direct Route"}>
                        {source.middlewares && source.middlewares.length > 0 ? `${source.middlewares.length} configured` : "Direct Route"}
                      </div>
                      <div className="text-[11px] font-mono text-[var(--color-text-muted)] truncate mt-1" title={source.middlewares && source.middlewares.length > 0 ? source.middlewares.map((m) => m.name).join(", ") : "No middleware"}>
                        {source.middlewares && source.middlewares.length > 0 ? source.middlewares.map((m) => m.name).join(", ") : "None"}
                      </div>
                    </div>
                    <div className="mt-2.5 pt-2 border-t border-[var(--color-border)]/60 text-[10px] font-mono text-[var(--color-text-muted)] flex items-center justify-between gap-1">
                      <span className="truncate">{source.middlewares?.length ? `${source.middlewares.length} layer` : "None"}</span>
                      {selectedChainStep === "middleware" && !showSplitView ? (
                        <span className="text-[9px] font-sans font-bold text-[var(--color-primary)] px-1 rounded bg-[var(--color-primary)]/10">Active</span>
                      ) : (
                        <ChevronRight size={12} className="text-[var(--color-text-muted)] group-hover:text-[var(--color-primary)] shrink-0 transition-colors" />
                      )}
                    </div>
                  </button>

                  {/* Step 3: Controller */}
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedChainStep("controller");
                      setShowSplitView(false);
                    }}
                    className={`p-2.5 rounded-md text-left transition-all cursor-pointer relative flex flex-col justify-between min-w-0 overflow-hidden group ${
                      selectedChainStep === "controller" && !showSplitView
                        ? "bg-[var(--color-surface)] border-2 border-[var(--color-primary)] shadow-sm ring-2 ring-[var(--color-primary)]/10"
                        : "bg-[var(--color-surface)] border border-[var(--color-border)] hover:border-[var(--color-primary)]/40 hover:bg-[var(--color-surface-secondary)]/40"
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="flex items-center justify-between mb-1.5 gap-1">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-primary)] bg-[var(--color-primary)]/10 px-1.5 py-0.5 rounded truncate">
                          3. Controller
                        </span>
                        <Code size={13} className="text-[var(--color-primary)] shrink-0" />
                      </div>
                      <div className="font-mono text-xs font-semibold text-[var(--color-text)] truncate" title={source.controllerMethod || "Inline Handler"}>
                        {source.controllerMethod || "Inline Handler"}
                      </div>
                      <div className="text-[11px] font-mono text-[var(--color-text-muted)] truncate mt-1" title={source.controllerFile || "Source file"}>
                        {source.controllerFile ? source.controllerFile.split("/").pop() : "Inline in route"}
                      </div>
                    </div>
                    <div className="mt-2.5 pt-2 border-t border-[var(--color-border)]/60 text-[10px] font-mono text-[var(--color-primary)] flex items-center justify-between gap-1">
                      <span className="truncate">Line {source.controllerLineStart || source.controllerLine || 1}</span>
                      {selectedChainStep === "controller" && !showSplitView ? (
                        <span className="text-[9px] font-sans font-bold text-[var(--color-primary)] px-1 rounded bg-[var(--color-primary)]/10">Active</span>
                      ) : (
                        <ChevronRight size={12} className="text-[var(--color-text-muted)] group-hover:text-[var(--color-primary)] shrink-0 transition-colors" />
                      )}
                    </div>
                  </button>

                  {/* Step 4: Service Layer */}
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedChainStep("service");
                      setShowSplitView(false);
                    }}
                    className={`p-2.5 rounded-md text-left transition-all cursor-pointer relative flex flex-col justify-between min-w-0 overflow-hidden group ${
                      selectedChainStep === "service" && !showSplitView
                        ? "bg-[var(--color-surface)] border-2 border-[var(--color-warning)] shadow-sm ring-2 ring-[var(--color-warning)]/10"
                        : "bg-[var(--color-surface)] border border-[var(--color-border)] hover:border-[var(--color-warning)]/40 hover:bg-[var(--color-surface-secondary)]/40"
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="flex items-center justify-between mb-1.5 gap-1">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-warning)] bg-[var(--color-warning)]/10 px-1.5 py-0.5 rounded truncate">
                          4. Service
                        </span>
                        <Server size={13} className="text-[var(--color-warning)] shrink-0" />
                      </div>
                      <div className="font-mono text-xs font-semibold text-[var(--color-text)] truncate" title={processingChain?.service?.status === "FOUND_IN_SOURCE" ? processingChain.service.name : "Direct Controller"}>
                        {processingChain?.service?.status === "FOUND_IN_SOURCE" ? processingChain.service.name : "Direct Controller"}
                      </div>
                      <div className="text-[11px] font-mono text-[var(--color-text-muted)] truncate mt-1" title={processingChain?.service?.status === "FOUND_IN_SOURCE" ? processingChain.service.file?.split("/").pop() : "No separate service"}>
                        {processingChain?.service?.status === "FOUND_IN_SOURCE" ? processingChain.service.file?.split("/").pop() : "Direct"}
                      </div>
                    </div>
                    <div className="mt-2.5 pt-2 border-t border-[var(--color-border)]/60 text-[10px] font-mono text-[var(--color-text-muted)] flex items-center justify-between gap-1">
                      <span className="truncate">{processingChain?.service?.status === "FOUND_IN_SOURCE" ? "Service" : "Direct"}</span>
                      {selectedChainStep === "service" && !showSplitView ? (
                        <span className="text-[9px] font-sans font-bold text-[var(--color-warning)] px-1 rounded bg-[var(--color-warning)]/10">Active</span>
                      ) : (
                        <ChevronRight size={12} className="text-[var(--color-text-muted)] group-hover:text-[var(--color-primary)] shrink-0 transition-colors" />
                      )}
                    </div>
                  </button>

                  {/* Step 5: Data Model */}
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedChainStep("model");
                      setShowSplitView(false);
                    }}
                    className={`p-2.5 rounded-md text-left transition-all cursor-pointer relative flex flex-col justify-between min-w-0 overflow-hidden group ${
                      selectedChainStep === "model" && !showSplitView
                        ? "bg-[var(--color-surface)] border-2 border-[var(--color-info)] shadow-sm ring-2 ring-[var(--color-info)]/10"
                        : "bg-[var(--color-surface)] border border-[var(--color-border)] hover:border-[var(--color-info)]/40 hover:bg-[var(--color-surface-secondary)]/40"
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="flex items-center justify-between mb-1.5 gap-1">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-info)] bg-[var(--color-info)]/10 px-1.5 py-0.5 rounded truncate">
                          5. Model
                        </span>
                        <Database size={13} className="text-[var(--color-info)] shrink-0" />
                      </div>
                      <div className="font-mono text-xs font-semibold text-[var(--color-text)] truncate" title={source.databaseModels && source.databaseModels.length > 0 ? source.databaseModels.join(", ") : "None"}>
                        {source.databaseModels && source.databaseModels.length > 0 ? source.databaseModels.join(", ") : "None"}
                      </div>
                      <div className="text-[11px] font-mono text-[var(--color-text-muted)] truncate mt-1">
                        {source.databaseModels?.length ? "ORM: Prisma" : "No models"}
                      </div>
                    </div>
                    <div className="mt-2.5 pt-2 border-t border-[var(--color-border)]/60 text-[10px] font-mono text-[var(--color-info)] flex items-center justify-between gap-1">
                      <span className="truncate">{source.databaseModels?.length ? `${source.databaseModels.length} model` : "0"}</span>
                      {selectedChainStep === "model" && !showSplitView ? (
                        <span className="text-[9px] font-sans font-bold text-[var(--color-info)] px-1 rounded bg-[var(--color-info)]/10">Active</span>
                      ) : (
                        <ChevronRight size={12} className="text-[var(--color-text-muted)] group-hover:text-[var(--color-primary)] shrink-0 transition-colors" />
                      )}
                    </div>
                  </button>
                </div>
              </div>

              {/* Connected Inline Inspector Content */}
              <div className="p-5 bg-[var(--color-surface)]">
                {showSplitView ? (
                  /* Split View: Route Declaration + Controller Handler side-by-side */
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* Left: Route Declaration */}
                    <div className="p-3.5 rounded-lg bg-[var(--color-bg)] border border-[var(--color-border)] flex flex-col">
                      <div className="flex items-center justify-between mb-2 pb-2 border-b border-[var(--color-border)]">
                        <div className="flex items-center gap-1.5">
                          <FileCode size={14} className="text-[var(--color-success)]" />
                          <span className="text-xs font-bold uppercase tracking-wider text-[var(--color-text)]">
                            Route Declaration
                          </span>
                        </div>
                        {source.sourceLine && (
                          <span className="px-2 py-0.5 rounded text-[11px] font-mono font-bold bg-[var(--color-success)]/10 text-[var(--color-success)] border border-[var(--color-success)]/25">
                            Line {source.sourceLineStart || source.sourceLine}{source.sourceLineEnd && source.sourceLineEnd !== source.sourceLineStart ? `-${source.sourceLineEnd}` : ""}
                          </span>
                        )}
                      </div>
                      <div className="font-mono text-xs text-[var(--color-text-muted)] mb-2 truncate" title={source.sourceFile || "Route file"}>
                        {source.sourceFile || "Route file not located"}
                      </div>
                      {source.routeSnippet ? (
                        <div className="relative group/code flex-1 min-h-[90px] mb-2">
                          <pre className="p-3 rounded bg-[var(--color-surface)] border border-[var(--color-border)] font-mono text-xs text-[var(--color-success)] overflow-x-auto whitespace-pre-wrap leading-relaxed custom-scrollbar">
                            <code>{source.routeSnippet}</code>
                          </pre>
                          <button
                            type="button"
                            onClick={() => handleCopy(source.routeSnippet, "route")}
                            className="absolute top-2 right-2 p-1.5 rounded bg-[var(--color-surface-secondary)] border border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] opacity-0 group-hover/code:opacity-100 transition-opacity cursor-pointer"
                            title="Copy snippet"
                          >
                            {copiedSnippet === "route" ? <Check size={12} className="text-[var(--color-success)]" /> : <Copy size={12} />}
                          </button>
                        </div>
                      ) : (
                        <div className="p-3 rounded bg-[var(--color-surface)] border border-[var(--color-border)] text-xs text-[var(--color-text-muted)] italic mb-2">
                          Route snippet not cached.
                        </div>
                      )}
                      <div className="mt-auto pt-2 flex items-center justify-between border-t border-[var(--color-border)]/50">
                        <span className="text-[11px] text-[var(--color-text-muted)]">AST Route Node</span>
                        {source.sourceFile && (
                          <button
                            type="button"
                            onClick={() => {
                              setCodeModalInitialIdx(fileOptions.findIndex((f) => f.filePath === source.sourceFile) >= 0 ? fileOptions.findIndex((f) => f.filePath === source.sourceFile) : 0);
                              setCodeModalOpen(true);
                            }}
                            className="flex items-center gap-1 text-xs text-[var(--color-primary)] font-semibold hover:underline cursor-pointer"
                          >
                            <Eye size={12} />
                            <span>Full Viewer</span>
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Right: Controller Handler */}
                    <div className="p-3.5 rounded-lg bg-[var(--color-bg)] border border-[var(--color-border)] flex flex-col">
                      <div className="flex items-center justify-between mb-2 pb-2 border-b border-[var(--color-border)]">
                        <div className="flex items-center gap-1.5">
                          <Code size={14} className="text-[var(--color-primary)]" />
                          <span className="text-xs font-bold uppercase tracking-wider text-[var(--color-text)]">
                            Controller Handler
                          </span>
                        </div>
                        {source.controllerLine && (
                          <span className="px-2 py-0.5 rounded text-[11px] font-mono font-bold bg-[var(--color-primary)]/10 text-[var(--color-primary)] border border-blue-500/25">
                            Line {source.controllerLineStart || source.controllerLine}{source.controllerLineEnd && source.controllerLineEnd !== source.controllerLineStart ? `-${source.controllerLineEnd}` : ""}
                          </span>
                        )}
                      </div>
                      <div className="font-mono text-xs text-[var(--color-text-muted)] mb-2 truncate" title={source.controllerFile || "Controller file"}>
                        {source.controllerFile || "Controller file"} #{source.controllerMethod || "inline"}
                      </div>
                      {source.controllerSnippet ? (
                        <div className="relative group/code flex-1 min-h-[90px] mb-2">
                          <pre className="p-3 rounded bg-[var(--color-surface)] border border-[var(--color-border)] font-mono text-xs text-blue-300 overflow-x-auto whitespace-pre-wrap max-h-[180px] leading-relaxed custom-scrollbar">
                            <code>{source.controllerSnippet}</code>
                          </pre>
                          <button
                            type="button"
                            onClick={() => handleCopy(source.controllerSnippet, "ctrl")}
                            className="absolute top-2 right-2 p-1.5 rounded bg-[var(--color-surface-secondary)] border border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] opacity-0 group-hover/code:opacity-100 transition-opacity cursor-pointer"
                            title="Copy snippet"
                          >
                            {copiedSnippet === "ctrl" ? <Check size={12} className="text-[var(--color-success)]" /> : <Copy size={12} />}
                          </button>
                        </div>
                      ) : (
                        <div className="p-3 rounded bg-[var(--color-surface)] border border-[var(--color-border)] text-xs text-[var(--color-text-muted)] italic mb-2">
                          Controller implementation snippet not available.
                        </div>
                      )}
                      <div className="mt-auto pt-2 flex items-center justify-between border-t border-[var(--color-border)]/50">
                        <span className="text-[11px] text-[var(--color-text-muted)]">Function Scope Scoped</span>
                        {source.controllerFile && (
                          <button
                            type="button"
                            onClick={() => {
                              setCodeModalInitialIdx(fileOptions.findIndex((f) => f.filePath === source.controllerFile) >= 0 ? fileOptions.findIndex((f) => f.filePath === source.controllerFile) : 0);
                              setCodeModalOpen(true);
                            }}
                            className="flex items-center gap-1 text-xs text-[var(--color-primary)] font-semibold hover:underline cursor-pointer"
                          >
                            <Eye size={12} />
                            <span>Full Viewer</span>
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                ) : (
                  /* Step Focus View: Displays the selected step's code or details */
                  <div>
                    {selectedChainStep === "route" && (
                      <div className="flex flex-col gap-3">
                        <div className="flex items-center justify-between flex-wrap gap-2 pb-2.5 border-b border-[var(--color-border)]">
                          <div className="flex items-center gap-2">
                            <FileCode size={16} className="text-[var(--color-success)]" />
                            <div>
                              <div className="text-xs font-bold text-[var(--color-text)]">
                                Route Declaration Snippet
                              </div>
                              <div className="font-mono text-[11px] text-[var(--color-text-muted)]">
                                {source.sourceFile || "Route file"}
                              </div>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            {source.sourceLine && (
                              <span className="px-2 py-0.5 rounded text-xs font-mono font-bold bg-[var(--color-success)]/10 text-[var(--color-success)] border border-[var(--color-success)]/25">
                                Line {source.sourceLineStart || source.sourceLine}{source.sourceLineEnd && source.sourceLineEnd !== source.sourceLineStart ? `-${source.sourceLineEnd}` : ""}
                              </span>
                            )}
                            {source.sourceFile && (
                              <button
                                type="button"
                                onClick={() => {
                                  setCodeModalInitialIdx(fileOptions.findIndex((f) => f.filePath === source.sourceFile) >= 0 ? fileOptions.findIndex((f) => f.filePath === source.sourceFile) : 0);
                                  setCodeModalOpen(true);
                                }}
                                className="flex items-center gap-1 px-2.5 py-1 rounded bg-[var(--color-surface-secondary)] border border-[var(--color-border)] text-xs text-[var(--color-text)] hover:text-[var(--color-primary)] font-semibold transition-colors cursor-pointer"
                              >
                                <Eye size={12} />
                                <span>Open in Full Viewer</span>
                              </button>
                            )}
                          </div>
                        </div>

                        {source.routeSnippet ? (
                          <div className="relative group/code">
                            <pre className="p-3.5 rounded-md bg-[var(--color-bg)] border border-[var(--color-border)] font-mono text-xs text-[var(--color-success)] overflow-x-auto whitespace-pre-wrap leading-relaxed custom-scrollbar">
                              <code>{source.routeSnippet}</code>
                            </pre>
                            <button
                              type="button"
                              onClick={() => handleCopy(source.routeSnippet, "route")}
                              className="absolute top-2.5 right-2.5 p-1.5 rounded bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] opacity-0 group-hover/code:opacity-100 transition-opacity cursor-pointer shadow-xs"
                              title="Copy route snippet"
                            >
                              {copiedSnippet === "route" ? <Check size={12} className="text-[var(--color-success)]" /> : <Copy size={12} />}
                            </button>
                          </div>
                        ) : (
                          <div className="p-4 rounded-md bg-[var(--color-bg)] border border-[var(--color-border)] text-xs text-[var(--color-text-muted)] italic">
                            Route declaration snippet not available in cached AST.
                          </div>
                        )}

                        <div className="text-[11px] text-[var(--color-text-muted)] flex items-center justify-between">
                          <span>AST CallExpression confirmed in route tree.</span>
                          <span className="font-mono">{endpoint.method} {endpoint.path}</span>
                        </div>
                      </div>
                    )}

                    {selectedChainStep === "middleware" && (
                      <div className="flex flex-col gap-3">
                        <div className="flex items-center justify-between pb-2.5 border-b border-[var(--color-border)]">
                          <div className="flex items-center gap-2">
                            <Shield size={16} className="text-[var(--color-primary)]" />
                            <div>
                              <div className="text-xs font-bold text-[var(--color-text)]">
                                Middleware Pipeline &amp; Security Boundary
                              </div>
                              <div className="font-mono text-[11px] text-[var(--color-text-muted)]">
                                {source.middlewares?.length ? `${source.middlewares.length} active middleware handler(s)` : "Direct route execution"}
                              </div>
                            </div>
                          </div>
                        </div>

                        {source.middlewares && source.middlewares.length > 0 ? (
                          <div className="space-y-2">
                            {source.middlewares.map((m, i) => (
                              <div key={i} className="p-3 rounded-md bg-[var(--color-bg)] border border-[var(--color-border)] flex items-center justify-between text-xs font-mono">
                                <div className="flex items-center gap-2.5">
                                  <span className="px-1.5 py-0.5 rounded bg-[var(--color-primary)]/10 text-[var(--color-primary)] text-[10px] font-bold uppercase">
                                    {m.type === "AUTHENTICATION" ? "AUTH" : m.type === "VALIDATION" ? "VAL" : "MID"}
                                  </span>
                                  <span className="font-semibold text-[var(--color-text)]">{m.name}</span>
                                </div>
                                <span className="text-[11px] text-[var(--color-text-muted)]">{m.file || "inline"}</span>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="p-4 rounded-md bg-[var(--color-bg)] border border-[var(--color-border)] text-xs text-[var(--color-text-secondary)] leading-relaxed">
                            <div className="font-semibold text-[var(--color-text)] mb-1 flex items-center gap-1.5">
                              <CheckCircle2 size={14} className="text-[var(--color-success)]" />
                              <span>Direct Route (Zero Custom Middleware Overhead)</span>
                            </div>
                            <p className="text-[var(--color-text-muted)] m-0">
                              This route connects directly from the URL dispatcher to the controller handler without intermediate authentication or custom validation interceptors.
                            </p>
                          </div>
                        )}
                      </div>
                    )}

                    {selectedChainStep === "controller" && (
                      <div className="flex flex-col gap-3">
                        <div className="flex items-center justify-between flex-wrap gap-2 pb-2.5 border-b border-[var(--color-border)]">
                          <div className="flex items-center gap-2">
                            <Code size={16} className="text-[var(--color-primary)]" />
                            <div>
                              <div className="text-xs font-bold text-[var(--color-text)] flex items-center gap-1.5">
                                <span>Controller Handler:</span>
                                <span className="font-mono text-[var(--color-primary)]">#{source.controllerMethod || "inlineHandler"}</span>
                              </div>
                              <div className="font-mono text-[11px] text-[var(--color-text-muted)]">
                                {source.controllerFile || "Controller file"}
                              </div>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            {source.controllerLine && (
                              <span className="px-2 py-0.5 rounded text-xs font-mono font-bold bg-[var(--color-primary)]/10 text-[var(--color-primary)] border border-blue-500/25">
                                Line {source.controllerLineStart || source.controllerLine}{source.controllerLineEnd && source.controllerLineEnd !== source.controllerLineStart ? `-${source.controllerLineEnd}` : ""}
                              </span>
                            )}
                            {source.controllerFile && (
                              <button
                                type="button"
                                onClick={() => {
                                  setCodeModalInitialIdx(fileOptions.findIndex((f) => f.filePath === source.controllerFile) >= 0 ? fileOptions.findIndex((f) => f.filePath === source.controllerFile) : 0);
                                  setCodeModalOpen(true);
                                }}
                                className="flex items-center gap-1 px-2.5 py-1 rounded bg-[var(--color-surface-secondary)] border border-[var(--color-border)] text-xs text-[var(--color-text)] hover:text-[var(--color-primary)] font-semibold transition-colors cursor-pointer"
                              >
                                <Eye size={12} />
                                <span>Open in Full Viewer</span>
                              </button>
                            )}
                          </div>
                        </div>

                        {source.controllerSnippet ? (
                          <div className="relative group/code">
                            <pre className="p-3.5 rounded-md bg-[var(--color-bg)] border border-[var(--color-border)] font-mono text-xs text-blue-300 overflow-x-auto whitespace-pre-wrap max-h-[300px] leading-relaxed custom-scrollbar">
                              <code>{source.controllerSnippet}</code>
                            </pre>
                            <button
                              type="button"
                              onClick={() => handleCopy(source.controllerSnippet, "ctrl")}
                              className="absolute top-2.5 right-2.5 p-1.5 rounded bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] opacity-0 group-hover/code:opacity-100 transition-opacity cursor-pointer shadow-xs"
                              title="Copy controller snippet"
                            >
                              {copiedSnippet === "ctrl" ? <Check size={12} className="text-[var(--color-success)]" /> : <Copy size={12} />}
                            </button>
                          </div>
                        ) : (
                          <div className="p-4 rounded-md bg-[var(--color-bg)] border border-[var(--color-border)] text-xs text-[var(--color-text-muted)] italic">
                            Controller implementation snippet is not extracted or route uses inline function.
                          </div>
                        )}

                        <div className="text-[11px] text-[var(--color-text-muted)] flex items-center justify-between">
                          <span className="text-[var(--color-success)] font-medium">✓ Function Scope Isolated: Scoped strictly to target handler AST without cross-contamination.</span>
                          <span className="font-mono text-[var(--color-text-secondary)]">{source.controllerMethod ? `exports.${source.controllerMethod}` : "inline"}</span>
                        </div>
                      </div>
                    )}

                    {selectedChainStep === "service" && (
                      <div className="flex flex-col gap-3">
                        <div className="flex items-center justify-between pb-2.5 border-b border-[var(--color-border)]">
                          <div className="flex items-center gap-2">
                            <Server size={16} className="text-[var(--color-warning)]" />
                            <div>
                              <div className="text-xs font-bold text-[var(--color-text)]">
                                Service Layer &amp; Domain Business Logic
                              </div>
                              <div className="font-mono text-[11px] text-[var(--color-text-muted)]">
                                {processingChain?.service?.status === "FOUND_IN_SOURCE" ? processingChain.service.name : "Direct Controller execution"}
                              </div>
                            </div>
                          </div>
                        </div>

                        {processingChain?.service?.status === "FOUND_IN_SOURCE" ? (
                          <div className="p-4 rounded-md bg-[var(--color-bg)] border border-[var(--color-border)] space-y-2">
                            <div className="flex items-center justify-between font-mono text-xs">
                              <span className="font-bold text-[var(--color-text)]">{processingChain.service.name}</span>
                              <span className="text-[var(--color-text-muted)]">{processingChain.service.file}</span>
                            </div>
                            <div className="text-xs text-[var(--color-text-secondary)]">
                              Separated domain service layer encapsulates business rules and data queries.
                            </div>
                          </div>
                        ) : (
                          <div className="p-4 rounded-md bg-[var(--color-bg)] border border-[var(--color-border)] text-xs text-[var(--color-text-secondary)] leading-relaxed">
                            <div className="font-semibold text-[var(--color-text)] mb-1 flex items-center gap-1.5">
                              <CheckCircle2 size={14} className="text-[var(--color-warning)]" />
                              <span>Direct Controller Pattern (No Separate Service Layer)</span>
                            </div>
                            <p className="text-[var(--color-text-muted)] m-0">
                              The application directly executes Prisma database queries and business validation within the controller function. No separate service layer class or module was detected in the project AST hierarchy.
                            </p>
                          </div>
                        )}
                      </div>
                    )}

                    {selectedChainStep === "model" && (
                      <div className="flex flex-col gap-3">
                        <div className="flex items-center justify-between pb-2.5 border-b border-[var(--color-border)]">
                          <div className="flex items-center gap-2">
                            <Database size={16} className="text-[var(--color-info)]" />
                            <div>
                              <div className="text-xs font-bold text-[var(--color-text)]">
                                Data Access &amp; Database Models
                              </div>
                              <div className="font-mono text-[11px] text-[var(--color-text-muted)]">
                                {source.databaseModels?.length ? `Scoped to ${source.databaseModels.length} database model(s)` : "No direct ORM models detected"}
                              </div>
                            </div>
                          </div>
                        </div>

                        {source.databaseModels && source.databaseModels.length > 0 ? (
                          <div className="p-4 rounded-md bg-[var(--color-bg)] border border-[var(--color-border)] space-y-3">
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-semibold text-[var(--color-text)]">Referenced Prisma Models:</span>
                              <div className="flex flex-wrap gap-1.5">
                                {source.databaseModels.map((m, i) => (
                                  <span key={i} className="px-2 py-0.5 bg-[var(--color-info)]/10 text-[var(--color-info)] border border-[var(--color-info)]/20 rounded font-mono text-xs font-bold">
                                    prisma.{m}
                                  </span>
                                ))}
                              </div>
                            </div>
                            <p className="text-[11px] text-[var(--color-text-muted)] m-0 leading-relaxed">
                              These database models are queried within the function scope of <code className="text-[var(--color-primary)]">#{source.controllerMethod || "handler"}</code>. Other models in the same file (e.g. from checkout or payment handlers) are strictly excluded from this endpoint&apos;s scope.
                            </p>
                          </div>
                        ) : (
                          <div className="p-4 rounded-md bg-[var(--color-bg)] border border-[var(--color-border)] text-xs text-[var(--color-text-muted)] italic">
                            No direct Prisma ORM database models referenced in this controller function.
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* 2. Behavioral Evidence Grid */}
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
                        <span key={i} className="px-2 py-0.5 rounded font-mono text-xs bg-[var(--color-surface)] text-[var(--color-primary)] border border-[var(--color-primary)]/20">
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
                        <span key={i} className="px-2 py-0.5 rounded font-mono text-xs bg-[var(--color-surface)] text-[var(--color-primary)] border border-blue-500/20">
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
                        <span key={i} className="px-2 py-0.5 rounded font-mono text-xs bg-[var(--color-surface)] text-[var(--color-success)] border border-emerald-500/20">
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
                              ? "bg-[var(--color-success)]/10 text-[var(--color-success)] border-emerald-500/20"
                              : code >= 400 && code < 500
                              ? "bg-[var(--color-warning)]/10 text-[var(--color-warning)] border-amber-500/20"
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
                <div className="text-xs text-[var(--color-success)] font-semibold uppercase tracking-wider mb-1">
                  Passed Tests
                </div>
                <div className="text-2xl font-bold font-mono text-[var(--color-success)]">
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
                <div className="text-xs text-[var(--color-primary)] font-semibold uppercase tracking-wider mb-1">
                  Avg Latency
                </div>
                <div className="text-2xl font-bold font-mono text-[var(--color-primary)] flex items-center gap-1.5">
                  <Clock size={18} />
                  <span>{endpoint.avgDurationMs || 0}ms</span>
                </div>
              </div>
            </div>

            {/* Runtime Disclaimer Banner */}
            <div className="px-4 py-3 rounded-md bg-[var(--color-primary)]/10 border border-blue-500/25 flex items-center justify-between text-xs text-blue-300">
              <div className="flex items-center gap-2">
                <Activity size={15} className="shrink-0 text-[var(--color-primary)]" />
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
                              <CheckCircle2 size={15} className="text-[var(--color-success)] shrink-0" />
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
