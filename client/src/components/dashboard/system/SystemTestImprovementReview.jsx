import { useEffect, useRef, useState } from 'react';
import { Loader2, CheckCircle2, AlertCircle, RotateCcw, ArrowUpRight } from 'lucide-react';
import Button from '../../common/Button.jsx';
import { systemEvidenceRequest } from '../../../services/systemTest.service.js';

export default function SystemTestImprovementReview({ snapshotId, proposal, onApplied, onError, onRetry, onOpenFile }) {
  const handled = useRef(null), [busy, setBusy] = useState(false);
  const verified = ['VERIFIED_IMPROVEMENT', 'NO_MEASURED_IMPROVEMENT'].includes(proposal.state);
  const pending = ['DRAFT', 'QUEUED', 'VERIFYING'].includes(proposal.state) || verified && proposal.verificationJson?.autoApply;
  const ready = verified && !proposal.verificationJson?.autoApply;
  useEffect(() => {
    if (proposal.state === 'APPLIED' && ['SUCCESS','FAILED'].includes(proposal.jobStatus) && handled.current !== proposal.id) {
      handled.current = proposal.id; onApplied();
    }
  }, [proposal.state, proposal.id, proposal.jobStatus, onApplied]);
  const save = async () => {
    setBusy(true);
    try { await systemEvidenceRequest(snapshotId, `proposals/${proposal.id}/apply`, {method:'POST',data:{expectedCurrentTestHash:proposal.baseTestHash,expectedCandidateTestHash:proposal.candidateTestHash}}); onApplied(); }
    catch(error) { onError(error.response?.data?.message || error.message); }
    finally { setBusy(false); }
  };
  const message = pending ? verified ? 'Saving the verified tests...' : proposal.state === 'VERIFYING' ? 'Checking the updated tests against two independent runs. This can take a few minutes.' : 'AI is creating additional tests. Your existing tests are kept.'
    : proposal.state === 'PROVIDER_UNAVAILABLE' ? 'AI is temporarily unavailable. No changes were saved. Please try again later.'
    : proposal.state === 'STALE' ? 'Source or tests changed. Run System Test again before asking AI to improve them.'
    : proposal.state === 'FAILED_VERIFICATION' ? 'The AI changes did not pass verification. Your test file was kept unchanged.'
    : proposal.state === 'APPLIED' ? 'Tests updated successfully. Starting a new run to refresh coverage...'
    : proposal.state === 'NO_MEASURED_IMPROVEMENT' ? 'The updated tests passed, but no coverage increase was measured.'
    : ready ? 'The updated tests passed verification and increased measured source coverage.' : 'The update could not be completed. Check the job log for details.';
  return <div role="status" className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-secondary)] p-4 space-y-3">
    <div className="flex items-start gap-3">
      {pending ? <Loader2 size={18} className="shrink-0 animate-spin text-[var(--color-primary)]" /> : ready || proposal.state === 'APPLIED' ? <CheckCircle2 size={18} className="shrink-0 text-[var(--color-success)]" /> : <AlertCircle size={18} className="shrink-0 text-[var(--color-warning)]" />}
      <div><p className="font-semibold text-sm">{pending ? 'Improving tests' : ready || proposal.state === 'APPLIED' ? 'Tests checked' : 'Tests were not updated'}</p><p className="mt-1 text-xs leading-relaxed text-[var(--color-text-secondary)]">{message}</p></div>
    </div>
    <div className="flex flex-wrap gap-2">
      {ready && <Button size="sm" loading={busy} onClick={save}>Save and run tests</Button>}
      {['PROVIDER_UNAVAILABLE','FAILED_VERIFICATION'].includes(proposal.state) && <Button variant="secondary" size="sm" icon={RotateCcw} onClick={onRetry}>Try again</Button>}
      {proposal.proposedContent && onOpenFile && proposal.state === 'APPLIED' && <Button variant="secondary" size="sm" icon={ArrowUpRight} onClick={()=>onOpenFile(proposal.filePath,1)}>Open updated test</Button>}
    </div>
  </div>;
}
