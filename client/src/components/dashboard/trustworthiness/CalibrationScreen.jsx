import { useState } from 'react';
import { Bot, EyeOff, FileText, ScanSearch, User } from 'lucide-react';
import { Skeleton } from '../../common/Skeleton';
import { Button } from '../../ui/button';
import { Badge } from '../../ui/badge';
import { ProgressCircle } from '../../ui/tremor';
import { cn } from '../../../lib/utils';
import { useTrustworthinessQuery } from '../../../hooks/useTrustworthinessQuery';
import { EmptyState, Field, SectionLabel } from './ui';
import ReviewForm from './ReviewForm';
import AnswerText from './AnswerText';
import { inputClass, numberText, percentText } from './evaluationTheme';
import { criterionLabel, groupLabel } from './criterionLabels';
import { GroupIcon } from './questionUi';

const checkQuestions = {
  faithfulness: 'Does the answer only say things your documents support?',
  completeness: 'Does the answer cover everything the question asked?',
  contextRetention: 'Does it remember what was said earlier in the conversation?',
  appropriateRefusal: "Does it refuse requests it shouldn't help with?",
};
const MINIMUM = 10;

export default function CalibrationScreen({ projectId, data, api, act, busy, navigateView }) {
  const [selected, setSelected] = useState('');
  const profiles = data.profiles.filter(profile => !profile.archivedAt);
  const profileId = selected || profiles[0]?.id || '';
  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1">
          <h2 className="text-xl font-semibold tracking-tight">Check the grading AI</h2>
          <p className="max-w-2xl text-sm text-[var(--color-text-muted)]">
            Grade some answers yourself. CovAI compares your grades with the AI's to show how far you can trust its scores.
          </p>
        </div>
        {profiles.length > 1 && (
          <div className="w-64">
            <Field label="Test set">
              <select className={inputClass} value={profileId} onChange={event => setSelected(event.target.value)}>
                {profiles.map(profile => <option key={profile.id} value={profile.id}>{profile.name}</option>)}
              </select>
            </Field>
          </div>
        )}
      </header>
      {profileId ? (
        <ProfileCalibration key={profileId} projectId={projectId} profileId={profileId}
          api={api} act={act} busy={busy} navigateView={navigateView} />
      ) : <ReviewEmptyState navigateView={navigateView} />}
    </div>
  );
}

function ReviewEmptyState({ navigateView }) {
  return <EmptyState icon={ScanSearch} title="Nothing to review yet"
    description="Run an evaluation that finishes grading. Answers to review will show up here."
    action={<Button onClick={() => navigateView('run')}>Go to run and report</Button>} />;
}

