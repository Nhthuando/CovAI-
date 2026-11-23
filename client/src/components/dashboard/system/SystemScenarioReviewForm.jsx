import { useEffect, useState } from 'react';
import { systemEvidenceRequest } from '../../../services/systemTest.service.js';
const sha = async value => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value))))].map(byte => byte.toString(16).padStart(2, '0')).join('');
const lines = value => value.split('\n').map(item => item.trim()).filter(Boolean);
export default function SystemScenarioReviewForm({ snapshotId, revision, filePath, onRefresh, onError }) {
  const [data, setData] = useState(null), [selected, setSelected] = useState(''), [assertionId, setAssertionId] = useState(''), [criterionId, setCriterionId] = useState('');
  const [draft, setDraft] = useState({ flow: '', inputs: '', expected: '' }), [busy, setBusy] = useState(false);
  useEffect(() => {
    let current = true;
    if (!filePath) return;
    Promise.all([systemEvidenceRequest(snapshotId, 'catalog'), systemEvidenceRequest(snapshotId, `tests/analyze?filePath=${encodeURIComponent(filePath)}`)]).then(([catalog, analysis]) => { if (current) setData({ scenarios: catalog.scenarios.filter(row => row.filePath === filePath), analysis }); }).catch(error => { if (current) onError(error.response?.data?.message || error.message); });
    return () => { current = false; };
  }, [snapshotId, filePath, onError]);
  if (!revision || !data) return null;
  const scenario = data.scenarios.find(row => row.id === selected);
  const site = data.analysis.scenarioSites.find(row => row.title === scenario?.title);
  const assertions = data.analysis.assertionSites.filter(row => row.supported && row.scenarioLine === site?.line);
  const submit = async () => {
    setBusy(true);
    try {
      const criterion = revision.contentJson.criteria.find(row => row.id === criterionId);
      const binding = await systemEvidenceRequest(snapshotId, `requirements/${revision.id}/bindings`, { method: 'POST', data: { criterionId, testFile: filePath, assertionId, expectedOutcome: criterion.expectedOutcome } });
      await systemEvidenceRequest(snapshotId, `bindings/${binding.id}/approve`, { method: 'POST', data: { expectedTestHash: binding.testHash, expectedBindingHash: await sha(binding.bindingJson) } });
      const updated = await systemEvidenceRequest(snapshotId, `catalog/${scenario.id}`, { method: 'PUT', data: { title: scenario.title, flow: lines(draft.flow), inputs: lines(draft.inputs), expected: lines(draft.expected), criterionIds: [criterionId], expectedScenarioHash: scenario.scenarioHash } });
      await systemEvidenceRequest(snapshotId, `catalog/${scenario.id}/review`, { method: 'POST', data: { expectedScenarioHash: updated.scenarioHash, revisionId: revision.id, expectedRequirementHash: revision.contentHash, assertionIds: [assertionId] } });
      setSelected('');
      const catalog = await systemEvidenceRequest(snapshotId, 'catalog');
      setData(current => ({...current,scenarios:catalog.scenarios.filter(row=>row.filePath===filePath)}));
      await onRefresh();
    } catch (error) { onError(error.response?.data?.message || error.message); }
    finally { setBusy(false); }
  };
  return <details className="mt-4 rounded-lg border border-[var(--color-border)] p-3"><summary className="cursor-pointer text-sm font-medium">Review scenario against a criterion</summary><div className="mt-3 space-y-3 text-xs"><label className="block">Scenario<select value={selected} onChange={event => { const row = data.scenarios.find(item => item.id === event.target.value); setSelected(event.target.value); setAssertionId(''); setDraft({ flow: (row?.flowJson || []).join('\n'), inputs: (row?.inputJson || []).join('\n'), expected: (row?.expectedJson || []).join('\n') }); }} className="mt-1 w-full rounded border border-[var(--color-border)] bg-[var(--color-surface)] p-2"><option value="">Select scenario</option>{data.scenarios.map(row => <option key={row.id} value={row.id}>{row.title}</option>)}</select></label><label className="block">Confirmed criterion<select value={criterionId} onChange={event => setCriterionId(event.target.value)} className="mt-1 w-full rounded border border-[var(--color-border)] bg-[var(--color-surface)] p-2"><option value="">Select criterion</option>{revision.contentJson.criteria.map(row => <option key={row.id} value={row.id}>{row.id}: {row.expectedOutcome}</option>)}</select></label>{[['flow', 'Flow'], ['inputs', 'Input / preconditions'], ['expected', 'Expected (include the linked criterion outcome)']].map(([key, label]) => <label key={key} className="block">{label}<textarea rows={2} value={draft[key]} onChange={event => setDraft(current => ({ ...current, [key]: event.target.value }))} className="mt-1 w-full rounded border border-[var(--color-border)] bg-[var(--color-surface)] p-2" /></label>)}<label className="block">Outcome assertion<select value={assertionId} onChange={event => setAssertionId(event.target.value)} className="mt-1 w-full rounded border border-[var(--color-border)] bg-[var(--color-surface)] p-2"><option value="">Select assertion</option>{assertions.map(row => <option key={row.id} value={row.id}>{row.line}: {row.code}</option>)}</select></label><button type="button" disabled={busy || !scenario || !criterionId || !assertionId || Object.values(draft).some(value => !value.trim())} onClick={submit} className="rounded-lg bg-[var(--color-primary)] px-3 py-2 text-white disabled:opacity-40">{busy ? 'Saving review…' : 'Approve scenario and assertion mapping'}</button></div></details>;
}
