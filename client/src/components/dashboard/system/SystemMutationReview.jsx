import { useEffect, useState } from 'react';
import { systemEvidenceRequest } from '../../../services/systemTest.service.js';

export default function SystemMutationReview({ snapshotId, assessment, revisions, enabled, onError }) {
  const [selected, setSelected] = useState({}), [run, setRun] = useState(null), [busy, setBusy] = useState(false);
  const report = assessment.reportJson;
  const bindings = revisions.find(revision => revision.id === report.requirementRevisionId)?.bindings?.filter(binding => binding.status === 'APPROVED') || [];
  useEffect(() => {
    if (!run?.id) return;
    let active = true;
    const poll = async () => { try { const result = await systemEvidenceRequest(snapshotId, `mutations/${run.id}`); if (active) setRun(result); } catch (error) { if (active) onError(error.message); } };
    const timer = ['QUEUED','RUNNING'].includes(run.state) ? setInterval(poll, 4000) : null; return () => { active = false; if(timer) clearInterval(timer); };
  }, [snapshotId, run?.id, run?.state, onError]);
  const start = async () => {
    setBusy(true);
    try { const result = await systemEvidenceRequest(snapshotId, `assessments/${assessment.id}/mutations`, { method: 'POST', data: { targetIds: Object.keys(selected), targetBindings: Object.fromEntries(Object.entries(selected).map(([id, binding]) => [id, [binding]])) } }); setRun({ id: result.mutationRunId, state: 'QUEUED' }); }
    catch (error) { onError(error.response?.data?.message || error.message); } finally { setBusy(false); }
  };
  return <details className="border-t border-[var(--color-border)] pt-3">
    <summary className="font-semibold cursor-pointer">Controlled fault detection</summary>
    <p className="my-2">Review a relevant approved assertion for each source fault. Startup failures, timeouts and unrelated assertion failures do not count as detected faults.</p>
    {!enabled ? <p>Mutation is disabled until a trusted execution environment is configured. Fault detection has not been measured.</p> : <>
      <div className="max-h-64 overflow-auto space-y-2">{report.mutationTargets.map(target => <label key={target.id} className="block p-2 border-b border-[var(--color-border)]"><code>{target.filePath}:{target.line} · {target.original} → {target.replacement}</code>
        <select aria-label={`Relevant assertion for ${target.filePath} line ${target.line} ${target.operator}`} value={selected[target.id] || ''} className="block w-full p-1 bg-[var(--color-surface-secondary)]" onChange={event => setSelected(current => { const next = { ...current }; if (event.target.value) next[target.id] = event.target.value; else delete next[target.id]; return next; })}>
          <option value="">Do not test this fault</option>{bindings.map(binding => <option key={binding.id} value={binding.id}>{binding.criterionId} · {binding.bindingJson.assertionCode}</option>)}
        </select>
      </label>)}</div>
      <button disabled={busy || assessment.stale || !Object.keys(selected).length || Object.keys(selected).length > 10 || ['QUEUED', 'RUNNING'].includes(run?.state)} className="underline my-2 disabled:opacity-40" onClick={start}>Run selected faults after three clean baseline runs</button>
      {run && <p>Fault run: {run.state}</p>}
      {run?.resultJson?.results && <><p>Detected: {run.resultJson.killed}/{run.resultJson.evaluated} evaluated · Requested: {run.resultJson.requested}</p><ul>{run.resultJson.results.map(result => <li key={result.id}>{result.filePath}:{result.line} · {result.status} · {result.reasonCodes.join(', ')}</li>)}</ul></>}
    </>}
  </details>;
}