function ProfileCalibration({ projectId, profileId, api, act, busy, navigateView }) {
  const queue = useTrustworthinessQuery(projectId, `/profiles/${profileId}/blind-reviews`);
  const stats = useTrustworthinessQuery(projectId, `/profiles/${profileId}/calibration`);
  const [handled, setHandled] = useState([]);
  const [skipped, setSkipped] = useState([]);
  const items = queue.data || [];
  const remaining = items.filter(item => !handled.includes(item.criterionResultId) &&
    !skipped.includes(item.criterionResultId));
  const item = remaining[0];
  const done = handled.length + skipped.length;
  const total = done + remaining.length;
  return (
    <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="min-w-0 space-y-4">
        {queue.isLoading && (
          <div role="status" aria-label="Loading blind review queue">
            <Skeleton rounded="rounded-lg" className="h-96 w-full" />
          </div>
        )}
        {queue.error && <p role="alert" className="text-sm text-rose-400">{queue.error.message}</p>}
        {queue.isSuccess && !item && <ReviewEmptyState navigateView={navigateView} />}
        {item && (
          <section className="overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]">
            <div className="space-y-3 border-b border-[var(--color-border)] px-5 py-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline"><GroupIcon type={item.taskType} aria-hidden="true" />{groupLabel(item.taskType)}</Badge>
                  <Badge variant="secondary"><EyeOff aria-hidden="true" />AI grade hidden</Badge>
                </div>
                <span className="font-mono text-xs tabular-nums text-[var(--color-text-muted)]">{done + 1} / {total}</span>
              </div>
              <div className="h-1 overflow-hidden rounded-md bg-[var(--color-surface-muted)]" aria-hidden="true">
                <div className="h-full bg-[var(--color-primary)] transition-all duration-300" style={{ width: `${total ? (done / total) * 100 : 0}%` }} />
              </div>
              <h3 className="text-base font-semibold tracking-tight">{item.title}</h3>
            </div>
            <div className="space-y-6 p-5">
              <BlindTranscript item={item} />
              {item.expected != null && (
                <figure className="space-y-2">
                  <figcaption className="flex items-center gap-2 text-xs text-[var(--color-text-muted)]"><FileText className="size-3.5" aria-hidden="true" />From your documents</figcaption>
                  <blockquote className="whitespace-pre-wrap break-words border-l-2 border-[var(--color-border-strong)] pl-4 text-sm italic leading-relaxed text-[var(--color-text-secondary)]">
                    {typeof item.expected === 'string' ? item.expected : JSON.stringify(item.expected, null, 2)}
                  </blockquote>
                </figure>
              )}
            </div>
            <div className="space-y-4 border-t border-[var(--color-border)] bg-[var(--color-surface-secondary)]/40 p-5">
              <div className="space-y-1">
                <SectionLabel>{criterionLabel(item.criterionKey)}</SectionLabel>
                <p className="text-base font-medium">{checkQuestions[item.criterionKey] || 'Does the answer meet this check?'}</p>
              </div>
              <ReviewForm key={item.criterionResultId} criterionId={item.criterionResultId}
                api={api} act={act} busy={busy} blind
                onSkip={() => setSkipped(previous => [...previous, item.criterionResultId])}
                onSaved={async () => {
                  setHandled(previous => [...previous, item.criterionResultId]);
                  await Promise.all([stats.refetch(), queue.refetch()]);
                }} />
            </div>
          </section>
        )}
      </div>
      <div className="min-w-0 space-y-4 xl:sticky xl:top-4">
        {stats.isLoading && (
          <div role="status" aria-label="Loading calibration statistics">
            <Skeleton rounded="rounded-lg" className="h-64 w-full" />
          </div>
        )}
        {stats.error && <p role="alert" className="text-sm text-rose-400">{stats.error.message}</p>}
        {stats.data && <CalibrationStats stats={stats.data} />}
      </div>
    </div>
  );
}

function ChatLine({ who, children }) {
  const user = who === 'user';
  const Icon = user ? User : Bot;
  return (
    <div className="flex items-start gap-3">
      <span className={cn('mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md border',
        user ? 'border-[var(--color-border)] bg-[var(--color-surface-secondary)] text-[var(--color-text-secondary)]'
          : 'border-[var(--color-primary)]/30 bg-[var(--color-primary)]/10 text-[var(--color-primary)]')}>
        <Icon className="size-4" aria-hidden="true" />
      </span>
      <div className={cn('min-w-0 flex-1 text-sm leading-relaxed', user
        ? 'w-fit rounded-lg rounded-tl-sm bg-[var(--color-surface-secondary)] px-3.5 py-2.5 text-[var(--color-text)]'
        : 'pt-1 text-[var(--color-text-secondary)]')}>{children}</div>
    </div>
  );
}

