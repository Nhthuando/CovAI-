import React, { useState, useEffect, useCallback } from 'react';
import { AlertTriangle, CheckCircle, Info, XCircle, Activity, ArrowRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { fetchIntegrationGuidance } from '../../../services/report.service';

const getSeverityIcon = (severity) => {
  switch (severity) {
    case 'ERROR': return <XCircle className="text-[var(--color-danger)]" size={20} />;
    case 'WARNING': return <AlertTriangle className="text-[var(--color-warning)]" size={20} />;
    case 'SUCCESS': return <CheckCircle className="text-[var(--color-success)]" size={20} />;
    case 'INFO': return <Info className="text-[var(--color-info)]" size={20} />;
    default: return <Info className="text-[var(--color-text-secondary)]" size={20} />;
  }
};

const getSeverityColor = (severity) => {
  switch (severity) {
    case 'ERROR': return 'border-[var(--color-danger)]/30 bg-[var(--color-danger)]/5';
    case 'WARNING': return 'border-[var(--color-warning)]/30 bg-[var(--color-warning)]/5';
    case 'SUCCESS': return 'border-[var(--color-success)]/30 bg-[var(--color-success)]/5';
    case 'INFO': return 'border-[var(--color-info)]/30 bg-[var(--color-info)]/5';
    default: return 'border-[var(--color-border)] bg-[var(--color-surface-secondary)]';
  }
};

function GuidanceRule({ rule, projectId }) {
  const navigate = useNavigate();

  const handleAction = () => {
    if (rule.actionType === 'VIEW_REPORT') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } else {
      if (rule.actionType === 'VIEW_HISTORY') {
        navigate(`/main-editor?projectId=${projectId}&tab=integration-tests&subtab=history`);
      } else if (rule.actionType === 'REVIEW_SCENARIOS') {
        navigate(`/main-editor?projectId=${projectId}&tab=integration-tests`);
      } else {
        navigate(`/main-editor?projectId=${projectId}&tab=integration-tests`);
      }
    }
  };

  return (
    <div className={`rounded-lg border ${getSeverityColor(rule.severity)} p-4 mb-4 transition-colors`}>
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex-shrink-0">
          {getSeverityIcon(rule.severity)}
        </div>
        <div className="flex-grow">
          <div className="flex justify-between items-start">
            <h3 className="font-semibold text-[var(--color-text)] text-lg">{rule.finding}</h3>
            <span className="text-xs px-2 py-1 rounded bg-[var(--color-surface-hover)] border border-[var(--color-border)] font-mono text-[var(--color-text-secondary)] font-medium">
              {rule.severity}
            </span>
          </div>
          
          <p className="text-[var(--color-text-secondary)] font-medium mt-1 mb-3">{rule.meaning}</p>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <div className="p-3 bg-[var(--color-surface-secondary)] rounded border border-[var(--color-border)]">
              <p className="text-sm font-semibold text-[var(--color-text)] mb-1">Evidence</p>
              <ul className="text-xs text-[var(--color-text-secondary)] space-y-1">
                {rule.evidence?.source && <li><strong className="text-[var(--color-text-muted)]">Source:</strong> {rule.evidence.source}</li>}
                {rule.evidence?.snapshotId && <li><strong className="text-[var(--color-text-muted)]">Snapshot:</strong> <span className="font-mono">{rule.evidence.snapshotId.slice(-6)}</span></li>}
                {rule.evidence?.jobId && <li><strong className="text-[var(--color-text-muted)]">Job:</strong> <span className="font-mono">{rule.evidence.jobId.slice(-6)}</span></li>}
                {rule.evidence?.testRunId && <li><strong className="text-[var(--color-text-muted)]">TestRun:</strong> <span className="font-mono">{rule.evidence.testRunId.slice(-6)}</span></li>}
                {rule.evidence?.details && <li><strong className="text-[var(--color-text-muted)]">Details:</strong> {rule.evidence.details}</li>}
              </ul>
              {rule.calculation && (
                 <p className="text-xs text-[var(--color-text-secondary)] mt-2 pt-2 border-t border-[var(--color-border)]">
                   <strong className="text-[var(--color-text-muted)]">Formula:</strong> {rule.calculation}
                 </p>
              )}
              {rule.scope && (
                 <p className="text-xs text-[var(--color-text-secondary)] mt-1">
                   <strong className="text-[var(--color-text-muted)]">Scope:</strong> {rule.scope}
                 </p>
              )}
            </div>

            <div className="p-3 bg-[var(--color-surface-secondary)] rounded border border-[var(--color-border)] flex flex-col justify-between">
              <div>
                 <p className="text-sm font-semibold text-[var(--color-text)] mb-1">Impact & Recommended Action</p>
                 <p className="text-xs text-[var(--color-danger)] font-medium mb-2">{rule.impact}</p>
                 <p className="text-sm text-[var(--color-text-secondary)] mb-2">{rule.recommendedAction}</p>
              </div>
              
              {rule.actionType && (
                <button 
                  onClick={handleAction}
                  className="self-start flex items-center px-4 py-1.5 bg-[var(--color-primary)] text-[var(--color-primary-foreground)] text-xs font-semibold rounded hover:opacity-90 transition-opacity"
                >
                  {rule.actionType.replace(/_/g, ' ')} <ArrowRight size={14} className="ml-1" />
                </button>
              )}
            </div>
          </div>

          {/* V2: Backward Path Slicing - Branch Constraints */}
          {Array.isArray(rule.pathConstraints) && rule.pathConstraints.length > 0 && (
            <div className="mb-4 p-3 bg-[var(--color-surface-secondary)] rounded border border-[var(--color-border)]">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-semibold text-[var(--color-text)] flex items-center gap-1.5">
                  <span className="inline-block w-2 h-2 rounded-full bg-[var(--color-primary)]"></span>
                  Branch Conditions Required for Target Execution
                </p>
                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-[var(--color-surface-hover)] text-[var(--color-text-secondary)] border border-[var(--color-border)]">
                  {rule.pathConstraints.length} condition{rule.pathConstraints.length > 1 ? 's' : ''}
                </span>
              </div>
              
              <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
                {rule.pathConstraints.map((pc, idx) => {
                  const isUnresolved = pc.status === 'UNRESOLVED' || pc.condition === 'unresolved';
                  const typeColors = {
                    IF: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
                    SWITCH: 'bg-purple-500/10 text-purple-400 border-purple-500/20',
                    TRY_CATCH: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
                    TERNARY: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
                    default: 'bg-[var(--color-surface-hover)] text-[var(--color-text-secondary)] border-[var(--color-border)]'
                  };
                  const badgeClass = typeColors[pc.type] || typeColors.default;

                  return (
                    <div 
                      key={idx} 
                      className="p-2 rounded bg-[var(--color-surface-hover)]/40 border border-[var(--color-border)]/60 text-xs flex flex-col gap-1"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5">
                          <span className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold border ${badgeClass}`}>
                            {pc.type || 'BRANCH'}
                          </span>
                          {pc.filePath && (
                            <span className="text-[11px] font-mono text-[var(--color-text-muted)] truncate max-w-[220px]" title={pc.filePath}>
                              {pc.filePath}
                            </span>
                          )}
                        </div>
                        <span className="text-[10px] text-[var(--color-text-secondary)] font-mono">
                          {pc.line ? `Line ${pc.line}` : 'Line ?'}
                          {pc.uncoveredLine && pc.uncoveredLine !== pc.line ? ` → Target L${pc.uncoveredLine}` : ''}
                        </span>
                      </div>

                      <div className="flex items-baseline gap-2 mt-0.5">
                        {isUnresolved ? (
                          <span className="text-[var(--color-warning)] italic text-[11px] flex items-center gap-1">
                            ⚠️ Condition unresolved (ambiguous or dynamic path)
                          </span>
                        ) : (
                          <code className="text-[var(--color-text)] font-mono text-[11px] bg-[var(--color-surface-hover)] px-1.5 py-0.5 rounded border border-[var(--color-border)] break-all">
                            {pc.condition}
                          </code>
                        )}
                        <span className="text-[var(--color-text-secondary)] text-[11px] whitespace-nowrap ml-auto">
                          {isUnresolved ? (
                            <span className="text-[var(--color-warning)] font-mono font-semibold">UNRESOLVED</span>
                          ) : (
                            <>Requires: <strong className="text-[var(--color-primary)] font-mono">{pc.requiredBranch || 'COVER'}</strong></>
                          )}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {rule.verification && (
             <div className="mt-2 text-xs text-[var(--color-text-secondary)] flex items-start gap-1">
               <strong className="text-[var(--color-success)]">Verification:</strong> {rule.verification}
             </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function IntegrationGuidancePanel({ projectId }) {
  const [rules, setRules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const loadGuidance = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetchIntegrationGuidance(projectId);
      if (res.success && res.data && Array.isArray(res.data.rules)) {
        setRules(res.data.rules);
      } else {
        setRules([]);
      }
    } catch (err) {
      setError("Guidance could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    loadGuidance();
  }, [loadGuidance]);

  if (loading) {
    return (
      <div className="bg-[var(--color-surface-raised)] border border-[var(--color-border)] rounded-lg p-6 my-8">
        <h2 className="text-xl font-bold mb-4 flex items-center border-b border-[var(--color-border)] pb-2 text-[var(--color-text)]">
          <Activity className="mr-2 text-[var(--color-primary)]" size={20} /> Integration Guidance
        </h2>
        <div className="flex justify-center py-8">
          <Activity className="animate-spin text-[var(--color-primary)]" size={24} />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-[var(--color-surface-raised)] border border-[var(--color-border)] rounded-lg p-6 my-8">
        <h2 className="text-xl font-bold mb-4 flex items-center border-b border-[var(--color-border)] pb-2 text-[var(--color-text)]">
          <Activity className="mr-2 text-[var(--color-primary)]" size={20} /> Integration Guidance
        </h2>
        <div className="p-4 bg-[var(--color-danger)]/10 border border-[var(--color-danger)]/25 rounded text-[var(--color-danger)] text-sm">
          {error}
        </div>
      </div>
    );
  }

  return (
    <div className="bg-[var(--color-surface-raised)] border border-[var(--color-border)] rounded-lg p-6 my-8">
      <h2 className="text-xl font-bold mb-4 flex items-center border-b border-[var(--color-border)] pb-2 text-[var(--color-text)]">
        <Activity className="mr-2 text-[var(--color-primary)]" size={20} /> Integration Guidance
      </h2>
      
      {rules.length === 0 ? (
        <div className="py-8 text-center text-[var(--color-text-secondary)] italic border border-dashed border-[var(--color-border)] rounded bg-[var(--color-surface-secondary)]">
          No guidance is currently available.
        </div>
      ) : (
        <div className="space-y-4">
          {rules.map((rule, idx) => (
            <GuidanceRule key={`${rule.id}-${idx}`} rule={rule} projectId={projectId} />
          ))}
        </div>
      )}
    </div>
  );
}
