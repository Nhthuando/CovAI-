import { useState } from 'react';
import { CheckCheck, FileText, List, Plus, Save, Settings2, Sparkles, TriangleAlert } from 'lucide-react';
import { Button } from '../../ui/button';
import { Badge } from '../../ui/badge';
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '../../ui/sheet';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../ui/tabs';
import ConfirmDialog from '../../common/ConfirmDialog';
import { EmptyState, Field, JsonEditor } from './ui';
import { inputClass } from './evaluationTheme';
import { questionTypes as tasks, questionGroups } from './questionLabels';
import { groupIcon } from './questionIcons';
import { QuestionDetailHeader, QuestionFilters, QuestionListItem } from './questionUi';
import QuestionPreview from './QuestionPreview';
import ScenarioEditor, { RemoveQuestionButton } from './ScenarioEditor';
import ScenarioProposals from './ScenarioProposals';

import { normalizeModel, freshCase, modelOptions } from './questionEditorHelpers';

const shortGroupLabels = {
  HAPPY_PATH: 'Common',
  MULTI_TURN: 'Follow-up',
  OUT_OF_SCOPE: 'Off-topic',
  ADVERSARIAL: 'Tricky',
};

const preparationPhaseLabels = {
  QUEUED: 'Waiting to start…',
  MAPPING_TOPICS: 'Reading your documents…',
  EXTRACTING_TOPIC_MAP: 'Reading your documents…',
  GENERATING_SCENARIOS: 'Writing questions…',
  VALIDATING: 'Checking questions…',
  SHUTTING_DOWN: 'Stopping the chatbot…',
  BOOTING_CHATBOT: 'Starting the chatbot…',
  PROBING_KNOWLEDGE: 'Checking document access…',
  RUNNING_SCENARIO: 'Asking questions…',
  JUDGING_SCENARIO: 'Checking answers…',
  SCENARIO_COMPLETED: 'Question checked…',
  COMPLETED: 'Finished',
  FAILED: 'Could not finish',
};

function generationErrorMessage(message) {
  if (/503|high demand|overloaded|busy/i.test(message || '')) {
    return 'The AI service is busy right now. Wait a few minutes and try again.';
  }
  return (message || '').replace(/\[GoogleGenerativeAI Error\]:?\s*/g, '')
    .replace(/Error fetching from https?:\/\/\S+:\s*/g, '').replace(/\s+/g, ' ').trim().slice(0, 240)
    || 'Could not write questions. Try again.';
}

function StatTile({ label, children }) {
  return (
    <div className="min-w-0 px-4 py-3">
      <p className="text-xs text-[var(--color-text-muted)]">{label}</p>
      <p className="mt-1 truncate text-sm font-medium text-[var(--color-text)]">{children}</p>
    </div>
  );
}

function CheckboxRow({ checked, onChange, children, disabled }) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-md border border-[var(--color-border)] p-3 text-sm transition-colors duration-150 hover:bg-[var(--color-surface-secondary)]/60">
      <input type="checkbox" className="mt-0.5 size-4 shrink-0 cursor-pointer accent-[var(--color-primary)]"
        checked={checked} disabled={disabled} onChange={event => onChange(event.target.checked)} />
      <span className="text-[var(--color-text-secondary)]">{children}</span>
    </label>
  );
}

export default function ProfileEditor(props) {
  const [approveError, setApproveError] = useState('');
  return <ProfileVersionEditor key={`${props.version.id}-${props.version.revision}`} {...props}
    approveError={approveError} setApproveError={setApproveError} />;
}

