import React, { useState } from "react";
import { Database, FileCode, GitBranch, PlayCircle, Shield, Activity, Network, Sparkles } from "lucide-react";

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
  isGenerating = false,
}) {
  const [tab, setTab] = useState("OVERVIEW"); // OVERVIEW | EXECUTION

  if (!endpoint) return null;

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
                <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg p-4">
                  <div className="flex items-center gap-2 mb-2 text-[var(--color-text-secondary)] text-xs font-semibold">
                    <FileCode size={14} /> SOURCE CONTROLLER
                  </div>
                  <div className="font-mono text-sm text-[var(--color-text)] break-all">
                    {endpoint.source.sourceFile}
                    <span className="text-[var(--color-primary)] ml-2">#{endpoint.source.controllerMethod || 'unknown'}</span>
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

            <div className="pt-6 border-t border-[var(--color-border)] mt-4">
              <h3 className="text-sm font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider mb-4">Deep Analysis Tools</h3>
              <p className="text-xs text-[var(--color-text-secondary)] mb-4">
                Use these tools to investigate the internal logic and architecture of this endpoint to better understand edge cases and dependencies.
              </p>
              <div className="flex flex-wrap items-center gap-3">
                <button 
                  onClick={() => window.open(`/integration-report/${projectId}`, '_blank')} 
                  className="flex items-center gap-2 px-4 py-2 rounded bg-[var(--color-primary)]/10 text-[var(--color-primary)] border border-[var(--color-primary)]/25 text-sm font-semibold hover:bg-[var(--color-primary)]/20 transition-colors"
                >
                  <FileCode size={16} /> API Integration Report
                </button>
                {endpoint.source?.sourceFile && onSuggestTestcase && (
                  <button onClick={() => onSuggestTestcase(endpoint.source.sourceFile)} className="flex items-center gap-2 px-4 py-2 rounded bg-[#ec4899]/10 text-[#ec4899] border border-[#ec4899]/25 text-sm font-semibold hover:bg-[#ec4899]/20 transition-colors">
                    <Shield size={16} /> Generate Unit Tests
                  </button>
                )}
                {endpoint.source?.controllerMethod && onOpenCFG && (
                  <button onClick={() => onOpenCFG(endpoint.source.sourceFile, endpoint.source.controllerMethod)} className="flex items-center gap-2 px-4 py-2 rounded bg-[#3b82f6]/10 text-[#3b82f6] border border-[#3b82f6]/25 text-sm font-semibold hover:bg-[#3b82f6]/20 transition-colors">
                    <GitBranch size={16} /> View Logic Flow
                  </button>
                )}
                {endpoint.source?.sourceFile && onOpenArchitecture && (
                  <button onClick={() => onOpenArchitecture(endpoint.source.sourceFile)} className="flex items-center gap-2 px-4 py-2 rounded bg-[#8b5cf6]/10 text-[#8b5cf6] border border-[#8b5cf6]/25 text-sm font-semibold hover:bg-[#8b5cf6]/20 transition-colors">
                    <Network size={16} /> View Architecture
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {tab === "EXECUTION" && (
          <div className="p-6 max-w-4xl">
             <h3 className="text-sm font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider mb-4">Endpoint Performance</h3>
             <div className="p-4 mb-6 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg text-sm text-[var(--color-text-secondary)]">
               <div style={{ color: "#e6edf3", fontWeight: 600, marginBottom: 4 }}>Per-Endpoint Results Unavailable</div>
               <p className="mb-4">
                 Execution counts (Passed/Failed) cannot be derived reliably at the individual endpoint level. Please refer to the global Execution Summary for accurate runtime results.
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
    </div>
  );
}
