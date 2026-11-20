import { useProjectAccess } from '../../../hooks/useProjectAccess';
import SystemRequirementReview from './SystemRequirementReview.jsx';
import { useEffect, useState, useId } from 'react';
import {
  Loader2,
  FileCode2,
  Download,
  ChevronDown,
  ChevronUp,
  BarChart3,
  ShieldCheck,
  CheckCircle2,
  Play,
} from 'lucide-react';
import Button from '../../common/Button.jsx';
import { Skeleton } from '../../common/Skeleton.jsx';
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
  projectId,
  selectedAssessment,
  snapshotId,
  runner,
  executionMode,
  refreshKey,
  onChanged,
  onOpenFile,
  onRerun,
}) {
  const access = useProjectAccess(projectId);
  const [expanded, setExpanded] = useState(true);
  const contentId = useId();
  const [capabilities, setCapabilities] = useState(null);
  const [assessment, setAssessment] = useState(null);
  const [proposal, setProposal] = useState(null);
  const [scenarios, setScenarios] = useState([]);
  const [revisions, setRevisions] = useState([]);
  const [fileChoice, setFileChoice] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  // Until the first load finishes we do not know whether a run exists; showing
  // "Not Executed Yet" here would contradict results that are still loading.
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let active = true;
    if (!snapshotId) return;

    Promise.all([
      systemEvidenceRequest(snapshotId, 'capabilities').catch(() => null),
      (selectedAssessment ? Promise.resolve(selectedAssessment) : systemEvidenceRequest(snapshotId, `assessments?runner=${runner}&executionMode=${executionMode}&status=COMPLETED`))
        .then(latest => latest?.id ? systemEvidenceRequest(snapshotId, `assessments/${latest.id}`) : latest)
        .catch(() => null),
      systemEvidenceRequest(snapshotId, 'proposals').catch(() => null),
      systemEvidenceRequest(snapshotId, 'catalog').catch(() => ({scenarios:[]})),
      systemEvidenceRequest(snapshotId, 'requirements').catch(() => []),
    ]).then(([capability, latest, recovered, scns, requirementRevisions]) => {
      if (active) {
        setRevisions(requirementRevisions);
        setCapabilities(capability);
        setAssessment(latest);
        setProposal(recovered);
        setScenarios(scns?.scenarios || (Array.isArray(scns) ? scns : []));
        setError('');
        setLoaded(true);
      }
    }).catch(err => {
      if (active) { setError(err.response?.data?.message || err.message); setLoaded(true); }
    });

    return () => { active = false; };
  }, [snapshotId, refreshKey, selectedAssessment, runner, executionMode]);

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
  const current = report?.runner === runner && report?.executionMode === executionMode ? report : null;
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

  if (!loaded && snapshotId) {
    return (
      <div className="space-y-4" aria-busy="true" aria-label="Loading system test results">
        <Skeleton height={56} rounded="rounded-lg" />
        <div className="grid gap-4 md:grid-cols-2"><Skeleton height={180} rounded="rounded-lg" /><Skeleton height={180} rounded="rounded-lg" /></div>
        <div className="grid gap-4 sm:grid-cols-3"><Skeleton height={96} rounded="rounded-lg" /><Skeleton height={96} rounded="rounded-lg" /><Skeleton height={96} rounded="rounded-lg" /></div>
      </div>
    );
  }

  return (
    <section className="overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)]">
      {/* Panel Main Header */}
      <div className={`px-5 py-3.5 flex flex-wrap items-center justify-between gap-4 bg-[var(--color-surface)] ${expanded ? 'border-b border-[var(--color-border)]' : ''}`}>
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-md bg-[var(--color-surface-secondary)] border border-[var(--color-border)] text-[var(--color-primary)]">
            <BarChart3 size={17} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-semibold text-sm text-[var(--color-text)] tracking-tight">
                System Coverage &amp; Test Quality
              </h3>
              <span className="text-[10.5px] font-mono px-2 py-0.5 rounded-md bg-[var(--color-surface-secondary)] text-[var(--color-text-secondary)] border border-[var(--color-border)]">
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
            <span role="status" className="flex items-center gap-2 text-xs font-mono text-[var(--color-primary)] bg-[var(--color-surface-secondary)] border border-[var(--color-border)] px-2.5 py-1 rounded-md">
              <Loader2 size={13} className="animate-spin" />
              Measuring multi-tier execution...
            </span>
          )}

          <button
            type="button"
            aria-expanded={expanded}
            aria-controls={contentId}
            onClick={() => setExpanded(value => !value)}
            className="flex items-center gap-1.5 rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-2.5 py-1 text-xs font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-secondary)] transition-colors duration-150 focus-visible:outline-2 cursor-pointer"
          >
            {expanded ? 'Collapse' : 'Expand'}
            {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
        </div>
      </div>

      <div id={contentId} hidden={!expanded} className="p-5 space-y-5">
        <SystemRequirementReview canApprove={access.can('evidence.approve')} snapshotId={snapshotId} filePath={filePath} revisions={revisions} onError={setError} onRefresh={async () => {setRevisions(await systemEvidenceRequest(snapshotId,'requirements'));onChanged?.();}} />
        {!!assessment?.reportJson?.input?.excludedTests?.length && (
          <details className="text-xs text-[var(--color-text-secondary)] bg-[var(--color-bg)] p-3 rounded-md border border-[var(--color-border)]">
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
          <div className="p-3 rounded-md bg-rose-500/[0.06] border border-[var(--color-border)] border-l-2 border-l-rose-400/75 text-rose-300/90 text-xs flex items-center justify-between">
            <span>{error}</span>
            <button type="button" onClick={() => setError('')} className="underline text-xs cursor-pointer">Dismiss</button>
          </div>
        )}

        {assessment?.reportJson?.error && (
          <div className="p-3 rounded-md bg-rose-500/[0.06] border border-[var(--color-border)] border-l-2 border-l-rose-400/75 text-rose-300/90 text-xs">
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
              <div className="p-3 rounded-md bg-[var(--color-bg)] border border-[var(--color-border)] border-l-2 border-l-amber-500/70 text-[var(--color-text-secondary)] text-xs flex items-center justify-between">
                <span>Source or tests changed. Run again to refresh these measurements.</span>
                <button
                  type="button"
                  onClick={() => onRerun?.()}
                  className="px-2.5 py-1 rounded-md border border-amber-500/35 bg-amber-500/[0.08] text-amber-400 hover:bg-amber-500/15 font-medium transition-colors cursor-pointer"
                >
                  Run Now
                </button>
              </div>
            )}

            {!hasExecuted && (
              <div className="p-4 rounded-lg bg-[var(--color-bg)] border border-[var(--color-border)] flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div className="flex items-start gap-3">
                  <div className="p-2 rounded-md bg-[var(--color-surface-secondary)] text-[var(--color-primary)] border border-[var(--color-border)] shrink-0 mt-0.5">
                    <Play size={16} fill="currentColor" />
                  </div>
                  <div>
                    <h4 className="text-sm font-semibold text-[var(--color-text)]">
                      System Tests Not Executed Yet
                    </h4>
                    <p className="text-xs text-[var(--color-text-secondary)] leading-relaxed mt-0.5">
                      Execute the test suite to verify end-to-end user workflows and capture scenario outcomes and source coverage where supported.
                    </p>
                  </div>
                </div>
                <Button
                  variant="primary"
                  size="sm"
                  icon={Play}
                  onClick={() => onRerun?.()}
                  className="shrink-0 font-medium whitespace-nowrap"
                >
                  Run Test Suite Now
                </Button>
              </div>
            )}

            {/* 1. System Test Coverage Dimensions Table (Replacing Line/Branch Charts) */}
            <SystemTestDimensionsTable
              assessment={current ? {...current, presentation: assessment?.presentation} : null}
              scenarios={scenarios}
              observedApiCalls={observedApiCalls}
            />

            {/* 2. Unified Verification & Stability Summary Strip */}
            <div className="grid sm:grid-cols-3 gap-px bg-[var(--color-border)] border border-[var(--color-border)] rounded-lg overflow-hidden">
              <div className="px-4 py-3.5 bg-[var(--color-bg)] flex items-center justify-between">
                <div className="space-y-1">
                  <p className="text-xs font-medium text-[var(--color-text-secondary)] flex items-center gap-1.5">
                    <ShieldCheck size={13} className="text-[var(--color-text-muted)]" />
                    Independent Runs Passed
                  </p>
                  <p className="text-xl font-bold font-mono text-[var(--color-text)] tabular-nums">
                    {hasExecuted ? `${current?.stability?.passedRuns || 0}/${current?.stability?.runs || 1}` : '-/-'}
                  </p>
                  <span className="text-[11px] text-[var(--color-text-muted)] block">
                    {hasExecuted ? 'Observed results across independent runs' : 'Pending live execution'}
                  </span>
                </div>
              </div>

              <div className="px-4 py-3.5 bg-[var(--color-bg)] flex items-center justify-between">
                <div className="space-y-1">
                  <p className="text-xs font-medium text-[var(--color-text-secondary)] flex items-center gap-1.5">
                    <CheckCircle2 size={13} className="text-[var(--color-text-muted)]" />
                    Static Assertion Findings
                  </p>
                  <p className="text-xl font-bold font-mono text-[var(--color-text)] tabular-nums">
                    {findings.length}
                  </p>
                  <span className="text-[11px] text-[var(--color-text-muted)] block">Static findings require review</span>
                </div>
              </div>

              <div className="px-4 py-3.5 bg-[var(--color-bg)] flex items-center justify-between">
                <div className="space-y-1">
                  <p className="text-xs font-medium text-[var(--color-text-secondary)] flex items-center gap-1.5">
                    <FileCode2 size={13} className="text-[var(--color-text-muted)]" />
                    Quality Score
                  </p>
                  <div className="flex items-baseline gap-2">
                    <span className="text-xl font-bold font-mono tabular-nums text-[var(--color-text)]">
                      {hasExecuted ? (current?.qualityScore?.status === 'CALCULATED' ? `${current.qualityScore.value}/100` : 'Not calculated') : '-'}
                    </span>
                    <span className="text-[10.5px] font-mono text-[var(--color-text-secondary)] px-1.5 py-0.5 rounded bg-[var(--color-surface-secondary)] border border-[var(--color-border)]">
                      {hasExecuted ? (current?.qualityScore?.status === 'CALCULATED' ? 'CALCULATED' : 'UNAVAILABLE') : 'PENDING'}
                    </span>
                  </div>
                  <span className="text-[11px] text-[var(--color-text-muted)] block">
                    {hasExecuted ? 'Reviewed criteria and captured evidence' : 'Awaiting test results'}
                  </span>
                </div>
              </div>
            </div>

            {/* 3. Redesigned Scenario Library & Verdicts Master-Detail (Desktop UI Reference) */}
            <SystemTestScenarioLibrary
              snapshotId={snapshotId}
              scenarios={scenarios}
              verdicts={current?.scenarioVerdicts || []}
              runs={current?.runs || []}
              presentation={assessment?.presentation}
              onRunScenario={onRerun}
              onOpenFile={onOpenFile}
              onEditScenario={active => onOpenFile?.(active.filePath)}
            />

            {/* 4. Gap Navigator for uncovered code */}
            {gaps.length > 0 && (
              <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] p-4">
                <SystemTestGapNavigator gaps={gaps} onOpenFile={onOpenFile} />
              </div>
            )}

            {/* 5. Bottom Action Toolbar */}
            <div className="flex flex-wrap items-center justify-between gap-4 border-t border-[var(--color-border)] pt-4">
              <div className="flex flex-wrap items-center gap-2.5">
                {files.length > 1 && (
                  <label className="text-xs text-[var(--color-text-secondary)] flex items-center gap-2">
                    <span>Target test:</span>
                    <select
                      aria-label="Test to improve"
                      value={filePath}
                      onChange={event => setFileChoice(event.target.value)}
                      className="rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-2.5 py-1.5 text-xs text-[var(--color-text)] outline-none focus:border-[var(--color-primary)]"
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
                  icon={FileCode2}
                  loading={busy}
                  disabled={busy || running || !gaps.length || assessment?.stale || !capabilities?.improvementEnabled || ['QUEUED','DRAFT','VERIFYING'].includes(proposal?.state)}
                  onClick={improve}
                >
                  AI improve tests
                </Button>

                <Button
                  variant="secondary"
                  size="sm"
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
                  icon={Download}
                  onClick={() => downloadSystemAssessmentPdf(snapshotId, assessment.id).catch(err => setError(err.response?.data?.message || err.message))}
                >
                  Export Audit PDF Report
                </Button>
              </div>

              <div className="flex items-center gap-2">
                <span className="text-xs font-mono text-[var(--color-text-muted)]">Target Coverage:</span>
                <span className="text-xs font-mono font-medium text-[var(--color-text-secondary)] px-2 py-0.5 rounded bg-[var(--color-surface-secondary)] border border-[var(--color-border)]">
                  95% Target
                </span>
              </div>
            </div>
          </>
        )}

        {proposal && (
          <SystemTestImprovementReview
            projectId={projectId}
            snapshotId={snapshotId}
            proposal={proposal}
            gaps={current?.workflowGaps || gaps}
            onProposalChanged={setProposal}
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
