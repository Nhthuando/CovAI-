import { useEffect, useRef, useState } from 'react';
import { systemEvidenceRequest } from '../../../services/systemTest.service.js';
import { useProjectAccess } from '../../../hooks/useProjectAccess';
import { formatReportDate } from './systemReportModel.js';
import SystemTestVersionDiff from './SystemTestVersionDiff.jsx';

export default function SystemTestVersionHistory({ projectId, snapshotId, executionMode, onClose, onChanged, onCheck }) {
  const dialog = useRef(null);
  const access = useProjectAccess(projectId);
  const [history, setHistory] = useState(null), [target, setTarget] = useState(null), [comparison, setComparison] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const requestId = useRef(crypto.randomUUID());
  const refresh = async () => setHistory(await systemEvidenceRequest(snapshotId, 'versions'));
  useEffect(() => {
    const element = dialog.current, previous = document.activeElement;
    element.showModal();
    let current = true;
    systemEvidenceRequest(snapshotId, 'versions').then(data => { if (current) setHistory(data); }).catch(err => { if (current) setError(err.response?.data?.message || err.message); }).finally(()=>{if(current)setLoading(false);});
    return () => { current = false; element.close(); previous?.focus(); };
  }, [snapshotId]);
  const retry = async () => { setLoading(true);setError('');try{await refresh();}catch(err){setError(err.response?.data?.message || err.message);}finally{setLoading(false);} };
  const choose = async row => {
    setBusy(true); setError(''); setTarget(row); setComparison(null); requestId.current = crypto.randomUUID();
    try { setComparison(await systemEvidenceRequest(snapshotId, `versions/compare?from=${encodeURIComponent(history.headId)}&to=${encodeURIComponent(row.id)}`)); }
    catch (err) { setError(err.response?.data?.message || err.message); }
    finally { setBusy(false); }
  };
  const restore = async () => {
    setBusy(true); setError('');
    try {
      await systemEvidenceRequest(snapshotId, `versions/${target.id}/restore`, { method: 'POST', data: { expectedHeadId: history.headId, expectedSuiteHash: history.suiteHash, expectedSourceHash: history.sourceHash, expectedWorkspaceRevision: history.workspaceRevision, requestId: requestId.current } });
      await refresh(); setTarget(null); setComparison(null); onChanged?.();
    } catch (err) { setError(err.response?.data?.message || err.message); }
    finally { setBusy(false); }
  };
  const check = async () => {
    setBusy(true); setError('');
    try {
      const data = await systemEvidenceRequest(snapshotId, `versions/${target.id}/check`, { method: 'POST', data: { expectedSourceHash: history.sourceHash, runner: 'playwright', executionMode, requestId: crypto.randomUUID() } });
      onCheck?.(data); onClose();
    } catch (err) { setError(err.response?.data?.message || err.message); }
    finally { setBusy(false); }
  };
  return <dialog ref={dialog} onCancel={event => { event.preventDefault(); if (!busy) onClose(); }} className="m-auto max-h-[90vh] w-[min(960px,94vw)] overflow-auto rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-0 text-[var(--color-text)] shadow-xl backdrop:bg-black/60">
    <header className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-[var(--color-border)] bg-[var(--color-surface)] p-5"><div><h2 className="text-lg font-semibold">Test version history</h2><p className="mt-1 text-xs text-[var(--color-text-muted)]">Restore System Test files only. Use project snapshots to restore the whole project.</p></div><button type="button" onClick={onClose} disabled={busy} aria-label="Close version history" className="rounded-lg border border-[var(--color-border)] px-3 py-1">Close</button></header>
    <div className="space-y-4 p-5">{error && <p role="alert" className="text-sm text-rose-600">{error}</p>}{!history ? (loading ? <p role="status" className="text-sm">Loading versions...</p> : <button type="button" onClick={retry} className="rounded-lg border border-[var(--color-border)] px-4 py-2 text-sm">Retry</button>) : <>
      {history.workingChanges && <div className="space-y-2 rounded-lg bg-amber-500/10 p-3 text-sm"><p>Test files have unrecorded edits. Inspect your changes before recording a version or restoring tests.</p><button type="button" disabled={busy || !access.can('evidence.approve')} className="text-xs underline disabled:opacity-40" onClick={async () => {setBusy(true);setError('');try {await systemEvidenceRequest(snapshotId,'versions',{method:'POST',data:{expectedHeadId:history.headId,expectedSuiteHash:history.suiteHash,expectedSourceHash:history.sourceHash,expectedWorkspaceRevision:history.workspaceRevision,requestId:crypto.randomUUID()}});await refresh();onChanged?.();} catch(err) {setError(err.response?.data?.message || err.message);} finally {setBusy(false);} }}>Record reviewed test changes</button></div>}

      {!history.initialized ? <p className="py-5 text-sm text-[var(--color-text-muted)]">No test versions yet. The first Apply records a baseline and the applied tests.</p> : <div className="grid gap-5 md:grid-cols-[240px_1fr]"><div className="space-y-2">{history.items.map(row => <button type="button" key={row.id} disabled={busy} onClick={() => choose(row)} className={`block w-full rounded-lg border p-3 text-left text-xs ${target?.id === row.id ? 'border-[var(--color-primary)]' : 'border-[var(--color-border)]'}`}><strong>Version {row.sequence} · {row.action}</strong>{row.id === history.headId && <span className="ml-2">Current</span>}<p className="mt-1 text-[var(--color-text-muted)]">{formatReportDate(row.createdAt)}</p><p className="mt-1">{row.fileCount} files · {row.scenarioCount} scenarios</p><p className="mt-1 break-all text-[var(--color-text-muted)]">Actor: {row.actorId || 'Not recorded'}</p><p className="mt-1 text-[var(--color-text-muted)]">{row.action === 'RESTORE' ? 'Recheck required' : row.provenanceJson?.runtimeVerification === 'PASSED_TWO_RUNS' ? 'Two execution runs passed at Apply' : 'Runtime verification not recorded'}</p></button>)}{history.nextCursor && <button type="button" disabled={busy} className="p-2 text-xs underline" onClick={async () => {setBusy(true);try{const next=await systemEvidenceRequest(snapshotId,`versions?cursor=${encodeURIComponent(history.nextCursor)}`);setHistory(current=>({...current,items:[...current.items,...next.items],nextCursor:next.nextCursor}));}catch(err){setError(err.response?.data?.message || err.message);}finally{setBusy(false);}}}>Load older versions</button>}</div><div className="space-y-4">{target ? <><h3 className="text-sm font-semibold">Current tests → version {target.sequence}</h3><SystemTestVersionDiff comparison={comparison} /><p className="text-xs text-[var(--color-text-muted)]">Check version runs these tests on the current source in an isolated copy. Shared setup and application source are not restored.</p><div className="flex flex-wrap gap-3"><button type="button" className="rounded-lg border border-[var(--color-border)] px-4 py-2 text-sm disabled:opacity-40" disabled={busy || !access.can('tests.run')} onClick={check}>Check version</button><button type="button" className="rounded-lg bg-[var(--color-primary)] px-4 py-2 text-sm text-white disabled:opacity-40" disabled={busy || !comparison || !comparison.canCompareMeasurements || history.workingChanges || target.id === history.headId || !access.can('evidence.approve')} onClick={restore}>Restore tests</button></div>{comparison && !comparison.canCompareMeasurements && <p className="text-xs text-amber-600">Application source or shared setup differs. Restore the corresponding project snapshot first.</p>}</> : <p className="text-sm text-[var(--color-text-muted)]">Choose a version to inspect the exact file changes.</p>}</div></div>}
    </>}</div>
  </dialog>;
}
