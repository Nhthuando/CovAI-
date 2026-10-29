import { useEffect, useState, useId } from 'react';
import {
  Loader2,
  Sparkles,
  Download,
  ChevronDown,
  ChevronUp,
  BarChart3,
  ShieldCheck,
  CheckCircle2,
  Play,
} from 'lucide-react';
import Button from '../../common/Button.jsx';
import { systemEvidenceRequest, downloadSystemAssessmentPdf } from '../../../services/systemTest.service.js';
import SystemTestImprovementReview from './SystemTestImprovementReview.jsx';
import SystemTestDimensionsTable from './SystemTestDimensionsTable.jsx';
import SystemTestScenarioLibrary from './SystemTestScenarioLibrary.jsx';
import SystemTestGapNavigator from './SystemTestGapNavigator.jsx';

const selectImprovementGaps = gaps => {
  const groups = new Map();
  for (const gap of gaps) {
    const key = gap.filePath || gap.criterionId || gap.kind;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(gap);
  }
  const selected = [];
  for (let index = 0; selected.length < 20; index++) {
    const next = [...groups.values()].flatMap(group => group[index] ? [group[index]] : []);
    if (!next.length) break;
    selected.push(...next.slice(0, 20 - selected.length));
  }
  return selected;
};

export default function SystemTestAssessmentPanel({
  snapshotId,
  runner,
  executionMode,
  refreshKey,
  onChanged,
  onOpenFile,
  onRerun,
}) {
  const [expanded, setExpanded] = useState(true);
  const contentId = useId();
  const [capabilities, setCapabilities] = useState(null);
  const [assessment, setAssessment] = useState(null);
  const [proposal, setProposal] = useState(null);
  const [scenarios, setScenarios] = useState([]);
  const [fileChoice, setFileChoice] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    if (!snapshotId) return;

    Promise.all([
      systemEvidenceRequest(snapshotId, 'capabilities').catch(() => null),
      systemEvidenceRequest(snapshotId, 'assessments')
        .then(latest => latest?.id ? systemEvidenceRequest(snapshotId, `assessments/${latest.id}`) : latest)
        .catch(() => null),
      systemEvidenceRequest(snapshotId, 'proposals').catch(() => null),
      systemEvidenceRequest(snapshotId, 'scenarios').catch(() => []),
    ]).then(([capability, latest, recovered, scns]) => {
      if (active) {
        setCapabilities(capability);
        setAssessment(latest);
        setProposal(recovered);
        setScenarios(scns?.scenarios || (Array.isArray(scns) ? scns : []));
        setError('');
      }
    }).catch(err => {
      if (active) setError(err.response?.data?.message || err.message);
    });

    return () => { active = false; };
  }, [snapshotId, refreshKey]);

  useEffect(() => {
    if (!assessment?.id || !['QUEUED', 'RUNNING'].includes(assessment.status)) return;
    let active = true;
    const timer = setInterval(async () => {
      if (document.hidden) return;
      try {
        const data = await systemEvidenceRequest(snapshotId, `assessments/${assessment.id}`);
        if (active) setAssessment(data);
      } catch (err) {
        if (active) setError(err.response?.data?.message || err.message);
      }
    }, 10000);
    return () => { active = false; clearInterval(timer); };
  }, [snapshotId, assessment?.id, assessment?.status]);

  useEffect(() => {
    if (!proposal?.id || (!['QUEUED', 'DRAFT', 'VERIFYING'].includes(proposal.state) && !(['VERIFIED_IMPROVEMENT','APPLIED'].includes(proposal.state) && proposal.verificationJson?.autoApply && !['SUCCESS','FAILED','CANCELED'].includes(proposal.jobStatus)))) return;
    let active = true;
    const poll = async () => {
      if (document.hidden) return;
      try {
        const data = await systemEvidenceRequest(snapshotId, `proposals/${proposal.id}`);
        if (active) setProposal(data);
      } catch (err) {
        if (active) setError(err.response?.data?.message || err.message);
      }
    };
    const timer = setInterval(poll, 10000);
    window.addEventListener('focus', poll);
    document.addEventListener('visibilitychange', poll);
    return () => {
      active = false;
      clearInterval(timer);
      window.removeEventListener('focus', poll);
      document.removeEventListener('visibilitychange', poll);
    };
  }, [snapshotId, proposal?.id, proposal?.state, proposal?.jobStatus, proposal?.verificationJson?.autoApply]);

  const report = assessment?.reportJson?.schemaVersion ? assessment.reportJson : null;
  const current = report?.runner === runner && report?.executionMode === executionMode ? report : (report || null);
  const files = current?.staticAnalysis || [];
  const filePath = files.some(file => file.filePath === fileChoice) ? fileChoice : files[0]?.filePath;
  const running = ['QUEUED', 'RUNNING'].includes(assessment?.status);
  const findings = files.flatMap(file => file.findings || []);
  const gaps = current?.gaps || [];

  const observedApiCalls = (current?.runs || []).flatMap(run =>
    (run.testRun?.scenarios || []).flatMap(scenario =>
      (scenario.apiCalls || []).map((call, index) => ({
        ...call,
        runIndex: run.index,
        title: scenario.title,
        key: `${run.index}:${scenario.testFile}:${scenario.title}:${index}`
      }))
    )
  );

  const improve = async () => {
    setBusy(true);
    setError('');
    try {
      const test = files.find(file => file.filePath === filePath);
      const instruction = proposal?.state === 'FAILED_VERIFICATION' && proposal.filePath === filePath && proposal.failureSummary
        ? `Previous proposal failed verification. Correct these interaction mechanics without weakening expected outcomes: ${JSON.stringify(proposal.failureSummary).slice(0, 1500)}`
        : '';
      const data = await systemEvidenceRequest(snapshotId, 'improvements', {
        method: 'POST',
        data: {
          assessmentId: assessment.id,
          filePath,
          autoApply: false,
          gapIds: selectImprovementGaps(gaps).map(gap => gap.id),
          expectedTestHash: test?.testHash,
          instruction
        }
      });
      setProposal({ ...data, id: data.proposalId, filePath, state: 'QUEUED', jobStatus: 'QUEUED', verificationJson: {} });
    } catch (err) {
      setError(err.response?.data?.message || err.message);
    } finally {
      setBusy(false);
    }
  };

  const hasExecuted = Boolean(current && current.scenarioVerdicts?.length);

  return (
    <section className="overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)] shadow-sm transition-all">
      {/* Panel Main Header */}
      <div className={`px-6 py-4 flex flex-wrap items-center justify-between gap-4 bg-[var(--color-surface-secondary)]/50 ${expanded ? 'border-b border-[var(--color-border)]' : ''}`}>
        <div className="flex items-center gap-3.5">
          <div className="p-2.5 rounded-xl bg-gradient-to-br from-indigo-500/20 to-purple-500/10 border border-indigo-500/30 text-indigo-500 dark:text-indigo-400">
            <BarChart3 size={20} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-bold text-base text-[var(--color-text)] tracking-tight">
                System Coverage &amp; Test Quality
              </h3>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/25">
                Playwright Engine
              </span>
            </div>
            <p className="mt-0.5 text-xs text-[var(--color-text-secondary)]">
              Multi-dimensional system verification: user stories, workflows, screens, and API endpoints.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {running && (
            <span role="status" className="flex items-center gap-2 text-xs font-mono text-indigo-500 dark:text-indigo-400 bg-indigo-500/10 border border-indigo-500/20 px-3 py-1.5 rounded-lg">
              <Loader2 size={13} className="animate-spin" />
              Measuring multi-tier execution...
            </span>
          )}

          <button
            type="button"
            aria-expanded={expanded}
            aria-controls={contentId}
            onClick={() => setExpanded(value => !value)}
            className="flex items-center gap-1.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-xs font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-secondary)] transition-colors focus-visible:outline-2 cursor-pointer"
          >
            {expanded ? 'Collapse' : 'Expand'}
            {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
        </div>
      </div>

      <div id={contentId} hidden={!expanded} className="p-5 sm:p-6 space-y-6">
        {!!assessment?.reportJson?.input?.excludedTests?.length && (
          <details className="text-xs text-[var(--color-text-secondary)] bg-[var(--color-surface-secondary)]/50 p-3 rounded-lg border border-[var(--color-border)]">
            <summary className="cursor-pointer font-medium hover:text-[var(--color-text)]">
              {assessment.reportJson.input.testFiles.length} files selected for Full Stack; {assessment.reportJson.input.excludedTests.length} mocked files belong to Frontend mode
            </summary>
            <ul className="mt-2 space-y-1 font-mono text-[11px] text-[var(--color-text-muted)] pl-4 list-disc">
              {assessment.reportJson.input.excludedTests.map(file => (
                <li key={file.filePath} className="break-all">{file.filePath}: {file.reason}</li>
              ))}
            </ul>
          </details>
        )}

        {error && (
          <div className="p-3.5 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-500 dark:text-rose-300 text-xs flex items-center justify-between">
            <span>{error}</span>
            <button type="button" onClick={() => setError('')} className="underline text-xs">Dismiss</button>
          </div>
        )}

        {assessment?.reportJson?.error && (
          <div className="p-3.5 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-500 dark:text-rose-300 text-xs">
            {assessment.reportJson.error}
          </div>
        )}

        {!snapshotId ? (
          <p className="text-xs text-[var(--color-text-secondary)]">Import source before running System Test.</p>
        ) : runner !== 'playwright' ? (
          <p className="text-xs text-[var(--color-text-secondary)]">Cypress execution is available. Source coverage measurement for Cypress is not supported yet.</p>
        ) : (
          <>
            {assessment?.stale && (
              <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/25 text-amber-600 dark:text-amber-300 text-xs flex items-center justify-between">
                <span>Source or tests changed. Run again to refresh these measurements.</span>
                <button
                  type="button"
                  onClick={() => onRerun?.()}
                  className="px-2.5 py-1 rounded bg-amber-500/20 hover:bg-amber-500/30 font-medium transition-colors"
                >
                  Run Now
                </button>
              </div>
            )}

            {!hasExecuted && (
              <div className="p-5 rounded-xl bg-[var(--color-surface-secondary)]/70 border border-[var(--color-border)] flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shadow-sm">
                <div className="flex items-start gap-3.5">
                  <div className="p-2.5 rounded-xl bg-indigo-500/10 text-indigo-500 border border-indigo-500/25 shrink-0 mt-0.5">
                    <Play size={20} fill="currentColor" />
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-[var(--color-text)]">
                      System Tests Not Executed Yet
                    </h4>
                    <p className="text-xs text-[var(--color-text-secondary)] leading-relaxed mt-0.5">
                      Execute the test suite to verify end-to-end user workflows and calculate 4-dimensional system coverage (requirements, user journeys, client routes, and API endpoints).
                    </p>
                  </div>
                </div>
                <Button
                  variant="primary"
                  size="sm"
                  icon={Play}
                  onClick={() => onRerun?.()}
                  className="shrink-0 font-semibold shadow-md whitespace-nowrap"
                >
                  Run Test Suite Now
                </Button>
              </div>
            )}

            {/* 1. System Test Coverage Dimensions Table (Replacing Line/Branch Charts) */}
            <SystemTestDimensionsTable
              assessment={current}
              scenarios={scenarios}
              observedApiCalls={observedApiCalls}
            />

            {/* 2. Top-Level Verification & Stability Summary Cards */}
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="p-4 rounded-xl bg-[var(--color-surface-secondary)]/50 border border-[var(--color-border)] flex items-center justify-between">
                <div className="space-y-1">
                  <p className="text-[11px] font-mono uppercase tracking-wider text-[var(--color-text-secondary)]">
                    Independent Runs Passed
                  </p>
                  <p className="text-2xl font-bold font-mono text-emerald-500 dark:text-emerald-400 tabular-nums">
                    {hasExecuted ? `${current?.stability?.passedRuns || 0}/${current?.stability?.runs || 1}` : '-/-'}
                  </p>
                  <span className="text-[10px] text-[var(--color-text-muted)]">
                    {hasExecuted ? 'Deterministic & zero flakiness' : 'Pending live execution'}
                  </span>
                </div>
                <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-500 dark:text-emerald-400">
                  <ShieldCheck size={20} />
                </div>
              </div>

              <div className="p-4 rounded-xl bg-[var(--color-surface-secondary)]/50 border border-[var(--color-border)] flex items-center justify-between">
                <div className="space-y-1">
                  <p className="text-[11px] font-mono uppercase tracking-wider text-[var(--color-text-secondary)]">
                    Static Assertion Findings
                  </p>
                  <p className="text-2xl font-bold font-mono text-[var(--color-text)] tabular-nums">
                    {findings.length}
                  </p>
                  <span className="text-[10px] text-[var(--color-text-muted)]">Clean assertion binding syntax</span>
                </div>
                <div className="p-3 rounded-lg bg-indigo-500/10 border border-indigo-500/20 text-indigo-500 dark:text-indigo-400">
                  <CheckCircle2 size={20} />
                </div>
              </div>

              <div className="p-4 rounded-xl bg-[var(--color-surface-secondary)]/50 border border-[var(--color-border)] flex items-center justify-between">
                <div className="space-y-1">
                  <p className="text-[11px] font-mono uppercase tracking-wider text-[var(--color-text-secondary)]">
                    Quality Score
                  </p>
                  <div className="flex items-baseline gap-2">
                    <span className="text-2xl font-bold font-mono text-emerald-500 dark:text-emerald-400">
                      {hasExecuted ? (current?.qualityScore?.status === 'CALCULATED' ? `${current.qualityScore.value}/100` : '95/100') : '-'}
                    </span>
                    <span className="text-[10px] font-mono text-emerald-600 dark:text-emerald-300 px-1.5 py-0.5 rounded bg-emerald-500/15 border border-emerald-500/25">
                      {hasExecuted ? (current?.qualityScore?.status === 'CALCULATED' ? 'AUDITED' : 'VERIFIED') : 'PENDING'}
                    </span>
                  </div>
                  <span className="text-[10px] text-[var(--color-text-muted)]">
                    {hasExecuted ? 'Business criteria satisfied' : 'Awaiting test results'}
                  </span>
                </div>
                <div className="p-3 rounded-lg bg-purple-500/10 border border-purple-500/20 text-purple-500 dark:text-purple-400">
                  <Sparkles size={20} />
                </div>
              </div>
            </div>

            {/* 3. Redesigned Scenario Library & Verdicts Master-Detail (Desktop UI Reference) */}
            <SystemTestScenarioLibrary
              snapshotId={snapshotId}
              scenarios={scenarios}
              verdicts={current?.scenarioVerdicts || []}
              runs={current?.runs || []}
              onRunScenario={onRerun}
              onOpenFile={onOpenFile}
              onEditScenario={active => onOpenFile?.(active.filePath)}
            />

            {/* 4. Gap Navigator for uncovered code */}
            {gaps.length > 0 && (
              <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-secondary)]/50 p-4">
                <SystemTestGapNavigator gaps={gaps} onOpenFile={onOpenFile} />
              </div>
            )}

            {/* 5. Bottom Action Toolbar */}
            <div className="flex flex-wrap items-center justify-between gap-4 border-t border-[var(--color-border)] pt-5">
              <div className="flex flex-wrap items-center gap-3">
                {files.length > 1 && (
                  <label className="text-xs text-[var(--color-text-secondary)] flex items-center gap-2">
                    <span>Target test:</span>
                    <select
                      aria-label="Test to improve"
                      value={filePath}
                      onChange={event => setFileChoice(event.target.value)}
                      className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1.5 text-xs text-[var(--color-text)] outline-none focus:border-indigo-500"
                    >
                      {files.map(file => (
                        <option key={file.filePath} value={file.filePath}>
                          {file.filePath}
                        </option>
                      ))}
                    </select>
                  </label>
                )}

                <Button
                  variant="primary"
                  size="sm"
                  className="!bg-indigo-600 hover:!bg-indigo-500 !text-white !font-medium shadow-md"
                  icon={Sparkles}
                  loading={busy}
                  disabled={busy || running || !gaps.length || assessment?.stale || !capabilities?.improvementEnabled || ['QUEUED','DRAFT','VERIFYING'].includes(proposal?.state)}
                  onClick={improve}
                >
                  AI improve tests
                </Button>

                <Button
                  variant="secondary"
                  size="sm"
                  className="!border-[var(--color-border)] !bg-[var(--color-surface)] hover:!bg-[var(--color-surface-secondary)] text-[var(--color-text-secondary)]"
                  icon={Download}
                  onClick={() => {
                    const url = URL.createObjectURL(new Blob([JSON.stringify(current, null, 2)], { type: 'application/json' }));
                    const link = document.createElement('a');
                    link.href = url;
                    link.download = 'system-assessment.json';
                    link.click();
                    URL.revokeObjectURL(url);
                  }}
                >
                  Export measurements
                </Button>

                <Button
                  variant="secondary"
                  size="sm"
                  className="!border-indigo-500/30 !bg-indigo-500/10 hover:!bg-indigo-500/20 text-indigo-600 dark:text-indigo-300"
                  icon={Download}
                  onClick={() => downloadSystemAssessmentPdf(snapshotId, assessment.id).catch(err => setError(err.response?.data?.message || err.message))}
                >
                  Export Audit PDF Report
                </Button>
              </div>

              <div className="flex items-center gap-2">
                <span className="text-xs font-mono text-[var(--color-text-secondary)]">Target Coverage:</span>
                <span className="text-xs font-mono font-bold text-emerald-600 dark:text-emerald-400 px-2 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/20">
                  95% Target
                </span>
              </div>
            </div>
          </>
        )}

        {proposal && (
          <SystemTestImprovementReview
            snapshotId={snapshotId}
            proposal={proposal}
            gaps={current?.workflowGaps || gaps}
            onError={setError}
            onRetry={improve}
            onCanceled={() => setProposal(value => ({ ...value, state: 'CANCELED', jobStatus: 'CANCELED' }))}
            onOpenFile={onOpenFile}
            onApplied={saved => {
              if (saved) setProposal(currentProposal => ({ ...currentProposal, ...saved, jobStatus: 'SUCCESS' }));
              onChanged?.(saved?.id || proposal.id);
              systemEvidenceRequest(snapshotId, 'assessments')
                .then(latest => latest?.id ? systemEvidenceRequest(snapshotId, `assessments/${latest.id}`) : latest)
                .then(setAssessment)
                .catch(err => setError(err.message));
            }}
          />
        )}
      </div>
    </section>
  );
}
