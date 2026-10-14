/* eslint-disable no-unused-vars */
import { useState } from "react";
import { Database, FileCode, Shield, Sparkles, Clock, CheckCircle, XCircle, Eye, Activity } from "lucide-react";
import SourceCodeViewerModal from "./SourceCodeViewerModal.jsx";

export default function IntegrationEndpointDetail({
  endpoint,
  aiTests,
  hasGeneratedTests,
  isApproved,
  selectedTestIds,
  setSelectedTestIds,
  snapshotId,
  projectId,
  endpoints, // full list just in case
  onOpenCFG,
  onSuggestTestcase,
  onOpenArchitecture,
  onScenarioChange,
  onError,
  onGenerateThisEndpoint,
  onOpenFile,
  isGenerating = false,
}) {
  const [tab, setTab] = useState("OVERVIEW"); // OVERVIEW | EXECUTION
  const [codeModalOpen, setCodeModalOpen] = useState(false);
  const [codeModalInitialIdx, setCodeModalInitialIdx] = useState(0);

  if (!endpoint) return null;

  // Build files available for quick inspection in the code viewer modal
  const fileOptions = [];
  if (endpoint.source?.controllerFile) {
    fileOptions.push({
      label: "Controller Handler",
      filePath: endpoint.source.controllerFile,
      line: endpoint.source.controllerLine,
      method: endpoint.source.controllerMethod,
    });
  }
  if (endpoint.source?.sourceFile) {
    fileOptions.push({
      label: "Route Declaration",
      filePath: endpoint.source.sourceFile,
      line: endpoint.source.sourceLine || endpoint.provenance?.sourceLine,
      method: `${endpoint.method} ${endpoint.path || ""}`,
    });
  }

  return (
    <div className="flex flex-col h-full min-h-0 font-sans text-[var(--color-text)] overflow-hidden">
      {/* Header */}
      <div className="px-6 py-5 border-b border-[var(--color-border)] bg-[var(--color-surface)] shrink-0">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <span className={`px-2 py-1 rounded text-xs font-bold border font-mono
              ${endpoint.method === 'GET' ? 'bg-[var(--color-info)]/10 text-[var(--color-info)] border-[var(--color-info)]/20' : ''}
              ${endpoint.method === 'POST' ? 'bg-[var(--color-success)]/10 text-[var(--color-success)] border-[var(--color-success)]/20' : ''}
              ${endpoint.method === 'PUT' ? 'bg-[var(--color-warning)]/10 text-[var(--color-warning)] border-[var(--color-warning)]/20' : ''}
              ${endpoint.method === 'DELETE' ? 'bg-[var(--color-danger)]/10 text-[var(--color-danger)] border-[var(--color-danger)]/20' : ''}
              ${!['GET','POST','PUT','DELETE'].includes(endpoint.method) ? 'bg-[var(--color-surface-secondary)] text-[var(--color-text-secondary)] border-[var(--color-border)]' : ''}
            `}>
              {endpoint.method}
            </span>
            <h2 className="text-xl font-bold font-mono text-[var(--color-text)] m-0">{endpoint.path}</h2>
          </div>
          
          <div className="flex items-center gap-2">
            {onGenerateThisEndpoint && (
              <button
                type="button"
                onClick={() => onGenerateThisEndpoint(endpoint)}
                disabled={isGenerating}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--radius-md)] bg-[var(--color-primary)] text-white text-xs font-semibold hover:bg-[var(--color-primary)]/90 transition-colors shadow-sm disabled:opacity-50 cursor-pointer"
                title={`Generate tests for ${endpoint.method} ${endpoint.path}`}
              >
                <Sparkles size={13} />
                {isGenerating ? "Generating..." : "Generate This API"}
              </button>
            )}
          </div>
        </div>

        {/* Nav Tabs */}
        <div className="flex items-center gap-6 mt-4">
          <button
            onClick={() => setTab("OVERVIEW")}
            className={`pb-3 text-sm font-semibold transition-colors border-b-2 ${tab === "OVERVIEW" ? "text-[var(--color-primary)] border-[var(--color-primary)]" : "text-[var(--color-text-secondary)] border-transparent hover:text-[var(--color-text)]"}`}
          >
            Source Mapping
          </button>
          <button
            onClick={() => setTab("EXECUTION")}
            className={`pb-3 text-sm font-semibold transition-colors border-b-2 ${tab === "EXECUTION" ? "text-[var(--color-primary)] border-[var(--color-primary)]" : "text-[var(--color-text-secondary)] border-transparent hover:text-[var(--color-text)]"}`}
          >
            Execution Results
          </button>
        </div>
      </div>

      {/* Content Area */}
      <div className="flex-1 min-h-0 overflow-y-auto bg-[var(--color-bg)] custom-scrollbar">
        
        {tab === "OVERVIEW" && (
          <div className="p-6 max-w-4xl">
            <div className="grid grid-cols-2 gap-6 mb-8">
              <div>
                <h3 className="text-sm font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider mb-4">AST Discovered Context</h3>
                {endpoint.source ? (
                  <div className="space-y-4">
                <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg p-4 transition-all">
                  <div className="flex items-center justify-between mb-3 text-[var(--color-text-secondary)] text-xs font-semibold">
                    <div className="flex items-center gap-2">
                      <FileCode size={14} className="text-[var(--color-primary)]" />
                      <span>SOURCE CONTROLLER & ROUTE</span>
                    </div>
                    {fileOptions.length > 0 && (
                      <span className="text-[11px] text-[var(--color-primary)] font-normal flex items-center gap-1">
                        <Eye size={12} /> Bấm để xem code
                      </span>
                    )}
                  </div>

                  <div className="space-y-2.5">
                    {/* Controller Handler Card */}
                    {endpoint.source.controllerFile ? (
                      <div
                        role="button"
                        tabIndex={0}
                        onClick={() => {
                          setCodeModalInitialIdx(0);
                          setCodeModalOpen(true);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            setCodeModalInitialIdx(0);
                            setCodeModalOpen(true);
                          }
                        }}
                        className="group flex items-center justify-between p-3 rounded-md bg-[var(--color-bg)] border border-[var(--color-border)] hover:border-[var(--color-primary)]/50 hover:bg-[var(--color-primary)]/5 cursor-pointer transition-all shadow-xs"
                        title="Bấm để xem code hàm Controller"
                      >
                        <div className="min-w-0 flex-1 pr-3">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-[10px] uppercase font-bold tracking-wider text-[var(--color-primary)] px-1.5 py-0.5 rounded bg-[var(--color-primary)]/10">
                              Controller Logic
                            </span>
                            {endpoint.source.controllerLine && (
                              <span className="text-[11px] font-mono font-semibold text-blue-400">
                                Line {endpoint.source.controllerLine}
                              </span>
                            )}
                          </div>
                          <div className="font-mono text-xs text-[var(--color-text)] truncate group-hover:text-[var(--color-primary)] transition-colors">
                            {endpoint.source.controllerFile}
                            {endpoint.source.controllerMethod && (
                              <span className="text-[var(--color-primary)] ml-1 font-bold">
                                #{endpoint.source.controllerMethod}
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {endpoint.source.controllerLine && (
                            <span className="px-2 py-0.5 rounded text-[11px] font-mono font-bold bg-blue-500/10 text-blue-400 border border-blue-500/20">
                              L{endpoint.source.controllerLine}
                            </span>
                          )}
                          <Eye size={15} className="text-[var(--color-text-muted)] group-hover:text-[var(--color-primary)] transition-colors" />
                        </div>
                      </div>
                    ) : null}

                    {/* Route Declaration Card */}
                    {endpoint.source.sourceFile ? (
                      <div
                        role="button"
                        tabIndex={0}
                        onClick={() => {
                          // If controller file exists, route is index 1; otherwise index 0
                          setCodeModalInitialIdx(endpoint.source.controllerFile ? 1 : 0);
                          setCodeModalOpen(true);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            setCodeModalInitialIdx(endpoint.source.controllerFile ? 1 : 0);
                            setCodeModalOpen(true);
                          }
                        }}
                        className="group flex items-center justify-between p-3 rounded-md bg-[var(--color-bg)] border border-[var(--color-border)] hover:border-[var(--color-primary)]/50 hover:bg-[var(--color-primary)]/5 cursor-pointer transition-all shadow-xs"
                        title="Bấm để xem code định nghĩa Route"
                      >
                        <div className="min-w-0 flex-1 pr-3">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-[10px] uppercase font-bold tracking-wider text-emerald-400 px-1.5 py-0.5 rounded bg-emerald-500/10">
                              Route Definition
                            </span>
                            {(endpoint.source.sourceLine || endpoint.provenance?.sourceLine) && (
                              <span className="text-[11px] font-mono font-semibold text-emerald-400">
                                Line {endpoint.source.sourceLine || endpoint.provenance?.sourceLine}
                              </span>
                            )}
                          </div>
                          <div className="font-mono text-xs text-[var(--color-text)] truncate group-hover:text-[var(--color-primary)] transition-colors">
                            {endpoint.source.sourceFile}
                            {!endpoint.source.controllerFile && endpoint.source.controllerMethod && (
                              <span className="text-[var(--color-primary)] ml-1 font-bold">
                                #{endpoint.source.controllerMethod}
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {(endpoint.source.sourceLine || endpoint.provenance?.sourceLine) && (
                            <span className="px-2 py-0.5 rounded text-[11px] font-mono font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                              L{endpoint.source.sourceLine || endpoint.provenance?.sourceLine}
                            </span>
                          )}
                          <Eye size={15} className="text-[var(--color-text-muted)] group-hover:text-[var(--color-primary)] transition-colors" />
                        </div>
                      </div>
                    ) : null}

                    {!endpoint.source.controllerFile && !endpoint.source.sourceFile && (
                      <div className="text-xs text-[var(--color-text-muted)] italic">
                        Không tìm thấy tệp mã nguồn tương ứng.
                      </div>
                    )}
                  </div>
                </div>

                <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg p-4">
                  <div className="flex items-center gap-2 mb-2 text-[var(--color-text-secondary)] text-xs font-semibold">
                    <Shield size={14} /> MIDDLEWARE
                  </div>
                  {endpoint.source.middleware && endpoint.source.middleware.length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                      {endpoint.source.middleware.map((m, i) => (
                        <span key={i} className="px-2 py-1 bg-[var(--color-bg)] border border-[var(--color-border)] rounded text-xs font-mono">{m}</span>
                      ))}
                    </div>
                  ) : (
                    <div className="text-xs text-[var(--color-text-muted)] italic">No middleware detected</div>
                  )}
                </div>

                <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg p-4">
                  <div className="flex items-center gap-2 mb-2 text-[var(--color-text-secondary)] text-xs font-semibold">
                    <Database size={14} /> DATABASE MODELS
                  </div>
                  {endpoint.source.databaseModels && endpoint.source.databaseModels.length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                      {endpoint.source.databaseModels.map((m, i) => (
                        <span key={i} className="px-2 py-1 bg-[#10b981]/10 text-[#10b981] border border-[#10b981]/20 rounded text-xs font-mono">{m}</span>
                      ))}
                    </div>
                  ) : (
                    <div className="text-xs text-[var(--color-text-muted)] italic">No database interactions detected</div>
                  )}
                </div>
              </div>
            ) : (
              <div className="p-4 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg text-sm text-[var(--color-text-secondary)] italic">
                Source mapping context is unavailable for this endpoint.
              </div>
            )}
            </div>
            
            {endpoint.provenance && (
              <div>
                <h3 className="text-sm font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider mb-4">Discovery Provenance</h3>
                <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg p-4">
                  <div className="grid grid-cols-2 gap-y-3 text-sm">
                    <div className="text-[var(--color-text-secondary)]">Detection Mechanism</div>
                    <div className="font-mono text-[var(--color-text)]">{endpoint.provenance.detectionType}</div>
                    
                    <div className="text-[var(--color-text-secondary)]">Resolution Status</div>
                    <div className="font-mono text-[var(--color-text)]">{endpoint.provenance.resolutionStatus}</div>
                    
                    <div className="text-[var(--color-text-secondary)]">Source Line</div>
                    <div className="font-mono text-[var(--color-text)]">{endpoint.provenance.sourceLine || 'Unknown'}</div>
                  </div>
                </div>
              </div>
            )}
            </div>
          </div>
        )}

        {tab === "EXECUTION" && (
          <div className="p-6 max-w-4xl">
             <h3 className="text-sm font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider mb-4">Endpoint Performance</h3>
             {endpoint.executedCount > 0 ? (
               <div className="mb-6 space-y-4">
                 <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                   <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg p-3">
                     <div className="text-xs text-[var(--color-text-secondary)] mb-1">Total Executed</div>
                     <div className="text-lg font-bold text-[#e6edf3]">{endpoint.executedCount}</div>
                   </div>
                   <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg p-3">
                     <div className="text-xs text-[var(--color-success)] mb-1">Passed</div>
                     <div className="text-lg font-bold text-[var(--color-success)]">{endpoint.passedCount || 0}</div>
                   </div>
                   <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg p-3">
                     <div className="text-xs text-[var(--color-danger)] mb-1">Failed</div>
                     <div className="text-lg font-bold text-[#f87171]">{endpoint.failedCount || 0}</div>
                   </div>
                   <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg p-3">
                     <div className="text-xs text-[#38bdf8] mb-1">Avg Latency</div>
                     <div className="text-lg font-bold text-[#e6edf3] flex items-center gap-1.5">
                       <Clock size={15} className="text-[#38bdf8]" />
                       <span>{endpoint.avgDurationMs || 0}ms</span>
                       {endpoint.latencyStatus === "SLOW" && (
                         <span className="text-[10px] bg-red-500/20 text-red-400 px-1.5 py-0.5 rounded font-bold">Chậm</span>
                       )}
                     </div>
                   </div>
                 </div>

                 {endpoint.scenarios && endpoint.scenarios.length > 0 && (
                   <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg p-4">
                     <div className="text-xs font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider mb-3">
                       Scenarios ({endpoint.scenarios.length})
                     </div>
                     <div className="space-y-2">
                        {endpoint.scenarios.map((sc, i) => {
                          const sType = sc.scenarioType || (sc.title?.toLowerCase().includes("happy") ? "HAPPY_PATH" : "NEGATIVE");
                          const sTypeColor = sType === "HAPPY_PATH" ? "#38bdf8" : sType === "VALIDATION" ? "#c084fc" : sType === "EDGE_CASE" ? "#818cf8" : "#fb923c";
                          const sTypeBg = sType === "HAPPY_PATH" ? "rgba(56,189,248,0.12)" : sType === "VALIDATION" ? "rgba(192,132,252,0.12)" : sType === "EDGE_CASE" ? "rgba(129,140,248,0.12)" : "rgba(251,146,60,0.12)";

                          return (
                            <div key={i} className="flex flex-col gap-2 p-2.5 rounded bg-[var(--color-bg)] border border-[var(--color-border)] text-xs">
                              <div className="flex items-center justify-between flex-wrap gap-2">
                                <div className="flex items-center gap-2 flex-wrap">
                                  {sc.status === "passed" ? (
                                    <CheckCircle size={13} className="text-[var(--color-success)] shrink-0" />
                                  ) : sc.status === "failed" ? (
                                    <XCircle size={13} className="text-[#f87171] shrink-0" />
                                  ) : (
                                    <span className="text-yellow-400 font-bold shrink-0">○</span>
                                  )}
                                  <span style={{ fontSize: 9, padding: "1px 5px", borderRadius: 3, fontWeight: 700, background: sTypeBg, color: sTypeColor, border: `1px solid ${sTypeColor}33` }}>
                                    {sType.replace(/_/g, " ")}
                                  </span>
                                  <code className="text-[10px] text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded font-mono" title="Request URL Template">
                                    {sc.urlTemplate || sc.resolvedUrl || endpoint.path}
                                  </code>
                                  <span className="font-medium text-[#e6edf3]">{sc.title}</span>
                                </div>
                                <div className="flex items-center gap-1.5 shrink-0 flex-wrap">
                                  {sc.durationMs > 0 && (
                                    <span className="text-[var(--color-text-secondary)] font-mono text-[11px] mr-1">⏱️ {sc.durationMs}ms</span>
                                  )}
                                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                                    sc.executionVerdict === 'PASS' ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/20' :
                                    sc.executionVerdict === 'FAIL' ? 'bg-red-500/15 text-red-400 border border-red-500/20' :
                                    'bg-yellow-500/15 text-yellow-400 border border-yellow-500/20'
                                  }`}>
                                    RUNNER: {sc.executionVerdict || (sc.status === 'passed' ? 'PASS' : 'FAIL')}
                                  </span>
                                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                                    sc.testValidity === 'VALID' ? 'bg-sky-500/15 text-sky-400 border border-sky-500/20' :
                                    'bg-purple-500/15 text-purple-400 border border-purple-500/20'
                                  }`} title="Tính hợp lệ của kịch bản và test oracle">
                                    VALIDITY: {sc.testValidity || 'VALID'}
                                  </span>
                                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                                    sc.implementationConsistency === 'CONSISTENT' ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/20' :
                                    sc.implementationConsistency === 'INCONSISTENT' ? 'bg-red-500/15 text-red-400 border border-red-500/20' :
                                    'bg-slate-500/15 text-slate-400 border border-slate-500/20'
                                  }`} title="Độ khớp với mã nguồn backend hiện tại">
                                    CODE: {sc.implementationConsistency || 'CONSISTENT'}
                                  </span>
                                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                                    sc.contractVerification === 'VERIFIED' ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/20' :
                                    'bg-amber-500/15 text-amber-400 border border-amber-500/20'
                                  }`} title={sc.contractEvidence || sc.classificationReason || ""}>
                                    CONTRACT: {sc.contractVerification || 'UNVERIFIED'}
                                  </span>
                                </div>
                              </div>
                              <div className="flex flex-col gap-1.5 text-[11px] text-[var(--color-text-secondary)] pl-5 pt-1.5 border-t border-[var(--color-border)]/50">
                                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 py-1.5 bg-[var(--color-surface)]/60 px-2.5 rounded border border-[var(--color-border)]/30">
                                  <div>
                                    <span className="text-slate-400">Expected HTTP Status: </span>
                                    <strong className="text-emerald-400 font-mono">
                                      {sc.expectedStatus != null ? `HTTP ${sc.expectedStatus}` : 'NOT_CAPTURED'}
                                    </strong>
                                  </div>
                                  <div>
                                    <span className="text-slate-400">Actual HTTP Status: </span>
                                    <strong className={sc.actualStatus != null ? (sc.actualStatus < 400 ? 'text-emerald-400 font-mono' : 'text-amber-400 font-mono') : 'text-slate-500 font-mono'}>
                                      {sc.actualStatus != null ? `HTTP ${sc.actualStatus}` : 'NOT_CAPTURED'}
                                    </strong>
                                  </div>
                                  <div>
                                    <span className="text-slate-400">Status Assertion: </span>
                                    <strong className={sc.statusAssertion === 'PASS' ? 'text-emerald-400 font-mono' : sc.statusAssertion === 'FAIL' ? 'text-red-400 font-mono' : 'text-slate-500 font-mono'}>
                                      {sc.statusAssertion || 'NOT_CAPTURED'}
                                    </strong>
                                  </div>
                                  <div>
                                    <span className="text-slate-400">Runner Verdict: </span>
                                    <strong className={sc.executionVerdict === 'PASS' ? 'text-emerald-400 font-mono' : sc.executionVerdict === 'FAIL' ? 'text-red-400 font-mono' : 'text-yellow-400 font-mono'}>
                                      {sc.executionVerdict || 'NOT_CAPTURED'}
                                    </strong>
                                  </div>
                                </div>

                                <div className="flex items-center justify-between flex-wrap gap-2 text-[10px] text-[var(--color-text-muted)]">
                                  <div>
                                    <span className="font-semibold text-slate-400">Request URL Template: </span>
                                    <code className="text-emerald-400/90 font-mono">{sc.urlTemplate || sc.requestUrlTemplate || endpoint.path || 'NOT_CAPTURED'}</code>
                                    <span className="mx-1 text-slate-600">|</span>
                                    <span className="font-semibold text-slate-400">Resolved URL: </span>
                                    <code className={sc.resolvedUrl ? "text-cyan-400 font-mono" : "text-slate-500 font-mono"}>
                                      {sc.resolvedUrl ? sc.resolvedUrl : 'NOT_CAPTURED'}
                                    </code>
                                    <span className="mx-1 text-slate-600">|</span>
                                    <span className="font-semibold text-slate-400">Resolution Source: </span>
                                    <span className="font-mono text-amber-300/80">{sc.resolutionSource || (sc.resolvedUrl ? 'RUNTIME_RESOLVED_ROUTE' : 'NOT_CAPTURED')}</span>
                                  </div>
                                  <div>
                                    <span className="font-semibold text-slate-400">Evidence Source: </span>
                                    <span className="font-mono text-cyan-300 font-semibold">{sc.evidenceSource || (sc.actualStatus != null ? 'TEST_SERVER_HTTP_RESPONSE' : 'NOT_CAPTURED')}</span>
                                  </div>
                                </div>

                                {sc.setupRequests && sc.setupRequests.length > 0 && (
                                  <div className="flex flex-col gap-1 text-[10px] bg-sky-950/20 border border-sky-800/30 rounded p-1.5">
                                    <span className="font-bold text-sky-400 flex items-center gap-1">
                                      🔧 Setup Requests ({sc.setupRequests.length}):
                                    </span>
                                    {sc.setupRequests.map((sReq, sIdx) => (
                                      <div key={sIdx} className="font-mono text-[10px] text-slate-300 flex items-center gap-2 pl-2">
                                        <span className="px-1 py-0.2 bg-sky-500/10 text-sky-300 rounded font-bold">{sReq.requestMethod || sReq.method}</span>
                                        <span className="text-cyan-300">{sReq.resolvedUrl || sReq.requestUrl || sReq.url}</span>
                                        <span className="text-emerald-400">→ HTTP {sReq.actualStatusFromRuntime ?? sReq.status ?? 'NOT_CAPTURED'}</span>
                                        <span className="text-amber-300/70 text-[9px]">[{sReq.fixtureSource || 'fixture seeding'}]</span>
                                      </div>
                                    ))}
                                  </div>
                                )}

                                {sc.teardownRequests && sc.teardownRequests.length > 0 && (
                                  <div className="flex flex-col gap-1 text-[10px] bg-slate-900/40 border border-slate-700/30 rounded p-1.5">
                                    <span className="font-bold text-slate-400 flex items-center gap-1">
                                      🧹 Teardown Requests ({sc.teardownRequests.length}):
                                    </span>
                                    {sc.teardownRequests.map((tReq, tIdx) => (
                                      <div key={tIdx} className="font-mono text-[10px] text-slate-400 flex items-center gap-2 pl-2">
                                        <span className="px-1 py-0.2 bg-slate-700/30 text-slate-300 rounded font-bold">{tReq.requestMethod || tReq.method}</span>
                                        <span className="text-slate-300">{tReq.resolvedUrl || tReq.requestUrl || tReq.url}</span>
                                        <span className="text-emerald-400">→ HTTP {tReq.actualStatusFromRuntime ?? tReq.status ?? 'NOT_CAPTURED'}</span>
                                      </div>
                                    ))}
                                  </div>
                                )}

                                <div className="text-[10px] text-[var(--color-text-muted)]">
                                  <span className="font-semibold text-slate-400">Evidence / Reason: </span>
                                  {sc.contractEvidence || sc.classificationReason || 'NOT_CAPTURED'}
                                </div>
                                {sc.requestPayload && Object.keys(sc.requestPayload).length > 0 && (
                                  <div className="text-[10px] font-mono text-slate-400 bg-black/20 p-1 rounded max-w-full overflow-x-auto">
                                    Payload: {JSON.stringify(sc.requestPayload)}
                                  </div>
                                )}
                              </div>
                            </div>
                          );
                        })}
                     </div>
                   </div>
                 )}
               </div>
             ) : (
               <div className="p-4 mb-6 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg text-sm text-[var(--color-text-secondary)]">
                 <div style={{ color: "#e6edf3", fontWeight: 600, marginBottom: 4 }}>Endpoint Chưa Được Test Đợt Này</div>
                 <p className="mb-4">
                   Endpoint này chưa có kịch bản nào được thực thi trong đợt chạy gần nhất. Hãy chạy lại kiểm thử để cập nhật số liệu.
                 </p>
                 <button 
                   onClick={() => {
                     const params = new URLSearchParams(window.location.search);
                     params.set("subtab", "history");
                     window.history.pushState(null, '', `${window.location.pathname}?${params.toString()}`);
                     window.dispatchEvent(new PopStateEvent('popstate'));
                   }}
                   className="flex items-center gap-2 px-3 py-1.5 rounded bg-[var(--color-primary)]/10 text-[var(--color-primary)] border border-[var(--color-primary)]/25 text-xs font-semibold hover:bg-[var(--color-primary)]/20 transition-colors"
                 >
                   <Activity size={14} /> View Global Execution History
                 </button>
               </div>
             )}

             <h3 className="text-sm font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider mb-4">Controller Coverage (Mapped)</h3>
             {endpoint.mappedCodeCoverage ? (
                <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg p-4">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                     <div>
                       <div className="text-xs text-[var(--color-text-secondary)] mb-1">Statements</div>
                       <div className={`text-xl font-bold ${endpoint.mappedCodeCoverage.statement > 80 ? 'text-[var(--color-success)]' : 'text-[var(--color-warning)]'}`}>{endpoint.mappedCodeCoverage.statement}%</div>
                     </div>
                     <div>
                       <div className="text-xs text-[var(--color-text-secondary)] mb-1">Branches</div>
                       <div className={`text-xl font-bold ${endpoint.mappedCodeCoverage.branch > 80 ? 'text-[var(--color-success)]' : 'text-[var(--color-warning)]'}`}>{endpoint.mappedCodeCoverage.branch}%</div>
                     </div>
                     <div>
                       <div className="text-xs text-[var(--color-text-secondary)] mb-1">Functions</div>
                       <div className={`text-xl font-bold ${endpoint.mappedCodeCoverage.function > 80 ? 'text-[var(--color-success)]' : 'text-[var(--color-warning)]'}`}>{endpoint.mappedCodeCoverage.function}%</div>
                     </div>
                     <div>
                       <div className="text-xs text-[var(--color-text-secondary)] mb-1">Lines</div>
                       <div className={`text-xl font-bold ${endpoint.mappedCodeCoverage.line > 80 ? 'text-[var(--color-success)]' : 'text-[var(--color-warning)]'}`}>{endpoint.mappedCodeCoverage.line}%</div>
                     </div>
                  </div>
                </div>
             ) : (
                <div className="p-4 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg text-sm text-[var(--color-text-secondary)] italic">
                  No Istanbul/Jest coverage was mapped to the source file for this endpoint in the latest run.
                </div>
             )}
          </div>
        )}
      </div>

      <SourceCodeViewerModal
        isOpen={codeModalOpen}
        onClose={() => setCodeModalOpen(false)}
        projectId={projectId}
        fileOptions={fileOptions}
        initialIndex={codeModalInitialIdx}
        onOpenFile={onOpenFile}
      />
    </div>
  );
}
