import React, { useState, useEffect, useCallback } from 'react';
import { AlertTriangle, CheckCircle, Info, XCircle, Activity, ChevronDown, ChevronRight, ArrowRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { fetchIntegrationGuidance } from '../../../services/report.service';

const getSeverityIcon = (severity) => {
  switch (severity) {
    case 'ERROR': return <XCircle className="text-red-400" size={20} />;
    case 'WARNING': return <AlertTriangle className="text-yellow-400" size={20} />;
    case 'SUCCESS': return <CheckCircle className="text-green-400" size={20} />;
    case 'INFO': return <Info className="text-blue-400" size={20} />;
    default: return <Info className="text-[var(--text-secondary)]" size={20} />;
  }
};

const getSeverityColor = (severity) => {
  switch (severity) {
    case 'ERROR': return 'border-red-400/30 bg-red-400/5';
    case 'WARNING': return 'border-yellow-400/30 bg-yellow-400/5';
    case 'SUCCESS': return 'border-green-400/30 bg-green-400/5';
    case 'INFO': return 'border-blue-400/30 bg-blue-400/5';
    default: return 'border-[var(--border-main)] bg-[var(--surface-main)]';
  }
};

function GuidanceRule({ rule, projectId }) {
  const [expanded, setExpanded] = useState(false);
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
            <h3 className="font-semibold text-white text-lg">{rule.finding}</h3>
            <span className="text-xs px-2 py-1 rounded bg-[var(--surface-hover)] border border-[var(--border-main)] font-mono text-[var(--text-secondary)]">
              {rule.severity}
            </span>
          </div>
          
          <p className="text-[var(--text-secondary)] font-medium mt-1 mb-3">{rule.meaning}</p>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <div className="p-3 bg-[var(--surface-main)] rounded border border-[var(--border-main)]">
              <p className="text-sm font-semibold text-white mb-1">Evidence</p>
              <ul className="text-xs text-[var(--text-secondary)] space-y-1">
                {rule.evidence?.source && <li><strong className="text-[var(--text-muted)]">Source:</strong> {rule.evidence.source}</li>}
                {rule.evidence?.snapshotId && <li><strong className="text-[var(--text-muted)]">Snapshot:</strong> <span className="font-mono">{rule.evidence.snapshotId.slice(-6)}</span></li>}
                {rule.evidence?.jobId && <li><strong className="text-[var(--text-muted)]">Job:</strong> <span className="font-mono">{rule.evidence.jobId.slice(-6)}</span></li>}
                {rule.evidence?.testRunId && <li><strong className="text-[var(--text-muted)]">TestRun:</strong> <span className="font-mono">{rule.evidence.testRunId.slice(-6)}</span></li>}
                {rule.evidence?.details && <li><strong className="text-[var(--text-muted)]">Details:</strong> {rule.evidence.details}</li>}
              </ul>
              {rule.calculation && (
                 <p className="text-xs text-[var(--text-secondary)] mt-2 pt-2 border-t border-[var(--border-main)]">
                   <strong className="text-[var(--text-muted)]">Formula:</strong> {rule.calculation}
                 </p>
              )}
              {rule.scope && (
                 <p className="text-xs text-[var(--text-secondary)] mt-1">
                   <strong className="text-[var(--text-muted)]">Scope:</strong> {rule.scope}
                 </p>
              )}
            </div>

            <div className="p-3 bg-[var(--surface-main)] rounded border border-[var(--border-main)] flex flex-col justify-between">
              <div>
                 <p className="text-sm font-semibold text-white mb-1">Impact & Recommended Action</p>
                 <p className="text-xs text-red-300 mb-2">{rule.impact}</p>
                 <p className="text-sm text-[var(--text-secondary)] mb-2">{rule.recommendedAction}</p>
              </div>
              
              {rule.actionType && (
                <button 
                  onClick={handleAction}
                  className="self-start flex items-center px-4 py-1.5 bg-[var(--accent-primary)] text-white text-xs font-semibold rounded hover:bg-opacity-90 transition-colors"
                >
                  {rule.actionType.replace(/_/g, ' ')} <ArrowRight size={14} className="ml-1" />
                </button>
              )}
            </div>
          </div>

          {rule.verification && (
             <div className="mt-2 text-xs text-[var(--text-secondary)] flex items-start gap-1">
               <strong className="text-green-400">Verification:</strong> {rule.verification}
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
      <div className="bg-[var(--surface-card)] border border-[var(--border-main)] rounded-lg p-6 my-8">
        <h2 className="text-xl font-bold mb-4 flex items-center border-b border-[var(--border-main)] pb-2 text-white">
          <Activity className="mr-2 text-[var(--accent-primary)]" size={20} /> Integration Guidance
        </h2>
        <div className="flex justify-center py-8">
          <Activity className="animate-spin text-[var(--accent-primary)]" size={24} />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-[var(--surface-card)] border border-[var(--border-main)] rounded-lg p-6 my-8">
        <h2 className="text-xl font-bold mb-4 flex items-center border-b border-[var(--border-main)] pb-2 text-white">
          <Activity className="mr-2 text-[var(--accent-primary)]" size={20} /> Integration Guidance
        </h2>
        <div className="p-4 bg-red-400/10 border border-red-400/20 rounded text-red-400 text-sm">
          {error}
        </div>
      </div>
    );
  }

  return (
    <div className="bg-[var(--surface-card)] border border-[var(--border-main)] rounded-lg p-6 my-8">
      <h2 className="text-xl font-bold mb-4 flex items-center border-b border-[var(--border-main)] pb-2 text-white">
        <Activity className="mr-2 text-[var(--accent-primary)]" size={20} /> Integration Guidance
      </h2>
      
      {rules.length === 0 ? (
        <div className="py-8 text-center text-[var(--text-secondary)] italic border border-dashed border-[var(--border-main)] rounded bg-[var(--surface-main)]">
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
