import { useEffect, useState, useId } from 'react';
import { Loader2, Sparkles, Download, ChevronDown, ChevronUp, BarChart3 } from 'lucide-react';
import Button from '../../common/Button.jsx';
import { systemEvidenceRequest } from '../../../services/systemTest.service.js';
import SystemTestImprovementReview from './SystemTestImprovementReview.jsx';
import SystemCoverageChart from './SystemCoverageChart.jsx';
import SystemTestGapNavigator from './SystemTestGapNavigator.jsx';

export default function SystemTestAssessmentPanel({ snapshotId, runner, executionMode, refreshKey, onChanged, onOpenFile, onRerun }) {
  const [expanded, setExpanded] = useState(true);
  const contentId = useId();
  const [capabilities, setCapabilities] = useState(null), [assessment, setAssessment] = useState(null), [proposal, setProposal] = useState(null);
  const [fileChoice, setFileChoice] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false), [notice, setNotice] = useState('');
  useEffect(() => {
    let active = true;
    if (!snapshotId) return;
    Promise.all([systemEvidenceRequest(snapshotId, 'capabilities'), systemEvidenceRequest(snapshotId, 'assessments').then(latest => latest?.id ? systemEvidenceRequest(snapshotId, `assessments/${latest.id}`) : latest)]).then(([capability, latest]) => {
      if (active) { setCapabilities(capability); setAssessment(latest); setError(''); }
    }).catch(err => { if (active) setError(err.response?.data?.message || err.message); });
    return () => { active = false; };
  }, [snapshotId, refreshKey]);
  useEffect(() => {
    if (!assessment?.id || !['QUEUED', 'RUNNING'].includes(assessment.status)) return;
    let active = true;
    const timer = setInterval(async () => {
      try { const data = await systemEvidenceRequest(snapshotId, `assessments/${assessment.id}`); if (active) setAssessment(data); }
      catch (err) { if (active) setError(err.response?.data?.message || err.message); }
    }, 4000);
    return () => { active = false; clearInterval(timer); };
  }, [snapshotId, assessment?.id, assessment?.status]);
  useEffect(() => {
    if (!proposal?.id || (!['QUEUED', 'DRAFT', 'VERIFYING', 'VERIFIED_IMPROVEMENT', 'NO_MEASURED_IMPROVEMENT'].includes(proposal.state) && !(proposal.state === 'APPLIED' && !['SUCCESS','FAILED'].includes(proposal.jobStatus)))) return;
    let active = true;
    const timer = setInterval(async () => {
      try { const data = await systemEvidenceRequest(snapshotId, `proposals/${proposal.id}`); if (active) setProposal(data); }
      catch (err) { if (active) setError(err.response?.data?.message || err.message); }
    }, 4000);
    return () => { active = false; clearInterval(timer); };
  }, [snapshotId, proposal?.id, proposal?.state, proposal?.jobStatus]);
  const report = assessment?.reportJson?.schemaVersion ? assessment.reportJson : null;
  const current = report?.runner === runner && report?.executionMode === executionMode ? report : null;
  const files = current?.staticAnalysis || [];
  const filePath = files.some(file => file.filePath === fileChoice) ? fileChoice : files[0]?.filePath;
  const running = ['QUEUED', 'RUNNING'].includes(assessment?.status);
  const findings = files.flatMap(file => file.findings || []), gaps = current?.gaps || [];
  const improve = async () => {
    setBusy(true); setError(''); setNotice('');
    try {
      const test = files.find(file => file.filePath === filePath);
      const data = await systemEvidenceRequest(snapshotId, 'improvements', { method: 'POST', data: { assessmentId: assessment.id, filePath, autoApply: true, gapIds: gaps.slice(0, 20).map(gap => gap.id), expectedTestHash: test.testHash } });
      setProposal({ id: data.proposalId, filePath, state: 'QUEUED', verificationJson: {} });
    } catch (err) { setError(err.response?.data?.message || err.message); } finally { setBusy(false); }
  };
  return <section className="overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] text-sm">
    <div className={`px-5 py-4 flex flex-wrap items-center justify-between gap-3 ${expanded ? 'border-b border-[var(--color-border)]' : ''}`}>
      <div className="flex items-center gap-3"><BarChart3 size={19} className="text-[var(--color-primary)] shrink-0" /><div><h3 className="font-semibold text-[var(--color-text)]">Coverage & test quality</h3><p className="mt-1 text-xs text-[var(--color-text-muted)]">Source execution and test evidence, measured with each run.</p></div></div>
      {running && <span role="status" className="flex items-center gap-2 text-xs text-[var(--color-primary)]"><Loader2 size={14} className="animate-spin" />Running suite and measuring coverage...</span>}
      <button type="button" aria-expanded={expanded} aria-controls={contentId} onClick={() => setExpanded(value => !value)} className="flex items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--color-border)] px-3 py-2 text-xs text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-secondary)] focus-visible:outline-2 focus-visible:outline-[var(--color-focus)]">{expanded ? 'Collapse' : 'Expand'}{expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}</button>
    </div>
    <div id={contentId} hidden={!expanded} className="p-4 sm:p-5 space-y-5">
      {!!assessment?.reportJson?.input?.excludedTests?.length && <details className="text-xs text-[var(--color-text-muted)]"><summary className="cursor-pointer">{assessment.reportJson.input.testFiles.length} files selected for Full Stack; {assessment.reportJson.input.excludedTests.length} mocked files belong to Frontend mode</summary><ul className="mt-3 space-y-2">{assessment.reportJson.input.excludedTests.map(file => <li key={file.filePath} className="break-all">{file.filePath}: {file.reason}</li>)}</ul></details>}
      {notice && <p role="status" className="text-[var(--color-success)] text-xs">{notice}</p>}
      {error && <p role="alert" className="text-[var(--color-danger)]">{error}</p>}
      {assessment?.reportJson?.error && <p role="alert" className="text-[var(--color-danger)]">{assessment.reportJson.error}</p>}
      {!snapshotId ? <p className="text-[var(--color-text-muted)]">Import source before running System Test.</p> : runner !== 'playwright' ? <p className="text-[var(--color-text-muted)]">Cypress execution is available. Source coverage measurement for Cypress is not supported yet.</p> : !current ? <p className="text-[var(--color-text-muted)]">{running ? 'Two independent runs are in progress. Results will appear here.' : capabilities && !capabilities.coverageEnabled ? 'Coverage measurement is disabled in this environment.' : 'Click Run above to scan existing tests, execute them and measure coverage. No additional input is needed.'}</p> : <>
        {assessment.stale && <p role="status" className="text-[var(--color-warning)]">Source or tests changed. Run again to refresh these measurements.</p>}
        <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-[var(--color-text-muted)]"><span>Source coverage by metric</span><span>Filled = executed · Track = total eligible scope</span></div>
        <div className="grid gap-4 lg:grid-cols-2">{['frontend', 'backend'].filter(tier => current.coverage.tiers[tier]).map(tier => <SystemCoverageChart key={tier} tier={tier} measurement={current.coverage.tiers[tier]} scope={current.input?.coverageScope?.[tier]} />)}</div>
        <div className="grid gap-4 sm:grid-cols-3 rounded-[var(--radius-md)] bg-[var(--color-surface-secondary)] p-4">
          <div><p className="text-xs text-[var(--color-text-muted)]">Independent runs passed</p><p className="mt-2 text-xl font-semibold tabular-nums">{current.stability.passedRuns}/{current.stability.runs}</p></div>
          <div><p className="text-xs text-[var(--color-text-muted)]">Static assertion findings</p><p className="mt-2 text-xl font-semibold tabular-nums">{findings.length}</p></div>
          <div><p className="text-xs text-[var(--color-text-muted)]">Business correctness</p><p className="mt-2 font-medium">Not established</p></div>
        </div>
        <p className="text-xs leading-relaxed text-[var(--color-text-muted)]">Coverage measures code execution, including app startup. Passing tests and no static findings do not prove complete correctness. Unloaded eligible files remain in the coverage denominator.</p>
        <SystemTestGapNavigator gaps={gaps} onOpenFile={onOpenFile} />
        <div className="flex flex-wrap items-center gap-3 border-t border-[var(--color-border)] pt-4">
          {files.length > 1 && <label className="text-xs text-[var(--color-text-muted)]">Improve test<select aria-label="Test to improve" value={filePath} onChange={event => setFileChoice(event.target.value)} className="ml-2 max-w-full rounded border border-[var(--color-border)] bg-[var(--color-surface-secondary)] p-2 text-[var(--color-text)]">{files.map(file => <option key={file.filePath}>{file.filePath}</option>)}</select></label>}
          <Button variant="primary" size="sm" className="!bg-[#6554d9] hover:!bg-[#5746c8]" icon={Sparkles} loading={busy} disabled={busy || !gaps.length || assessment.stale || !capabilities?.improvementEnabled || ['QUEUED','DRAFT','VERIFYING'].includes(proposal?.state)} onClick={improve}>AI improve tests</Button>
          <Button variant="secondary" size="sm" icon={Download} onClick={() => { const url = URL.createObjectURL(new Blob([JSON.stringify(current, null, 2)], { type: 'application/json' })); const link = document.createElement('a'); link.href = url; link.download = 'system-assessment.json'; link.click(); URL.revokeObjectURL(url); }}>Export measurements</Button>
        </div>
        <p className="text-xs text-[var(--color-text-muted)]">AI adds tests, verifies them and saves only passing changes. Tests run again automatically to update these measurements.</p>
      </>}
      {proposal && <SystemTestImprovementReview snapshotId={snapshotId} proposal={proposal} onError={setError} onRetry={improve} onOpenFile={onOpenFile} onApplied={() => { setProposal(null); setNotice('Tests saved successfully. A new run will refresh coverage and test results.'); onChanged(); onRerun?.(); }} />}
    </div>
  </section>;
}
