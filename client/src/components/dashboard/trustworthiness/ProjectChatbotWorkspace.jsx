import { useState, useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '../../common/Button';
import ConfirmDialog from '../../common/ConfirmDialog';
import { useAuth } from '../../../hooks/useAuth';
import { evaluationKey, isEvaluationActive, useTrustworthinessQuery } from '../../../hooks/useTrustworthinessQuery';
import { evaluationRequest, downloadEvaluation } from '../../../services/trustworthiness.service';
import './trustworthiness.css';

const labels = { QUEUED: 'Queued', RUNNING: 'In Progress', COMPLETED: 'Completed', ERROR: 'Error', CANCELED: 'Canceled', INDETERMINATE: 'Indeterminate', PASSED: 'Passed', FAILED: 'Failed', INCOMPLETE: 'Incomplete', NOT_EVALUATED: 'Not Evaluated', INSUFFICIENT_EVIDENCE: 'Insufficient Evidence', NOT_APPLICABLE: 'Not Applicable' };
const stages = [['CHECKING', '1. Environment & Probe'], ['ANALYZING', '2. Benchmark Analysis'], ['RESULTS', '3. Evaluation Results']];
const readinessLabels = { PREPARING_RUNTIME: 'Preparing compatible Python runtime…', INSTALLING_DEPENDENCIES: 'Installing test environment dependencies…', STARTING_CHATBOT: 'Starting project chatbot…' };
const protocolLabels = { HTTP_JSON: 'HTTP JSON', HTTP_SSE: 'HTTP streaming (SSE)', HTTP_NDJSON: 'HTTP streaming (NDJSON)', CHAINLIT_SOCKET_IO: 'Chainlit Socket.IO' };
function State({ value }) { return <span className={`evaluation-status evaluation-status-${value}`}>{labels[value] || value}</span>; }
function Field({ label, children }) { return <label className="evaluation-field"><span>{label}</span>{children}</label>; }
const score = value => Number.isFinite(value) ? `${value.toFixed(1)}/100` : 'No score yet';

export default function ProjectChatbotWorkspace({ projectId }) {
  const location = useLocation(); const navigate = useNavigate(); const cache = useQueryClient(); const { userId } = useAuth();
  const params = new URLSearchParams(location.search); const selectedRun = params.get('evaluationId');
  const capabilities = useTrustworthinessQuery(projectId, '/capabilities');
  const listing = useTrustworthinessQuery(projectId, '/project-runs', { enabled: capabilities.data?.enabled === true, poll: true });
  const settings = useTrustworthinessQuery(projectId, '/project-settings', { enabled: capabilities.data?.enabled === true });
  const detail = useTrustworthinessQuery(projectId, `/project-runs/${selectedRun}`, { enabled: Boolean(selectedRun) && capabilities.data?.enabled === true, poll: true });
  const [snapshotId, setSnapshotId] = useState(params.get('snapshotId') || '');
  const [judgeConsent, setJudgeConsent] = useState(false); const [candidateId, setCandidateId] = useState('');
  const [environment, setEnvironment] = useState([{ name: '', value: '' }]);
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [dirty, setDirty] = useState(false); const appliedRevision = useRef(-1);
  useEffect(() => {
    if (!settings.data || dirty || appliedRevision.current === settings.data.revision) return;
    appliedRevision.current = settings.data.revision;
    setSnapshotId(settings.data.snapshotId || ''); setCandidateId(settings.data.candidateId || ''); setJudgeConsent(settings.data.judgeConsent);
    setEnvironment(settings.data.environmentNames.length ? settings.data.environmentNames.map(name => ({ name, value: '', saved: true })) : [{ name: '', value: '' }]);
  }, [settings.data, dirty]);
  const row = detail.data; const report = row?.report;
  const environmentAssessment = row?.discovery?.environmentAssessment;
  const needsLangGraph = row?.errorCode === 'CHATBOT_BACKEND_REQUIRED' || (row?.errorCode === 'CHATBOT_NOT_FOUND' && row.discovery?.packages?.some(pkg => pkg.dependencies?.includes('@langchain/langgraph-sdk')));
  const active = listing.data?.runs.some(run => isEvaluationActive(run.status));
  const currentPhase = row?.phase || 'CHECKING';
  function selectRun(id) { const query = new URLSearchParams(location.search); query.set('tab', 'trustworthiness'); query.set('evaluationId', id); query.delete('view'); query.delete('runId'); navigate(`${location.pathname}?${query}`); }
  async function act(operation) {
    setBusy(true); setError('');
    try { await operation(); }
    catch (failure) { setError(failure.message); } finally { await cache.invalidateQueries({ queryKey: evaluationKey(userId, projectId) }); setBusy(false); }
  }
  async function start() {
    const created = await evaluationRequest(projectId, '/project-runs', { method: 'POST', body: { idempotencyKey: crypto.randomUUID(), ...configurationBody(), settingsRevision: settings.data.revision } });
    rememberSaved(); selectRun(created.id);
  }
  function configurationBody() {
    const fields = environment.filter(item => item.name.trim()); const names = fields.map(item => item.name.trim());
    if (new Set(names).size !== names.length) throw new Error('Environment variable names must be unique.');
    return { snapshotId: snapshotId || null, candidateId: candidateId || null, judgeConsent, environment: Object.fromEntries(fields.filter(item => !item.saved || item.value !== '').map(item => [item.name.trim(), item.value])), removeEnvironmentNames: (settings.data?.environmentNames || []).filter(name => !names.includes(name)) };
  }
  function rememberSaved() {
    setEnvironment(environment.filter(item => item.name.trim()).map(item => ({ name: item.name.trim(), value: '', saved: true })));
    setDirty(false);
  }
  async function saveConfiguration() {
    await evaluationRequest(projectId, '/project-settings', { method: 'PUT', body: { ...configurationBody(), revision: settings.data.revision } });
    rememberSaved();
  }
  if (!projectId) return <div className="evaluation-workspace">Select an imported project to evaluate chatbot trustworthiness.</div>;
  if (capabilities.isPending) return <div className="evaluation-workspace" role="status">Loading…</div>;
  if (capabilities.error) return <div className="evaluation-workspace" role="alert">{capabilities.error.status === 403 ? 'Only project owners have permission to run chatbot evaluations.' : capabilities.error.message}</div>;
  if (!capabilities.data?.enabled) return <div className="evaluation-workspace"><h1>Chatbot Evaluation</h1><p>Feature is being initialized. Please try again shortly.</p></div>;
  return <section className="evaluation-workspace" aria-label="Project chatbot evaluation">
    <header><h1>Chatbot Evaluation</h1><p>COVAI evaluates imported project chatbots against verified quality and security benchmarks.</p></header>
    <ol className="evaluation-project-steps" aria-label="Evaluation progress">{stages.map(([key, label]) => <li key={key} aria-current={currentPhase === key ? 'step' : undefined}>{label}</li>)}</ol>
    {error && <p role="alert" className="evaluation-error">{error}</p>}
    {listing.isPending && <p role="status">Loading project data…</p>}
    {listing.error && <div role="alert"><p>{listing.error.message}</p><Button variant="secondary" onClick={() => listing.refetch()}>Retry</Button></div>}
    {settings.error && <p role="alert">Failed to load saved configuration: {settings.error.message}</p>}
    {listing.data && <form className="evaluation-panel" onSubmit={event => { event.preventDefault(); act(start); }}>
      {!listing.data.snapshots.length ? <p>Please import project source code before beginning.</p> : <fieldset disabled={busy}>
        <Field label="Project Source Snapshot"><select value={snapshotId} disabled={busy || active} onChange={event => { setDirty(true); setSnapshotId(event.target.value); setCandidateId(''); }}><option value="">Latest snapshot</option>{listing.data.snapshots.map(snapshot => <option key={snapshot.id} value={snapshot.id}>{new Date(snapshot.createdAt).toLocaleString()} · {snapshot.source}</option>)}</select></Field>
        {row?.errorCode === 'CHATBOT_SELECTION_REQUIRED' && <Field label="Discovered Project Chatbot"><select value={candidateId} onChange={event => { setDirty(true); setCandidateId(event.target.value); }} required><option value="">Select chatbot</option>{row.discovery?.candidates.map(candidate => <option key={candidate.id} value={candidate.id}>{candidate.path} · {candidate.file}</option>)}</select></Field>}
        <details><summary>Additional environment configuration (Optional)</summary><p>Provide keys or environment variables for the test environment. Do not use production credentials.</p>
          <p>Provide only variables required by the chatbot. Evaluator LLM judge configurations are managed separately.</p>
          {environmentAssessment?.providerReferences?.length > 0 && <p>Provider variables referenced by source: {environmentAssessment.providerReferences.join(', ')}. This does not guarantee all are strictly required.</p>}
          {(environmentAssessment?.chatbotDependencyReferences?.length > 0 || environmentAssessment?.otherProjectReferences?.length > 0) && <details><summary>Other variables in source — not verified as required</summary>
            {environmentAssessment.chatbotDependencyReferences.length > 0 && <p>Referenced in chatbot module or dependencies: {environmentAssessment.chatbotDependencyReferences.join(', ')}.</p>}
            {environmentAssessment.otherProjectReferences.length > 0 && <p>Other references in source, not specifically linked to chatbot: {environmentAssessment.otherProjectReferences.join(', ')}.</p>}
            <p>Not all variables need to be provided. Database or auth variables only require test values if chatbot flows depend on them. Test ports are managed by COVAI.</p>
          </details>}
          <p>Configuration is stored per project. Saved values are encrypted; leave blank to preserve current value.</p>
          {environment.map((item, index) => <div className="evaluation-grid" key={index}><Field label={`Variable Name ${index + 1}`}><input autoComplete="off" value={item.name} onChange={event => { setDirty(true); setEnvironment(environment.map((entry, i) => i === index ? { ...entry, name: event.target.value, saved: false } : entry)); }} placeholder="Variable name required by chatbot" /></Field><Field label={`Value ${index + 1}`}><input type="password" autoComplete="new-password" value={item.value} placeholder={item.saved ? 'Saved — leave blank to keep unchanged' : ''} onChange={event => { setDirty(true); setEnvironment(environment.map((entry, i) => i === index ? { ...entry, value: event.target.value } : entry)); }} /></Field><Button variant="ghost" onClick={() => { setDirty(true); setEnvironment(environment.filter((_, i) => i !== index)); }}>Remove Variable {index + 1}</Button></div>)}
          <Button variant="ghost" disabled={environment.length >= 30} onClick={() => { setDirty(true); setEnvironment([...environment, { name: '', value: '' }]); }}>Add Variable</Button>
        </details>
        {listing.data.judgeConfigured ? <label className="evaluation-check"><input type="checkbox" checked={judgeConsent} onChange={event => { setDirty(true); setJudgeConsent(event.target.checked); }} />Allow COVAI to forward answers and relevant business snippets to Gemini for semantic evaluation.</label> : <p className="evaluation-muted">Semantic evaluation is not configured. Criteria requiring semantic evaluation will remain unscored.</p>}
        <div className="evaluation-actions"><Button type="submit" loading={busy} disabled={active || !settings.data}>Evaluate Chatbot</Button><Button variant="secondary" disabled={busy || !settings.data} onClick={() => act(saveConfiguration)}>Save Configuration</Button></div>
        {settings.data?.revision > 0 && !dirty && <p role="status">Project configuration saved. Subsequent evaluations will reuse these settings.</p>}
      </fieldset>}
    </form>}
    {detail.isPending && selectedRun && <p role="status">Loading evaluation run…</p>}
    {detail.error && <p role="alert" className="evaluation-error">{detail.error.message}</p>}
    {row && <div className="evaluation-stack">
      <div className="evaluation-panel"><div className="evaluation-row"><h2>{stages.find(([key]) => key === currentPhase)?.[1]}</h2><State value={row.status} /></div>
        {isEvaluationActive(row.status) && <p role="status">{currentPhase === 'CHECKING' ? readinessLabels[row.result?.readinessStage] || 'Detecting and verifying chatbot in project source…' : 'Running benchmark scenarios and collecting evidence…'}</p>}
        {row.errorMessage && <div role="alert"><p>{row.errorMessage}</p><small>{row.errorCode}</small></div>}
        {row.result?.runtimePreparation?.pythonRuntime?.version && <p>Python test runtime: {row.result.runtimePreparation.pythonRuntime.version}.</p>}
        {needsLangGraph && <details open><summary>Testing Guide for this LangGraph Project</summary><p>This is a frontend connecting to a LangGraph server. A running agent backend and valid Assistant/Graph ID are required; adding a Gemini key to the frontend does not replace the backend.</p><ol><li>Start the LangGraph backend following its instructions and obtain the Graph ID.</li><li>Run the frontend via pnpm install and pnpm dev. In settings, enter the backend Deployment URL and Assistant/Graph ID; LangSmith key is only needed if required by deployment.</li><li>For COVAI automated grading in imported projects, the backend must expose a POST JSON endpoint returning answer. LangGraph streaming/SSE protocol currently requires a dedicated adapter.</li></ol></details>}
        {row.result?.readiness?.ready && <p>✓ Chatbot started successfully and answered probe question.</p>}
        {row.result?.runtime?.protocol && <p>Verified connection: {protocolLabels[row.result.runtime.protocol] || row.result.runtime.protocol}.</p>}
        {row.result?.businessAnalysis && <p>Generated {row.result.businessAnalysis.groundedCaseCount} business scenarios from {row.result.businessAnalysis.sourceCount} analyzed documents.</p>}
        {row.result?.runtime?.dependencyProvenance?.complete === false && <p className="evaluation-muted">Missing requirements.txt; using compatible Chainlit runtime. Results do not verify the application's exact native dependencies.</p>}
        {row.discovery?.sourceScope?.repositoryRelativeRoot && <p>Source scope: {row.discovery.sourceScope.repositoryRelativeRoot === '.' ? 'Selected application' : row.discovery.sourceScope.repositoryRelativeRoot}</p>}
        {row.discovery?.candidates?.length > 0 && <details><summary>Detected Chatbots</summary>{row.discovery.candidates.map(candidate => <p key={candidate.id}>{candidate.file}:{candidate.line} · {candidate.path}</p>)}</details>}
        {row.errorCode === 'CHATBOT_CONFIGURATION_REQUIRED' && <p>Add the test variables mentioned in the startup error and rerun; not all project variables are required.</p>}
        {isEvaluationActive(row.status) ? <Button variant="secondary" loading={busy} onClick={() => act(() => evaluationRequest(projectId, `/project-runs/${row.id}/cancel`, { method: 'POST', body: {} }))}>Cancel Evaluation</Button> : <Button variant="ghost" disabled={busy} onClick={() => setConfirmDelete(true)}>Delete Evaluation Run</Button>}
      </div>
      {report && <div className="evaluation-panel"><h2>Evaluation Results</h2>{report.summary?.partial && <p>Preliminary score on completed criteria</p>}<p className="evaluation-project-score">{score(report.summary?.score)} <State value={report.verdict} /></p><p>Scored {report.summary?.completeness?.scored || 0}/{report.summary?.completeness?.applicable || 0} criteria.{report.summary?.partial ? ' Score is currently partial.' : ''}</p>
        <p>COVAI Benchmark {row.result?.benchmark?.version || report.manifest.platformBenchmark?.version}. Results reflect only evaluated scenarios.</p>
        {row.result?.unavailable?.filter(item => item.status !== 'NOT_APPLICABLE').map(item => <p key={item.criterion} className="evaluation-muted">{item.criterion}: {item.reason}</p>)}
        {!isEvaluationActive(row.status) && <div className="evaluation-actions">{['json', 'pdf'].map(format => <Button key={format} variant="secondary" disabled={busy} onClick={() => act(() => downloadEvaluation(projectId, row.evaluationRunId, format))}>Download {format.toUpperCase()}</Button>)}</div>}
        {report.cases.map(item => <details className="evaluation-panel" key={item.id}><summary>{item.testCase.definition.title} · <State value={item.verdict} /></summary>
          {item.testCase.definition.turns.map((turn, index) => <p key={index}><strong>Question {index + 1}:</strong> {turn.content}</p>)}
          {report.evidence.filter(evidence => evidence.caseResultId === item.id && evidence.kind === 'CONVERSATION').map(evidence => <div key={evidence.id}>{evidence.payload.responses?.map((response, index) => <pre key={index}>{response.answer}</pre>)}</div>)}
          {item.criteria.map(criterion => <div key={criterion.id}><strong>{criterion.criterionKey}</strong> · <State value={criterion.status} /><p>{criterion.reason}</p>{criterion.details.recommendation && <p>{criterion.details.recommendation}</p>}</div>)}
        </details>)}
      </div>}
    </div>}
    {listing.data?.runs.length > 0 && <div className="evaluation-panel"><h2>Evaluation History</h2>{listing.data.runs.map(run => <div className="evaluation-row" key={run.id}><button className="evaluation-link" onClick={() => selectRun(run.id)}>{new Date(run.createdAt).toLocaleString()} · {run.id.slice(-6)}</button><State value={run.status} /><span>{score(run.result?.summary?.score)}</span></div>)}</div>}
    <ConfirmDialog isOpen={confirmDelete} onClose={() => setConfirmDelete(false)} loading={busy} title="Delete Evaluation Run?" message="Results and evidence for this evaluation run will be deleted." confirmText="Delete" onConfirm={() => act(async () => { await evaluationRequest(projectId, `/project-runs/${selectedRun}`, { method: 'DELETE' }); setConfirmDelete(false); const query = new URLSearchParams(location.search); query.delete('evaluationId'); navigate(`${location.pathname}?${query}`); })} />
  </section>;
}
