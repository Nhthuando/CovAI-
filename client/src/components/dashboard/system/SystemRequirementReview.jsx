import { useState } from 'react';
import { systemEvidenceRequest } from '../../../services/systemTest.service.js';

const sha = async value => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value))))].map(byte => byte.toString(16).padStart(2, '0')).join('');
export default function SystemRequirementReview({ snapshotId, filePath, revisions, onRefresh, onError }) {
  const [text, setText] = useState(''), [analysis, setAnalysis] = useState(null), [criterion, setCriterion] = useState(''), [busy, setBusy] = useState(false);
  const confirmed = revisions.find(revision => revision.status === 'CONFIRMED');
  const act = async callback => { setBusy(true); try { await callback(); await onRefresh(); } catch (error) { onError(error.response?.data?.message || error.message); } finally { setBusy(false); } };
  return <details className="border-t border-[var(--color-border)] pt-3">
    <summary className="cursor-pointer font-semibold">Requirements and assertion review</summary>
    <p className="my-2 text-[var(--color-text-muted)]">Confirm expected outcomes from your requirements. Source-derived or AI suggestions do not count as confirmed requirements.</p>
    <label className="block">Requirement JSON (criteria: id, description, expectedOutcome, references)
      <textarea value={text} onChange={event => setText(event.target.value)} rows={4} className="w-full p-2 bg-[var(--color-surface-secondary)] border border-[var(--color-border)] font-mono" />
    </label>
    <button disabled={busy || !text.trim()} onClick={() => act(() => systemEvidenceRequest(snapshotId, 'requirements', { method: 'POST', data: JSON.parse(text) }))} className="underline my-2 disabled:opacity-40">Create draft revision</button>
    {revisions.map(revision => <div key={revision.id} className="py-2 border-b border-[var(--color-border)]">
      <p>Revision {revision.revisionNumber} · {revision.status} · {revision.contentJson.criteria.length} criteria</p>
      <ul>{revision.contentJson.criteria.map(item => <li key={item.id}><strong>{item.id}</strong>: {item.description}<p>Expected: {item.expectedOutcome}</p><p className="text-[var(--color-text-muted)]">References: {item.references.join(', ')}</p></li>)}</ul>
      {revision.status === 'DRAFT' && <button disabled={busy} className="underline mt-2" onClick={() => act(() => systemEvidenceRequest(snapshotId, `requirements/${revision.id}/confirm`, { method: 'POST', data: { expectedContentHash: revision.contentHash } }))}>I reviewed and confirm these expected outcomes</button>}
    </div>)}
    {confirmed && <div className="space-y-2 mt-3">
      <label>Criterion <select value={criterion} onChange={event => setCriterion(event.target.value)} className="ml-2 bg-[var(--color-surface-secondary)] p-1"><option value="">Choose criterion</option>{confirmed.contentJson.criteria.map(item => <option key={item.id} value={item.id}>{item.id}</option>)}</select></label>
      <button disabled={busy || !filePath} className="underline block" onClick={() => act(async () => setAnalysis(await systemEvidenceRequest(snapshotId, `tests/analyze?filePath=${encodeURIComponent(filePath)}`)))}>Inspect assertions in selected file</button>
      {analysis?.assertionSites.map(site => <div key={site.id} className="p-2 bg-[var(--color-surface-secondary)]"><pre className="whitespace-pre-wrap break-all">{analysis.filePath}:{site.line}{'\n'}{site.code}</pre>
        {site.supported ? <button disabled={busy || !criterion} className="underline" onClick={() => act(() => systemEvidenceRequest(snapshotId, `requirements/${confirmed.id}/bindings`, { method: 'POST', data: { criterionId: criterion, testFile: analysis.filePath, assertionId: site.id, expectedOutcome: confirmed.contentJson.criteria.find(item => item.id === criterion).expectedOutcome } }))}>Create binding for review</button> : <p>Execution evidence for this assertion structure is unsupported.</p>}
      </div>)}
      {confirmed.bindings?.map(binding => <div key={binding.id} className="p-2 border border-[var(--color-border)]"><p>{binding.criterionId} · {binding.status}</p><pre className="whitespace-pre-wrap break-all">{binding.bindingJson.assertionCode}</pre><p>Expected: {binding.bindingJson.expectedOutcome}</p>
        {binding.status === 'DRAFT' && <button disabled={busy} className="underline" onClick={() => act(async () => systemEvidenceRequest(snapshotId, `bindings/${binding.id}/approve`, { method: 'POST', data: { expectedTestHash: binding.testHash, expectedBindingHash: await sha(binding.bindingJson) } }))}>I reviewed that this assertion checks the criterion</button>}
      </div>)}
    </div>}
  </details>;
}
