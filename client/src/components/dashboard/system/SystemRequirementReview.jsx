import SystemScenarioReviewForm from './SystemScenarioReviewForm.jsx';
import { useState } from 'react';
import { systemEvidenceRequest } from '../../../services/systemTest.service.js';

const sha = async value => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value))))].map(byte => byte.toString(16).padStart(2, '0')).join('');
export default function SystemRequirementReview({ canApprove = false, snapshotId, filePath, revisions, onRefresh, onError }) {
  const [text, setText] = useState(''), [analysis, setAnalysis] = useState(null), [criterion, setCriterion] = useState(''), [busy, setBusy] = useState(false);
  const [brief, setBrief] = useState({ purpose: '', actors: '', flows: '', preconditions: '', dataConstraints: '' });
  const [criteria, setCriteria] = useState([{ id: '', description: '', expectedOutcome: '', references: '' }]);
  const split = value => value.split('\n').map(item => item.trim()).filter(Boolean);
  const draftContent = () => text.trim() ? JSON.parse(text) : { brief: { purpose: brief.purpose, actors: split(brief.actors), flows: split(brief.flows), preconditions: split(brief.preconditions), dataConstraints: split(brief.dataConstraints) }, criteria: criteria.map(item => ({ ...item, references: split(item.references) })) };
  const confirmed = revisions.find(revision => revision.status === 'CONFIRMED');
  const act = async callback => { setBusy(true); try { await callback(); await onRefresh(); } catch (error) { onError(error.response?.data?.message || error.message); } finally { setBusy(false); } };
  return <details className="border-t border-[var(--color-border)] pt-3">
    <summary className="cursor-pointer font-semibold">Requirements and assertion review</summary>
    {!canApprove && <p className="mt-2 text-xs text-[var(--color-text-muted)]">You need evidence approval permission to change requirement reviews.</p>}
    <fieldset disabled={!canApprove || busy}>
    <p className="my-2 text-[var(--color-text-muted)]">Confirm expected outcomes from your requirements. Source-derived or AI suggestions do not count as confirmed requirements.</p>
    <div className="my-3 grid gap-3 sm:grid-cols-2">{[['purpose','Purpose'],['actors','Actors'],['flows','Main flows'],['preconditions','Preconditions'],['dataConstraints','Test data constraints']].map(([key,label]) => <label key={key} className="block text-xs">{label}<textarea value={brief[key]} onChange={event => setBrief(current => ({...current,[key]:event.target.value}))} rows={2} className="mt-1 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-2" /></label>)}</div>
    <div className="space-y-3">{criteria.map((item,index) => <fieldset key={index} className="grid gap-2 rounded-lg border border-[var(--color-border)] p-3 sm:grid-cols-2"><legend className="px-1 text-xs">Criterion {index+1}</legend>{[['id','Criterion ID'],['description','Description'],['expectedOutcome','Expected outcome'],['references','References (one per line)']].map(([key,label]) => <label key={key} className="text-xs">{label}<textarea value={item[key]} onChange={event => setCriteria(rows => rows.map((row,i) => i===index?{...row,[key]:event.target.value}:row))} rows={2} className="mt-1 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-2" /></label>)}{criteria.length>1 && <button type="button" onClick={() => setCriteria(rows => rows.filter((_,i)=>i!==index))} className="text-left text-xs underline">Remove criterion</button>}</fieldset>)}</div>
    <div className="my-3 flex flex-wrap gap-4"><button type="button" disabled={busy || criteria.length>=100} onClick={() => setCriteria(rows => [...rows,{id:'',description:'',expectedOutcome:'',references:''}])} className="text-xs underline">Add criterion</button><button type="button" disabled={busy} onClick={() => act(() => systemEvidenceRequest(snapshotId,'requirements',{method:'POST',data:draftContent()}))} className="text-xs underline">Save draft requirements</button></div>
    <details className="my-3"><summary className="cursor-pointer text-xs">Advanced JSON import</summary><textarea aria-label="Requirement JSON" value={text} onChange={event=>setText(event.target.value)} rows={4} className="mt-2 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-2 font-mono text-xs" /></details>
    {revisions.map(revision => <div key={revision.id} className="py-2 border-b border-[var(--color-border)]">
      <p>Revision {revision.revisionNumber} · {revision.status} · {revision.contentJson.criteria.length} criteria</p>
      <ul>{revision.contentJson.criteria.map(item => <li key={item.id}><strong>{item.id}</strong>: {item.description}<p>Expected: {item.expectedOutcome}</p><p className="text-[var(--color-text-muted)]">References: {item.references.join(', ')}</p></li>)}</ul>
      {revision.status === 'DRAFT' && <button disabled={busy} className="underline mt-2" onClick={() => act(() => systemEvidenceRequest(snapshotId, `requirements/${revision.id}/confirm`, { method: 'POST', data: { expectedContentHash: revision.contentHash } }))}>I reviewed and confirm these expected outcomes</button>}
    </div>)}
    <SystemScenarioReviewForm snapshotId={snapshotId} filePath={filePath} revision={confirmed} onRefresh={onRefresh} onError={onError} />
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
    </fieldset>
  </details>;
}