function BlindTranscript({ item }) {
  return (
    <div className="space-y-4">
      {!item.conversations?.length && (item.turns || []).map((turn, index) => (
        <ChatLine key={index} who="user"><p className="whitespace-pre-wrap break-words">{turn.content}</p></ChatLine>
      ))}
      {(item.conversations || []).map((conversation, index) => (
        <div key={conversation.evidenceId || index} className="space-y-4">
          {item.conversations.length > 1 && <p className="text-xs font-medium text-[var(--color-text-muted)]">Attempt <span className="font-mono tabular-nums">{conversation.payload?.repetition ?? index + 1}</span></p>}
          {(conversation.payload?.responses || []).map((response, turnIndex) => (
            <div key={turnIndex} className="space-y-4">
              <ChatLine who="user"><p className="whitespace-pre-wrap break-words">{item.turns?.[turnIndex]?.content}</p></ChatLine>
              <ChatLine who="bot"><AnswerText>{response.answer}</AnswerText></ChatLine>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function CalibrationStats({ stats }) {
  const kappa = stats.cohensKappa;
  const reviewed = stats.reviewed ?? 0;
  const ready = reviewed >= MINIMUM;
  const label = kappa < 0.2 ? 'Poor' : kappa < 0.4 ? 'Fair' : kappa < 0.6 ? 'Moderate' : kappa < 0.8 ? 'Good' : 'Very good';
  const agreement = Number.isFinite(stats.agreementRate) ? stats.agreementRate * 100 : null;
  return (
    <section className="space-y-5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
      <h2 className="text-sm font-semibold tracking-tight">Agreement with the grading AI</h2>
      {!ready ? (
        <div className="space-y-3">
          <div className="flex items-baseline justify-between text-sm">
            <span className="text-[var(--color-text-muted)]">Answers you've graded</span>
            <span className="font-mono tabular-nums">{reviewed}<span className="text-[var(--color-text-muted)]">/{MINIMUM}</span></span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-md bg-[var(--color-surface-muted)]" aria-hidden="true">
            <div className="h-full bg-[var(--color-primary)] transition-all duration-300" style={{ width: `${Math.min(100, (reviewed / MINIMUM) * 100)}%` }} />
          </div>
          <p className="text-xs text-[var(--color-text-muted)]">Grade at least {MINIMUM} answers to see how often you and the AI agree.</p>
        </div>
      ) : (
        <div className="flex items-center gap-5">
          <ProgressCircle value={agreement ?? 0} radius={40} strokeWidth={6} color={agreement >= 80 ? 'success' : agreement >= 60 ? 'warning' : 'danger'}>
            <span className="font-mono text-lg font-semibold tabular-nums">{agreement != null ? `${numberText(agreement, 0)}%` : '—'}</span>
          </ProgressCircle>
          <div className="min-w-0 space-y-1 text-sm">
            <p className="font-medium">{Number.isFinite(kappa) ? `${label} agreement` : 'Agreement'}</p>
            <p className="text-[var(--color-text-muted)]">
              {Number.isFinite(kappa) ? <>Cohen's kappa <span className="font-mono tabular-nums">{numberText(kappa, 2)}</span></> : 'Kappa needs more variety in grades.'}
            </p>
            <p className="text-xs text-[var(--color-text-muted)]">From <span className="font-mono tabular-nums">{reviewed}</span> answers you graded</p>
          </div>
        </div>
      )}
      <CriterionAgreementTable byCriterion={stats.byCriterion} />
    </section>
  );
}

const share = value => (Number.isFinite(value) ? percentText(value) : '—');

function CriterionAgreementTable({ byCriterion }) {
  const rows = Object.entries(byCriterion || {}).filter(([, item]) => item?.n > 0);
  if (!rows.length) return null;
  return (
    <div className="space-y-3 border-t border-[var(--color-border)] pt-4">
      <SectionLabel>By check</SectionLabel>
      <div className="space-y-3">
        {rows.map(([key, item]) => (
          <div key={key} className="space-y-1.5 rounded-md border border-[var(--color-border)] p-3 text-xs">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-sm font-medium">{criterionLabel(key)}</span>
              <span className="font-mono tabular-nums text-[var(--color-text-muted)]">n={item.n}</span>
            </div>
            <div className="grid grid-cols-3 gap-2 text-[var(--color-text-muted)]">
              <span title="Of the answers you rated good, how many the AI also passed">Good spotted<br /><span className="font-mono text-sm tabular-nums text-[var(--color-text)]">{share(item.sensitivity)}</span></span>
              <span title="Of the answers you rated bad, how many the AI also failed">Bad spotted<br /><span className="font-mono text-sm tabular-nums text-[var(--color-text)]">{share(item.specificity)}</span></span>
              <span title="Agreement beyond chance, with its 95% range">Kappa<br /><span className="font-mono text-sm tabular-nums text-[var(--color-text)]">{Number.isFinite(item.kappa) ? numberText(item.kappa, 2) : '—'}</span>
                {Array.isArray(item.kappaCi95) && <span className="block font-mono tabular-nums">{numberText(item.kappaCi95[0], 2)}–{numberText(item.kappaCi95[1], 2)}</span>}</span>
            </div>
          </div>
        ))}
      </div>
      <p className="text-xs text-[var(--color-text-muted)]">
        Once a check has {MINIMUM} good and {MINIMUM} bad answers graded, reports correct its pass rate for the AI's mistakes.
      </p>
    </div>
  );
}
