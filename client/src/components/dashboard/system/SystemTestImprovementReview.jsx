import SystemImprovementGoal from './SystemImprovementGoal.jsx';
import { quotaMessage } from '../../../services/aiModel.service.js';
import { useEffect, useRef, useState } from 'react';
import { Loader2, CheckCircle2, AlertCircle, RotateCcw, ArrowUpRight } from 'lucide-react';
import Button from '../../common/Button.jsx';
import { systemEvidenceRequest } from '../../../services/systemTest.service.js';
import SystemTestCoverageComparison from './SystemTestCoverageComparison.jsx';
import SystemImprovementProgress, { SystemImprovementUsage } from './SystemImprovementProgress.jsx';
import { cancelJobApi } from '../../../services/job.service.js';

export default function SystemTestImprovementReview({ snapshotId, proposal, gaps = [], onApplied, onError, onRetry, onOpenFile, onCanceled }) {
  const handled = useRef(null), [busy, setBusy] = useState(false);
  const loadedProposalRef = useRef(null);
  const [reviewData, setReviewData] = useState(null);
  const [reviewDrafts, setReviewDrafts] = useState([]);
  const [reviewed, setReviewed] = useState(Boolean(proposal.verificationJson?.review));
  const verified = proposal.state === 'VERIFIED_IMPROVEMENT';
  const pending = ['DRAFT', 'QUEUED', 'VERIFYING'].includes(proposal.state) || verified && proposal.verificationJson?.autoApply || proposal.state === 'APPLIED' && ['QUEUED','RUNNING'].includes(proposal.jobStatus);
  const ready = verified && !proposal.verificationJson?.autoApply;
  const progress = Math.max(0, Math.min(100, Number(proposal.jobProgress) || 0));
  const failure = proposal.failureSummary;
  const goal = proposal.verificationJson?.goal;
  const error = proposal.verificationJson?.error;
  const environmentRequired = error?.code === 'SYSTEM_TEST_ENVIRONMENT_REQUIRED';
  const setupFailed = /^SYSTEM_RUNTIME_|^AUT_|^PROJECT_/.test(error?.code || '');
  const timedOut = proposal.verificationJson?.error?.code === 'SYSTEM_OPERATION_TIMEOUT';
  const cancel = async () => {
    setBusy(true);
    try { await cancelJobApi(proposal.jobId); onCanceled?.(); }
    catch (error) { onError(error.message); }
    finally { setBusy(false); }
  };
  useEffect(() => {
    if (!verified || !snapshotId) return;
    let active = true;
    Promise.all([systemEvidenceRequest(snapshotId, `proposals/${proposal.id}/analyze`), systemEvidenceRequest(snapshotId, 'requirements')]).then(([analysis, revisions]) => {
      if (!active) return;
      const revision = revisions.find(item => item.id === proposal.assessment?.requirementRevisionId) || revisions.find(item => item.status === 'CONFIRMED');
      setReviewData({ analysis, revision });
      setReviewDrafts(current => loadedProposalRef.current === proposal.id && current.length ? current : proposal.verificationJson?.review?.scenarios?.map(item => ({ ...item, flow: item.flow.join('\n'), inputs: item.inputs.join('\n'), expected: item.expected.join('\n') })) || analysis.addedScenarios.map(item => ({ title: item.title, flow: '', inputs: '', expected: '', criterionIds: [], assertionIds: [] })));
      loadedProposalRef.current = proposal.id;
      setReviewed(Boolean(proposal.verificationJson?.review));
    }).catch(error => { if (active) onError(error.response?.data?.message || error.message); });
    return () => { active = false; };
  }, [verified, snapshotId, proposal.id, proposal.assessment?.requirementRevisionId, proposal.verificationJson?.review, onError]);
  const updateDraft = (index, change) => setReviewDrafts(current => current.map((item, i) => i === index ? { ...item, ...change } : item));
  const approveReview = async () => {
    setBusy(true);
    try {
      const scenarios = reviewDrafts.map(item => ({ ...item, flow: item.flow.split('\n').map(value => value.trim()).filter(Boolean), inputs: item.inputs.split('\n').map(value => value.trim()).filter(Boolean), expected: item.expected.split('\n').map(value => value.trim()).filter(Boolean) }));
      await systemEvidenceRequest(snapshotId, `proposals/${proposal.id}/review`, { method: 'POST', data: { expectedCandidateTestHash: proposal.candidateTestHash, expectedRequirementHash: reviewData.revision.contentHash, scenarios } });
      setReviewed(true);
    } catch (error) { onError(error.response?.data?.message || error.message); }
    finally { setBusy(false); }
  };
  useEffect(() => {
    if (proposal.state === 'APPLIED' && ['SUCCESS','FAILED'].includes(proposal.jobStatus) && handled.current !== proposal.id) {
      handled.current = proposal.id; onApplied(proposal);
    }
  }, [proposal, onApplied]);
  const save = async () => {
    setBusy(true);
    try {
      const saved = await systemEvidenceRequest(snapshotId, `proposals/${proposal.id}/apply`, {method:'POST',data:{expectedCurrentTestHash:proposal.baseTestHash,expectedCandidateTestHash:proposal.candidateTestHash}});
      handled.current = proposal.id;
      onApplied(saved);
    }
    catch(error) { onError(error.response?.data?.message || error.message); }
    finally { setBusy(false); }
  };
  const message = pending ? 'You can leave this page and return later.'
    : environmentRequired ? error.message
    : setupFailed ? 'The test environment could not start. Your tests are unchanged.'
    : proposal.state === 'PROVIDER_UNAVAILABLE' ? (proposal.verificationJson?.error?.code === 'AI_QUOTA_EXCEEDED' ? quotaMessage(proposal.verificationJson.error) : proposal.verificationJson?.error?.message) || 'AI is temporarily unavailable. No changes were saved. Please try again later.'
    : proposal.state === 'STALE' ? 'Source or tests changed. Run System Test again before asking AI to improve them.'
    : proposal.state === 'FAILED_VERIFICATION' ? timedOut ? 'The improvement reached its 20-minute time limit. Your tests are unchanged.' : 'New tests did not pass verification. Your tests are unchanged.'
    : proposal.state === 'APPLIED' ? goal?.reached ? 'Verified tests saved. Coverage reached the 95% target.' : 'Verified tests saved. Coverage increased.'
    : proposal.state === 'CANCELED' ? 'The improvement was canceled. No further AI requests will be sent.'
    : proposal.state === 'NO_MEASURED_IMPROVEMENT' ? goal?.reached ? 'Existing tests already meet the 95% coverage target. No changes were needed.' : 'No new verified coverage gain was established. Your test file was kept unchanged.'
    : ready ? 'The updated tests passed verification and increased measured source coverage.' : 'The update could not be completed. Check the job log for details.';
  return <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-secondary)] p-4 sm:p-5 space-y-4">
    <div className="flex items-start gap-3">
      {pending ? <Loader2 size={18} className="shrink-0 animate-spin text-[var(--color-primary)]" /> : ready || proposal.state === 'APPLIED' ? <CheckCircle2 size={18} className="shrink-0 text-[var(--color-success)]" /> : <AlertCircle size={18} className="shrink-0 text-[var(--color-warning)]" />}
      <div className="min-w-0"><p role="status" className="font-semibold text-sm">{pending ? 'Improving tests' : ready || proposal.state === 'APPLIED' ? 'Coverage improved' : proposal.state === 'CANCELED' ? 'Improvement canceled' : environmentRequired ? 'Test configuration required' : setupFailed ? 'Test setup failed' : timedOut ? 'Time limit reached' : 'Tests were not updated'}</p><p className="mt-1.5 break-words text-xs leading-relaxed text-[var(--color-text-secondary)]">{message}</p></div>
    </div>
    {pending && <div className="space-y-2">
      <div className="flex items-center justify-between gap-3 text-xs"><span className="text-[var(--color-text-secondary)]">{proposal.jobStage || (proposal.state === 'VERIFYING' ? 'Verifying test runs' : 'Preparing AI improvement')}</span><span className="shrink-0 font-mono tabular-nums text-[var(--color-primary)]">{progress}%</span></div>
      <div role="progressbar" aria-label="AI test improvement stage progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress} aria-valuetext={`${progress}%: ${proposal.jobStage || 'Preparing improvement'}`} className="h-2 overflow-hidden rounded-full bg-[var(--color-border)]"><div className="h-full rounded-full bg-[var(--color-primary)] transition-[width] duration-300" style={{width:`${progress}%`}} /></div>
    </div>}
    {(pending || proposal.verificationJson?.aiUsage) && <SystemImprovementProgress proposal={proposal} pending={pending} />}
    {!pending && (ready || proposal.state === 'APPLIED') && proposal.verificationJson?.coverageChanges && <SystemTestCoverageComparison changes={proposal.verificationJson.coverageChanges} />}
    {ready && <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-4 space-y-3 text-xs"><h4 className="font-semibold">Review each new scenario before applying</h4>{!!proposal.verificationJson?.requestedGapIds?.length && <div><p className="font-medium">Requested gaps</p><ul className="mt-1 list-disc pl-5">{proposal.verificationJson.requestedGapIds.map(id => <li key={id}>{gaps.find(gap => gap.id === id)?.description || id}</li>)}</ul></div>}<details><summary className="cursor-pointer">Candidate test code · {proposal.filePath}</summary><pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded bg-[var(--color-surface-secondary)] p-3">{proposal.proposedContent}</pre></details>{reviewData?.analysis.addedScenarios.map((scenario, index) => <div key={scenario.title} className="rounded-md border border-[var(--color-border)] p-3 space-y-2"><p className="font-semibold">{scenario.title}</p>{[['flow', 'Flow · one step per line'], ['inputs', 'Input · one per line'], ['expected', 'Expected · include linked confirmed outcome exactly']].map(([key, label]) => <label key={key} className="block">{label}<textarea className="mt-1 w-full rounded border border-[var(--color-border)] bg-[var(--color-surface-secondary)] p-2" value={reviewDrafts[index]?.[key] || ''} onChange={event => updateDraft(index, { [key]: event.target.value })} disabled={reviewed} /></label>)}<fieldset><legend>Confirmed criteria</legend>{(reviewData.revision?.contentJson?.criteria || []).map(criterion => <label key={criterion.id} className="mr-3 inline-flex items-center gap-1"><input type="radio" name={`proposal-criterion-${index}`} checked={reviewDrafts[index]?.criterionIds.includes(criterion.id) || false} disabled={reviewed} onChange={() => updateDraft(index, { criterionIds: [criterion.id] })} />{criterion.id}: {criterion.expectedOutcome}</label>)}</fieldset><label className="block">Reviewed outcome assertion<select className="mt-1 w-full rounded border border-[var(--color-border)] bg-[var(--color-surface-secondary)] p-2" value={reviewDrafts[index]?.assertionIds[0] || ''} disabled={reviewed} onChange={event => updateDraft(index, { assertionIds: event.target.value ? [event.target.value] : [] })}><option value="">Select assertion</option>{scenario.assertionSites.map(site => <option key={site.id} value={site.id}>{site.line}: {site.code.slice(0, 120)}</option>)}</select></label></div>)}<button type="button" className="rounded-md border px-3 py-2" disabled={busy || reviewed || !reviewData?.revision} onClick={approveReview}>{reviewed ? 'Reviewed' : 'Approve Input / Expected and candidate code'}</button></div>}
    <details className="border-t border-[var(--color-border)] pt-3 text-xs">
      <summary className="w-fit cursor-pointer rounded-sm text-[var(--color-text-secondary)] focus-visible:outline-2 focus-visible:outline-[var(--color-focus)]">Details</summary>
      <div className="mt-4 space-y-4">
        {!setupFailed && !environmentRequired && <SystemImprovementGoal goal={goal} pending={pending} />}
        <SystemImprovementUsage usage={proposal.verificationJson?.aiUsage} />
        {error?.message && !environmentRequired && <p className="break-words leading-relaxed text-[var(--color-text-muted)]">{error.message}</p>}
        {error?.details && <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded bg-[var(--color-surface)] p-3 text-[11px]">{JSON.stringify(error.details,null,2)}</pre>}
        {proposal.verificationJson?.attempts?.length > 0 && <p className="text-[var(--color-text-muted)]">Rounds: {proposal.verificationJson.attempts.length}/{goal?.maxRounds || 3} · New tests: {proposal.verificationJson.quality?.addedScenarios?.length ?? 0}</p>}
    {proposal.state === 'FAILED_VERIFICATION' && failure && <div className="space-y-3 text-xs">
      <p className="text-[var(--color-text-secondary)]">Existing suite: {failure.baselinePassedRuns ?? '—'}/{failure.baselineRuns ?? '—'} runs passed · AI changes: {failure.candidatePassedRuns}/{failure.candidateRuns} runs passed</p>
      {failure.failures?.map((item,index)=><div key={`${item.title}:${index}`} className="space-y-1"><p className="font-medium">{item.title}</p><p className="break-words leading-relaxed text-[var(--color-text-muted)]">{item.message}</p></div>)}
    </div>}
      </div>
    </details>
    <div className="flex flex-wrap gap-2">
      {pending && !['APPLIED','VERIFIED_IMPROVEMENT'].includes(proposal.state) && proposal.jobId && <Button variant="secondary" size="sm" loading={busy} disabled={busy} onClick={cancel}>Cancel improvement</Button>}
      {ready && <Button size="sm" loading={busy} disabled={!reviewed} onClick={save}>Apply reviewed tests</Button>}
      {['PROVIDER_UNAVAILABLE','FAILED_VERIFICATION','NO_MEASURED_IMPROVEMENT','CANCELED'].includes(proposal.state) && <Button variant="secondary" size="sm" icon={RotateCcw} onClick={onRetry}>Try again</Button>}
      {proposal.proposedContent && onOpenFile && proposal.state === 'APPLIED' && <Button variant="secondary" size="sm" icon={ArrowUpRight} onClick={()=>onOpenFile(proposal.filePath,1)}>Open updated test</Button>}
    </div>
  </div>;
}