function ProfileVersionEditor({
  version, data, capabilities, api, act, busy, actionEnabled,
  proposal, progress, preparationId, setPreparationId, refetchVersion, approveError, setApproveError,
}) {
  const defaults = { ...data.defaults, ...capabilities.defaults };
  const [definition, setDefinition] = useState(() => ({
    ...version.definition,
    scenarioCount: version.definition.scenarioCount ?? defaults.scenarioCount ?? 16,
    repetitions: version.definition.repetitions ?? defaults.repetitions ?? 2,
    limits: { ...version.definition.limits, delayMs: version.definition.limits?.delayMs ?? defaults.delayMs ?? 1000 },
    judge: {
      ...version.definition.judge,
      generatorModel: version.definition.judge?.generatorModel || defaults.generatorModel || '',
      model: version.definition.judge?.model || defaults.judgeModel || '',
    },
  }));
  const [cases, setCases] = useState(() => version.cases.map(item => item.definition));
  const [confirmApproval, setConfirmApproval] = useState(false);
  const [revision, setRevision] = useState(version.revision);
  const [selectedKey, setSelectedKey] = useState(null);
  const [editingKey, setEditingKey] = useState(null);
  const [filter, setFilter] = useState('ALL');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState('general');
  const draft = version.status === 'DRAFT';
  const sameModel = !!normalizeModel(definition.judge.generatorModel) &&
    normalizeModel(definition.judge.generatorModel) === normalizeModel(definition.judge.model);
  const models = modelOptions(capabilities.models);
  const modelLabel = id => models.find(model => model.id === id)?.label || id || '—';
  const changeCase = (caseKey, value) => setCases(previous => previous.map(item => item.caseKey === caseKey ? value : item));
  const save = () => api(`/profile-versions/${version.id}`, 'PATCH', {
    revision,
    definition,
    cases: cases.map(item => ({
      ...item,
      criteria: item.criteria.map(rule => {
        if (rule.method !== 'rule' || !['containsAll', 'orderedSteps', 'forbiddenText'].includes(rule.rule?.type)) {
          return rule;
        }
        return { ...rule, rule: {
          ...rule.rule,
          expected: rule.rule.expected.map(text => text.trim()).filter(Boolean),
        } };
      }),
    })),
  }).then(saved => {
    setRevision(saved.revision);
    return saved;
  });
  const preparationProgress = ['SUCCESS', 'FAILED'].includes(proposal.data?.status)
    ? proposal.data
    : progress && (!preparationId || !progress.jobId || progress.jobId === preparationId)
      ? progress : proposal.data;
  const preparationStatus = preparationProgress?.status || 'RUNNING';
  const generating = preparationProgress && ['QUEUED', 'RUNNING'].includes(preparationStatus);
  const missingDocuments = definition.sourceIds.length === 0;
  const onlyChatbotProfiles = !missingDocuments && definition.sourceIds.every(id =>
    data.sources.find(source => source.id === id)?.provenance?.type === 'CHATBOT_PROFILE',
  );
  const renderGenerate = (variant, centered = false) => (
    <div className={`flex flex-col gap-2 ${centered ? 'items-center text-center' : 'items-start'}`}>
    <Button variant={variant}
      disabled={busy || sameModel || missingDocuments || !definition.judge.generationConsent}
      title={!definition.judge.generationConsent ? 'Allow sending documents to AI in Settings → Privacy' : undefined}
      onClick={() => act(async () => {
        await save();
        const result = await api(`/profile-versions/${version.id}/propose`, 'POST', {});
        setPreparationId(result.jobId);
      }, 'Writing questions… they will appear below.')}>
      <Sparkles aria-hidden="true" />Write questions with AI
    </Button>
    {(missingDocuments || !definition.judge.generationConsent) && (
      <p className="text-xs text-[var(--color-text-secondary)]">
        {missingDocuments ? 'Pick at least one document or chatbot profile in Settings → Documents.' : 'Allow AI to read your documents first.'}{' '}
        <button type="button" className="cursor-pointer text-[var(--color-primary)] underline underline-offset-2"
          onClick={() => {
            setSettingsTab(missingDocuments ? 'documents' : 'privacy');
            setSettingsOpen(true);
          }}>
          {missingDocuments ? 'Open documents' : 'Open privacy settings'}
        </button>
      </p>
    )}
    </div>
  );

  const matches = (item, key) => key === 'ALL' || (key === 'UNVERIFIED' ? item.referenceUnverified : item.taskType === key);
  const filters = [
    { key: 'ALL', label: 'All', icon: List },
    ...Object.keys(questionGroups).map(key => ({ key, label: shortGroupLabels[key], icon: groupIcon(key) })),
    { key: 'UNVERIFIED', label: 'Needs check', icon: TriangleAlert, warn: true },
  ].map(item => ({ ...item, count: cases.filter(entry => matches(entry, item.key)).length }))
    .filter(item => item.key === 'ALL' || item.count > 0);
  const visible = cases.map((item, index) => ({ item, index })).filter(({ item }) => matches(item, filter));
  const selected = visible.find(({ item }) => item.caseKey === selectedKey) || visible[0];
  const editing = draft && selected && editingKey === selected.item.caseKey;
  const unverifiedCount = cases.filter(item => item.referenceUnverified).length;

  return (
    <div className="space-y-5">
      {sameModel && <p role="alert" className="rounded-md border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-400">The AI that writes questions and the AI that grades must be different models. Change one in Settings.</p>}

      <div className="flex flex-wrap items-stretch overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]">
        <div className="grid min-w-0 flex-1 grid-cols-2 divide-x divide-[var(--color-border)] md:grid-cols-4">
          <StatTile label="Questions"><span className="font-mono tabular-nums">{cases.length || definition.scenarioCount}</span>{!cases.length && <span className="text-[var(--color-text-muted)]"> planned</span>}</StatTile>
          <StatTile label="Each asked"><span className="font-mono tabular-nums">{definition.repetitions}×</span></StatTile>
          <StatTile label="Written by">{modelLabel(definition.judge.generatorModel)}</StatTile>
          <StatTile label="Graded by">{modelLabel(definition.judge.model)}</StatTile>
        </div>
        <div className="flex items-center border-t border-[var(--color-border)] px-3 py-2 md:border-t-0 md:border-l">
          <Button variant="ghost" size="sm" onClick={() => setSettingsOpen(true)}>
            <Settings2 aria-hidden="true" />Settings
          </Button>
        </div>
      </div>

      {!cases.length && !generating && (
        <EmptyState icon={Sparkles} title="No questions yet"
          description={onlyChatbotProfiles
            ? 'AI reads your chatbot profile and writes questions about its role, safety and memory. You can check and edit every question before approving.'
            : 'AI reads your documents and writes test questions. You can check and edit every question before approving.'}
          action={draft ? renderGenerate('default', true) : null} />
      )}

      {!!cases.length && (
        <div className="grid items-start gap-5 lg:grid-cols-[minmax(300px,400px)_minmax(0,1fr)]">
          <div className="min-w-0 overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] lg:sticky lg:top-4">
            <div className="border-b border-[var(--color-border)] p-3">
              <QuestionFilters filters={filters} value={filter} onChange={setFilter} />
            </div>
            <div className="max-h-[min(640px,65vh)] divide-y divide-[var(--color-border)] overflow-y-auto">
              {visible.map(({ item, index }) => (
                <QuestionListItem key={item.caseKey} item={item} index={index}
                  selected={selected?.item.caseKey === item.caseKey}
                  onSelect={() => { setSelectedKey(item.caseKey); setEditingKey(null); }} />
              ))}
              {!visible.length && <p className="p-4 text-sm text-[var(--color-text-muted)]">No questions match this filter.</p>}
            </div>
            {draft && (
              <div className="border-t border-[var(--color-border)] p-2">
                <Button variant="ghost" size="sm" className="w-full justify-start" disabled={busy} onClick={() => {
                  const created = freshCase();
                  setCases([...cases, created]);
                  setFilter('ALL');
                  setSelectedKey(created.caseKey);
                  setEditingKey(created.caseKey);
                }}>
                  <Plus aria-hidden="true" />Add question
                </Button>
              </div>
            )}
          </div>

          {selected && (
            <div className="min-w-0 overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]">
              <QuestionDetailHeader item={selected.item} index={selected.index} editing={editing} canEdit={draft}
                onToggleEdit={() => setEditingKey(editing ? null : selected.item.caseKey)}
                actions={editing && <RemoveQuestionButton onRemove={() => {
                  setCases(cases.filter(item => item.caseKey !== selected.item.caseKey));
                  setEditingKey(null);
                  setSelectedKey(null);
                }} />} />
              <div className="p-5">
                {editing ? (
                  <fieldset disabled={busy} className="min-w-0">
                    <ScenarioEditor item={selected.item} draft={draft} actionEnabled={actionEnabled}
                      onChange={value => changeCase(selected.item.caseKey, value)} />
                  </fieldset>
                ) : <QuestionPreview item={selected.item} />}
              </div>
            </div>
          )}
        </div>
      )}

      {(draft && !!cases.length) || generating || preparationStatus === 'FAILED' ? (
        <div className="flex flex-wrap items-center gap-3">
          {draft && !!cases.length && <>
            <Button variant="secondary" disabled={busy} onClick={() => act(save, 'Draft saved.')}>
              <Save aria-hidden="true" />Save draft
            </Button>
            {renderGenerate('secondary')}
          </>}
          {generating && (
            <div role="status" className="flex min-w-[240px] flex-1 items-center gap-3 rounded-md border border-sky-500/20 bg-sky-500/10 px-3 py-2 text-sm text-sky-300">
              <span className="relative flex size-2 shrink-0">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-sky-400 opacity-75" />
                <span className="relative inline-flex size-2 rounded-full bg-sky-500" />
              </span>
              <span className="min-w-0 flex-1 truncate">{preparationPhaseLabels[preparationProgress.phase] || 'Writing questions…'}</span>
              <span className="h-1.5 w-24 overflow-hidden rounded-md bg-sky-500/20" aria-hidden="true">
                <span className="block h-full bg-sky-400 transition-all duration-300" style={{ width: `${preparationProgress.progress ?? 0}%` }} />
              </span>
              <span className="font-mono tabular-nums">{preparationProgress.progress ?? 0}%</span>
            </div>
          )}
        </div>
      ) : null}
      {preparationProgress && preparationStatus === 'FAILED' && (
        <p role="alert" className="rounded-md border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-400">
          {generationErrorMessage(preparationProgress.errorMessage)}
        </p>
      )}
      {proposal.error && <p role="alert" className="text-sm text-rose-400">{proposal.error.message}</p>}
      <ScenarioProposals proposal={proposal} version={version} draft={draft} busy={busy}
        onAdd={proposed => {
          setCases([...cases, ...proposed]);
          setPreparationId('');
        }} />

      {draft && !!cases.length && (
        <div className="sticky bottom-0 z-10 flex flex-wrap items-center gap-x-5 gap-y-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-raised)] px-4 py-3">
          <p className="flex items-center gap-2 text-sm">
            <span className="font-mono tabular-nums font-medium">{cases.length}</span> questions
            {unverifiedCount > 0 && <Badge variant="warning"><TriangleAlert aria-hidden="true" /><span className="font-mono tabular-nums">{unverifiedCount}</span> need a source check</Badge>}
          </p>
          <label className="ml-auto flex cursor-pointer items-center gap-2 text-sm text-[var(--color-text-secondary)]">
            <input type="checkbox" className="size-4 cursor-pointer accent-[var(--color-primary)]" disabled={busy} checked={definition.scoring.confirmed}
              onChange={event => setDefinition({ ...definition, scoring: { ...definition.scoring, confirmed: event.target.checked } })} />
            I've checked the questions
          </label>
          <Button disabled={busy || sameModel} onClick={() => setConfirmApproval(true)}>
            <CheckCheck aria-hidden="true" />Approve
          </Button>
          {approveError && <p role="alert" className="text-sm text-[var(--color-danger)]">{approveError}</p>}
        </div>
      )}

      <Sheet open={settingsOpen} onOpenChange={setSettingsOpen}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>Test set settings</SheetTitle>
            <SheetDescription>{draft ? 'Changes are saved with the draft.' : 'This version is approved. Create a new draft to change settings.'}</SheetDescription>
          </SheetHeader>
          <SheetBody>
            <Tabs value={settingsTab} onValueChange={setSettingsTab} className="space-y-5">
              <TabsList>
                <TabsTrigger value="general">General</TabsTrigger>
                <TabsTrigger value="documents">Documents</TabsTrigger>
                <TabsTrigger value="scoring">Scoring</TabsTrigger>
                <TabsTrigger value="privacy">Privacy</TabsTrigger>
              </TabsList>
              <fieldset disabled={!draft || busy} className="min-w-0">
                <TabsContent value="general" className="space-y-5">
                  <Field label="AI that writes the questions">
                    <ModelSelect value={definition.judge.generatorModel} models={models}
                      onChange={value => setDefinition({ ...definition, judge: { ...definition.judge, generatorModel: value } })} />
                  </Field>
                  <Field label="AI that grades the answers" hint="Must be different from the writer.">
                    <ModelSelect value={definition.judge.model} models={models}
                      onChange={value => setDefinition({ ...definition, judge: { ...definition.judge, model: value } })} />
                  </Field>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Number of questions">
                      <input className={`${inputClass} font-mono tabular-nums`} type="number" min={4} max={60}
                        value={definition.scenarioCount} onChange={event => setDefinition({
                          ...definition, scenarioCount: Number(event.target.value),
                        })} />
                    </Field>
                    <Field label="Ask each question" hint="More than once checks consistency.">
                      <select className={`${inputClass} font-mono tabular-nums`} value={definition.repetitions}
                        onChange={event => setDefinition({ ...definition, repetitions: Number(event.target.value) })}>
                        {definition.repetitions === 1 && <option value={1}>1 time (existing version)</option>}
                        <option value={2}>2 times</option>
                        <option value={3}>3 times</option>
                      </select>
                    </Field>
                  </div>
                  <Field label="Pause between questions (ms)">
                    <input className={`${inputClass} font-mono tabular-nums`} type="number" min={0} max={30000}
                      value={definition.limits.delayMs} onChange={event => setDefinition({
                        ...definition, limits: { ...definition.limits, delayMs: Number(event.target.value) },
                      })} />
                  </Field>
                </TabsContent>
                <TabsContent value="documents" className="space-y-5">
                  <div className="space-y-2">
                    {data.sources.filter(source => source.status === 'READY').map(source => (
                      <CheckboxRow key={source.id} checked={definition.sourceIds.includes(source.id)}
                        onChange={checked => setDefinition({
                          ...definition,
                          sourceIds: checked ? [...definition.sourceIds, source.id]
                            : definition.sourceIds.filter(id => id !== source.id),
                        })}>
                        <span className="inline-flex items-center gap-2"><FileText className="size-4 text-[var(--color-text-muted)]" aria-hidden="true" />{source.name}</span>
                        <span className="ml-2 font-mono text-xs tabular-nums text-[var(--color-text-muted)]">v{source.version}</span>
                      </CheckboxRow>
                    ))}
                  </div>
                  <Field label="Business rules" hint="Extra rules the questions should test.">
                    <textarea className={inputClass} rows={4} value={definition.rules}
                      onChange={event => setDefinition({ ...definition, rules: event.target.value })} />
                  </Field>
                </TabsContent>
                <TabsContent value="scoring" className="space-y-5">
                  <Field label="Pass mark (0–100)">
                    <input className={`${inputClass} font-mono tabular-nums`} type="number" min={0} max={100}
                      value={definition.scoring.threshold ?? ''} onChange={event => setDefinition({
                        ...definition,
                        scoring: {
                          ...definition.scoring,
                          threshold: event.target.value === '' ? null : Number(event.target.value),
                          confirmed: false,
                        },
                      })} />
                  </Field>
                  <div className="grid gap-4 sm:grid-cols-2">
                    {Object.entries(definition.scoring.taskWeights).map(([key, value]) => (
                      <Field key={key} label={`${tasks[key] || key} weight`}>
                        <input className={`${inputClass} font-mono tabular-nums`} type="number"
                          min={0.01} max={1000} step="any" value={value} onChange={event => setDefinition({
                            ...definition,
                            scoring: {
                              ...definition.scoring,
                              confirmed: false,
                              taskWeights: { ...definition.scoring.taskWeights, [key]: Number(event.target.value) },
                            },
                          })} />
                      </Field>
                    ))}
                  </div>
                </TabsContent>
                <TabsContent value="privacy" className="space-y-3">
                  {[
                    ['generationConsent', 'Allow selected documents to be sent to AI to write questions'],
                    ['enabled', 'Use AI to grade answers'],
                    ['judgingConsent', 'Allow answers and relevant documents to be sent to AI for grading'],
                  ].map(([key, label]) => (
                    <CheckboxRow key={key} checked={definition.judge[key]}
                      onChange={checked => setDefinition({ ...definition, judge: { ...definition.judge, [key]: checked } })}>
                      {label}
                    </CheckboxRow>
                  ))}
                  <details className="pt-2">
                    <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)] hover:text-[var(--color-text)]">Mock tools (JSON)</summary>
                    <div className="mt-3">
                      <JsonEditor label="Mock tools" value={definition.tools}
                        onChange={tools => setDefinition({ ...definition, tools })} />
                    </div>
                  </details>
                </TabsContent>
              </fieldset>
            </Tabs>
          </SheetBody>
        </SheetContent>
      </Sheet>

      <ConfirmDialog isOpen={confirmApproval} onClose={() => setConfirmApproval(false)} loading={busy}
        variant="primary" title="Approve test questions" confirmText="Save and approve"
        message="Confirm the expected answers, business rules, actions and scoring policy. The approved version will be frozen."
        onConfirm={() => {
          if (sameModel) return;
          setApproveError('');
          act(async () => {
            try {
              const saved = await save();
              const approved = await api(`/profile-versions/${version.id}/approve`, 'POST', { revision: saved.revision });
              setApproveError('');
              setConfirmApproval(false);
              return approved;
            } catch (error) {
              setApproveError(error.message || 'Could not approve the test set.');
              setConfirmApproval(false);
              await refetchVersion();
              return null;
            }
          });
        }} />
    </div>
  );
}

function ModelSelect({ value, models, onChange }) {
  return (
    <select className={inputClass} value={value} onChange={event => onChange(event.target.value)}>
      <option value="" disabled>Select model</option>
      {!models.some(model => model.id === value) && value && <option value={value}>{value}</option>}
      {models.map(model => <option key={model.id} value={model.id}>{model.label}</option>)}
    </select>
  );
}
