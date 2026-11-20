import { Fragment, useState } from 'react';
import { FileSearch, RefreshCcw } from 'lucide-react';
import { Button } from '../../ui/button';
import { CategoryBar, Legend, ProgressCircle } from '../../ui/tremor';
import { downloadDesignAudit } from '../../../services/trustworthiness.service';
import { Panel, EmptyState, StatusBadge } from './ui';
import { buttonClass, interactive } from './evaluationTheme';

const severities = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];
const severityColor = { CRITICAL: 'danger', HIGH: 'warning', MEDIUM: 'info', LOW: 'neutral' };
const location = item =>
  `${item.file || item.path || item.sourceFile || 'Unknown file'}:${item.line || 1}`;

export default function DesignAuditScreen({ projectId, workspace, api, act, busy, navigateView }) {
  const [expanded, setExpanded] = useState({});
  const audit = workspace.designAudit;
  const scan = () => act(() => api('/design-audit/scan', 'POST', {}), 'Snapshot scan completed.');
  const scanButton = (
    <Button className={buttonClass} variant="primary" loading={busy} onClick={scan}>Scan snapshot</Button>
  );
  if (audit?.status === 'NO_SNAPSHOT') {
    return <EmptyState icon={FileSearch} title="No snapshot yet"
      description="Import or sync the project first, then scan its snapshot." />;
  }
  if (!audit || audit.status === 'NOT_SCANNED') {
    return <EmptyState icon={FileSearch} title="Snapshot not scanned" action={scanButton}
      description="Scan your imported snapshot to detect the chatbot and review its design." />;
  }
  if (audit.status !== 'READY') {
    return <EmptyState icon={FileSearch} title="Snapshot unavailable" action={scanButton}
      description={audit.summary?.launchability?.reason || 'Sync the project snapshot and try scanning again.'} />;
  }
  if (!audit.detected) {
    return (
      <EmptyState icon={FileSearch} title="No AI or Chatbot integration detected in this snapshot."
        action={
          <Button className={buttonClass} variant="secondary"
            onClick={() => navigateView('setup', { mode: 'external' })}>
            Use an external chatbot URL
          </Button>
        } />
    );
  }
  const summary = audit.summary || {};
  const config = audit.autoFillConfig || {};
  const findings = [...(audit.findings || [])]
    .sort((a, b) => severities.indexOf(a.severity) - severities.indexOf(b.severity));
  return (
    <div className="space-y-5">
      <section className="flex flex-wrap items-center gap-x-8 gap-y-5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
        <div className="flex items-center gap-5">
          <ProgressCircle value={audit.designScore ?? 0} radius={42} strokeWidth={7}
            color={(audit.designScore ?? 0) >= 80 ? 'success' : (audit.designScore ?? 0) >= 50 ? 'warning' : 'danger'}>
            <span className="font-mono text-xl font-semibold tabular-nums">{audit.designScore ?? '—'}</span>
          </ProgressCircle>
          <div className="space-y-1">
            <h2 className="text-base font-semibold tracking-tight">Design score</h2>
            <p className="text-sm text-[var(--color-text-muted)]">From reading your chatbot&apos;s source code</p>
          </div>
        </div>
        <div className="min-w-[260px] flex-1 space-y-3">
          <CategoryBar segments={severities.map(severity => ({
            label: severity, value: summary.severityCounts?.[severity] ?? 0, color: severityColor[severity],
          }))} />
          <Legend items={severities.map(severity => ({
            label: severity.charAt(0) + severity.slice(1).toLowerCase(),
            value: summary.severityCounts?.[severity] ?? 0,
            color: severityColor[severity],
          }))} />
          {summary.pythonParserLimitation && <p className="text-sm text-amber-400">{summary.pythonParserLimitation}</p>}
        </div>
        <Button variant="secondary" loading={busy} onClick={scan}><RefreshCcw aria-hidden="true" />Re-scan</Button>
      </section>
      <Panel title="Detected inventory" description={`Ecosystem: ${summary.ecosystem || 'Unknown'}`}>
        <dl className="divide-y divide-[var(--color-border)] text-sm">
          <div className="grid gap-2 py-3 md:grid-cols-[12rem_1fr]">
            <dt className="text-[var(--color-text-secondary)]">AI SDK and required env vars</dt>
            <dd className="space-y-2">
              {(summary.sdks || []).map((sdk, index) => (
                <p key={index}>{sdk.name} · {sdk.provider} <span className="font-mono">{sdk.origin}</span></p>
              ))}
              <p className="font-mono">
                {(config.llmEnvVars || summary.launchability?.requiredLlmEnvVars || []).join(', ') ||
                  'No required LLM environment variables detected'}
              </p>
            </dd>
          </div>
          <div className="grid gap-2 py-3 md:grid-cols-[12rem_1fr]">
            <dt className="text-[var(--color-text-secondary)]">Endpoint and payload</dt>
            <dd className="space-y-2">
              {(summary.endpoints || []).map((endpoint, index) => (
                <div key={index}>
                  <code className="font-mono">{endpoint.method} {endpoint.endpointPath}</code>
                  {endpoint.requestFormat && endpoint.responseFormat ? (
                    <p>
                      Request: {endpoint.requestFormat} · Response: {endpoint.responseFormat} ·{' '}
                      {endpoint.requiresRouteAuth ? 'Authentication required' : 'No authentication detected'}
                    </p>
                  ) : (
                    <span className="text-[var(--color-text-secondary)]"> (not a chat endpoint)</span>
                  )}
                </div>
              ))}
              {!summary.endpoints?.length && <p>No chat endpoint detected</p>}
            </dd>
          </div>
          <div className="grid gap-2 py-3 md:grid-cols-[12rem_1fr]">
            <dt className="text-[var(--color-text-secondary)]">Auto-start readiness</dt>
            <dd>
              {summary.launchability?.ready ? <p>Ready for managed local startup (Node.js)</p> : (
                <>
                  <p>{summary.launchability?.reason || 'Managed startup is unavailable.'}</p>
                  <p className="text-[var(--color-text-muted)]">
                    Use External URL mode to connect your running chatbot.
                  </p>
                </>
              )}
            </dd>
          </div>
          <div className="grid gap-2 py-3 md:grid-cols-[12rem_1fr]">
            <dt className="text-[var(--color-text-secondary)]">System prompts and business documents</dt>
            <dd className="space-y-2">
              {(summary.systemPrompts || []).map((prompt, index) => (
                <p className="break-all font-mono tabular-nums" key={`prompt-${index}`}>{location(prompt)}</p>
              ))}
              {(summary.candidateDocs || []).map((doc, index) => (
                <p className="break-all font-mono tabular-nums" key={`doc-${index}`}>{location(doc)}</p>
              ))}
              {!summary.systemPrompts?.length && !summary.candidateDocs?.length && <p>No candidate files detected</p>}
            </dd>
          </div>
        </dl>
      </Panel>
      <Panel title="Static design findings">
        {!findings.length ? <EmptyState title="No static design findings" /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-[var(--color-text-secondary)]">
                <tr>
                  {['Severity', 'Rule', 'Title and description', 'Location', 'Recommendation'].map(label => (
                    <th className={`p-3 ${['Rule', 'Location'].includes(label) ? 'w-px whitespace-nowrap' : ''}`} key={label} scope="col">{label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {findings.map((finding, index) => (
                  <Fragment key={`${finding.ruleId}-${index}`}>
                    <tr className="border-t border-[var(--color-border)] align-top">
                      <td className="p-3"><StatusBadge value={finding.severity} /></td>
                      <td className="p-3 whitespace-nowrap font-mono">{finding.ruleId}</td>
                      <td className="p-3 min-w-48">
                        <button className={`text-left font-medium rounded-md ${interactive} active:scale-[0.98]`}
                          aria-expanded={!!expanded[index]} aria-controls={`finding-${index}`}
                          onClick={() => setExpanded(previous => ({ ...previous, [index]: !previous[index] }))}>
                          {finding.title}
                        </button>
                        <p className="mt-1 text-[var(--color-text-secondary)]">{finding.description}</p>
                      </td>
                      <td className="p-3 whitespace-nowrap font-mono tabular-nums">
                        <span className="block max-w-[16rem] truncate" title={location(finding)}>{location(finding)}</span>
                      </td>
                      <td className="p-3 min-w-48">{finding.recommendation}</td>
                    </tr>
                    {expanded[index] && (
                      <tr id={`finding-${index}`}>
                        <td colSpan={5} className="p-3">
                          <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-all rounded-md bg-[var(--color-bg)] p-4 text-xs font-mono tabular-nums">
                            {finding.snippet || 'No snippet available.'}
                          </pre>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      <div className="flex flex-wrap justify-end gap-2">
        {['json', 'pdf'].map(format => (
          <Button key={format} className={buttonClass} variant="secondary" disabled={busy}
            onClick={() => act(() => downloadDesignAudit(projectId, format))}>
            Export {format.toUpperCase()}
          </Button>
        ))}
        <Button className={buttonClass} variant="primary" disabled={busy} onClick={() => navigateView('setup')}>
          Continue to setup →
        </Button>
      </div>
    </div>
  );
}
