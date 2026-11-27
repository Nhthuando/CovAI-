import { useState } from 'react';
import { Bot, ChevronRight, FileText, MessageSquareWarning, User } from 'lucide-react';
import { Badge } from '../../ui/badge';
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '../../ui/sheet';
import { Legend } from '../../ui/tremor';
import { cn } from '../../../lib/utils';
import { SectionLabel } from './ui';
import ReviewForm from './ReviewForm';
import AnswerText from './AnswerText';
import { numberText } from './evaluationTheme';
import { CRITERION_LABELS, criterionLabel } from './criterionLabels';
import { questionGroup, questionResult } from './reportHelpers';
import { ResultCell, ResultChip } from './reportUi';
import { GroupIcon } from './questionUi';

const columnOrder = ['faithfulness', 'completeness', 'contextRetention', 'appropriateRefusal', 'keyFacts'];
const shortLabels = {
  faithfulness: 'Docs',
  completeness: 'Complete',
  contextRetention: 'Memory',
  appropriateRefusal: 'Refusal',
  keyFacts: 'Facts',
};
const filters = [
  ['ALL', 'All'],
  ['FAILED', 'Failed'],
  ['UNGRADED', 'Not graded'],
  ['PASSED', 'Passed'],
];
const matchesFilter = (result, key) => key === 'ALL'
  || (key === 'UNGRADED' ? ['ERROR', 'INSUFFICIENT_EVIDENCE'].includes(result) : result === key);

export default function RunDiagnostics({ run, api, act, busy }) {
  const [filter, setFilter] = useState('ALL');
  const [openId, setOpenId] = useState(null);
  const all = (run.cases || []).map((item, index) => ({ item, number: index + 1, result: questionResult(item) }));
  const present = new Set(all.flatMap(({ item }) => (item.criteria || []).map(check => check.criterionKey)));
  const columns = [...columnOrder.filter(key => present.has(key)), ...[...present].filter(key => !columnOrder.includes(key))];
  const rows = all.filter(({ result }) => matchesFilter(result, filter));
  const open = all.find(({ item }) => item.id === openId);
  return (
    <section className="overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--color-border)] px-5 py-4">
        <div>
          <h2 className="text-sm font-semibold tracking-tight">Question results</h2>
          <p className="mt-1 text-xs text-[var(--color-text-muted)]">Click a row to see the conversation and why it was graded that way.</p>
        </div>
        <div className="flex gap-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-secondary)] p-[3px]" role="group" aria-label="Filter results">
          {filters.map(([key, label]) => {
            const count = all.filter(({ result }) => matchesFilter(result, key)).length;
            return (
              <button key={key} type="button" aria-pressed={filter === key} onClick={() => setFilter(key)}
                className={cn('inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors duration-150 outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus)]/50',
                  filter === key ? 'bg-[var(--color-surface-raised)] text-[var(--color-text)]' : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)]')}>
                {label}<span className="font-mono tabular-nums opacity-70">{count}</span>
              </button>
            );
          })}
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm">
          <thead>
            <tr className="border-b border-[var(--color-border)] bg-[var(--color-surface-secondary)]/40 text-xs text-[var(--color-text-muted)]">
              <th className="w-10 py-2.5 pl-5 pr-2 text-left font-medium">#</th>
              <th className="py-2.5 pr-3 text-left font-medium">Question</th>
              {columns.map(key => (
                <th key={key} className="w-20 px-1.5 py-2.5 text-center font-medium" title={CRITERION_LABELS[key] || key}>{shortLabels[key] || key}</th>
              ))}
              <th className="w-32 px-3 py-2.5 text-left font-medium">Result</th>
              <th className="w-8 pr-4" aria-hidden="true" />
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--color-border)]">
            {rows.map(({ item, number, result }) => {
              const byKey = Object.fromEntries((item.criteria || []).map(check => [check.criterionKey, check.status]));
              const definition = item.testCase?.definition || {};
              return (
                <tr key={item.id} tabIndex={0} onClick={() => setOpenId(item.id)}
                  onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setOpenId(item.id); } }}
                  className="group cursor-pointer outline-none transition-colors duration-150 hover:bg-[var(--color-surface-secondary)]/60 focus-visible:bg-[var(--color-surface-secondary)]">
                  <td className="py-2.5 pl-5 pr-2 font-mono text-xs tabular-nums text-[var(--color-text-muted)]">{number}</td>
                  <td className="max-w-0 py-2.5 pr-3">
                    <span className="flex min-w-0 items-center gap-2.5">
                      <GroupIcon type={item.testCase?.taskType} className="size-4 shrink-0 text-[var(--color-text-muted)]" aria-label={questionGroup(item.testCase?.taskType)} />
                      <span className="truncate text-[var(--color-text)]">{definition.title || item.testCase?.caseKey || 'Question'}</span>
                    </span>
                  </td>
                  {columns.map(key => (
                    <td key={key} className="px-1.5 py-2.5"><ResultCell value={byKey[key] || 'NOT_APPLICABLE'} label={criterionLabel(key)} /></td>
                  ))}
                  <td className="px-3 py-2.5"><ResultChip value={result} /></td>
                  <td className="pr-4 text-[var(--color-text-muted)]"><ChevronRight className="size-4 transition-transform duration-150 group-hover:translate-x-0.5" aria-hidden="true" /></td>
                </tr>
              );
            })}
            {!rows.length && (
              <tr><td colSpan={columns.length + 4} className="px-5 py-8 text-center text-sm text-[var(--color-text-muted)]">No questions match this filter.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="border-t border-[var(--color-border)] px-5 py-3">
        <Legend items={[
          { label: 'Passed', color: 'success' },
          { label: 'Failed', color: 'danger' },
          { label: 'Not graded', color: 'warning' },
          { label: "Doesn't apply", color: 'neutral' },
        ]} />
      </div>
      <Sheet open={!!open} onOpenChange={value => { if (!value) setOpenId(null); }}>
        <SheetContent className="sm:max-w-2xl">
          {open && <ResultDetail entry={open} run={run} api={api} act={act} busy={busy} />}
        </SheetContent>
      </Sheet>
    </section>
  );
}

function ResultDetail({ entry, run, api, act, busy }) {
  const { item, number, result } = entry;
  const definition = item.testCase?.definition || {};
  const evidence = item.evidence || (run.evidence || []).filter(record => record.caseResultId === item.id);
  const conversations = evidence.filter(record => record.kind === 'CONVERSATION' || record.payload?.responses);
  const checks = (item.criteria || []).filter(check => check.status !== 'NOT_APPLICABLE');
  const hidden = (item.criteria || []).length - checks.length;
  const turns = definition.turns || [];
  return (
    <>
      <SheetHeader>
        <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--color-text-muted)]">
          <span className="font-mono tabular-nums">#{number}</span>
          <Badge variant="outline"><GroupIcon type={item.testCase?.taskType} aria-hidden="true" />{questionGroup(item.testCase?.taskType)}</Badge>
          <ResultChip value={result} />
        </div>
        <SheetTitle className="text-base">{definition.title || item.testCase?.caseKey || 'Question'}</SheetTitle>
        <SheetDescription>{definition.expectedBehavior || 'What happened when CovAI asked this question.'}</SheetDescription>
      </SheetHeader>
      <SheetBody>
        <section className="space-y-3">
          <SectionLabel>Checks</SectionLabel>
          <div className="space-y-2">
            {checks.map(check => (
              <div key={check.id || check.criterionKey} className="space-y-2 rounded-lg border border-[var(--color-border)] p-3.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium">{criterionLabel(check.criterionKey)}</span>
                  <ResultChip value={check.status} />
                  {Number.isFinite(check.score) && <span className="ml-auto font-mono text-xs tabular-nums text-[var(--color-text-muted)]">{numberText(check.score)}/100</span>}
                </div>
                {check.status === 'ERROR' ? (
                  <>
                    <p className="text-sm leading-relaxed text-[var(--color-text-secondary)]">The grading AI was busy or unavailable, so this wasn't graded. Use Grade again above.</p>
                    {check.reason && (
                      <details>
                        <summary className="cursor-pointer text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)]">Technical details</summary>
                        <p className="mt-2 whitespace-pre-wrap break-all rounded-md bg-[var(--color-surface-secondary)] p-2.5 font-mono text-xs text-[var(--color-text-muted)]">{check.reason}</p>
                      </details>
                    )}
                  </>
                ) : check.reason && <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-[var(--color-text-secondary)]">{check.reason}</p>}
                <details className="group">
                  <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 text-xs font-medium text-[var(--color-text-muted)] hover:text-[var(--color-text)]">
                    <MessageSquareWarning className="size-3.5" aria-hidden="true" />
                    {check.reviews?.length ? `Your reviews (${check.reviews.length})` : 'Disagree? Add your review'}
                  </summary>
                  <div className="mt-3 space-y-3 border-t border-[var(--color-border)] pt-3">
                    {(check.reviews || []).slice(0, 3).map(review => (
                      <div key={review.id} className="space-y-1">
                        <ResultChip value={review.verdict} />
                        <p className="whitespace-pre-wrap break-words text-sm text-[var(--color-text-secondary)]">{review.rationale}</p>
                      </div>
                    ))}
                    <ReviewForm criterionId={check.id} api={api} act={act} busy={busy} />
                  </div>
                </details>
              </div>
            ))}
            {hidden > 0 && <p className="text-xs text-[var(--color-text-muted)]"><span className="font-mono tabular-nums">{hidden}</span> checks don't apply to this question type.</p>}
          </div>
        </section>

        <section className="space-y-3">
          <SectionLabel>Conversation</SectionLabel>
          {!conversations.length && turns.map((turn, index) => <ChatLine key={index} who="user">{turn.content}</ChatLine>)}
          {!conversations.length && <p className="text-sm text-[var(--color-text-muted)]">No answers recorded.</p>}
          {conversations.map((record, index) => (
            <div key={record.id || index} className="space-y-3 rounded-lg border border-[var(--color-border)] p-3.5">
              {conversations.length > 1 && <p className="text-xs font-medium text-[var(--color-text-muted)]">Attempt <span className="font-mono tabular-nums">{record.payload?.repetition ?? index + 1}</span></p>}
              {(record.payload?.responses || []).map((response, turnIndex) => (
                <div key={turnIndex} className="space-y-3">
                  <ChatLine who="user">{turns[turnIndex]?.content}</ChatLine>
                  <ChatLine who="bot"><AnswerText>{response.answer}</AnswerText></ChatLine>
                </div>
              ))}
              {record.payload?.errorMessage && <p className="rounded-md border border-rose-500/20 bg-rose-500/10 px-3 py-2 text-sm text-rose-400">{record.payload.errorMessage}</p>}
            </div>
          ))}
        </section>

        {definition.sourceQuote && (
          <section className="space-y-3">
            <SectionLabel className="flex items-center gap-2"><FileText className="size-3.5" aria-hidden="true" />From your documents</SectionLabel>
            <blockquote className="whitespace-pre-wrap break-words border-l-2 border-[var(--color-border-strong)] pl-4 text-sm leading-relaxed text-[var(--color-text-secondary)]">{definition.sourceQuote}</blockquote>
            {definition.referenceUnverified && <Badge variant="warning">Quote not found word for word</Badge>}
          </section>
        )}
      </SheetBody>
    </>
  );
}

function ChatLine({ who, children }) {
  const user = who === 'user';
  const Icon = user ? User : Bot;
  return (
    <div className="flex items-start gap-3">
      <span className={cn('mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md border',
        user ? 'border-[var(--color-border)] bg-[var(--color-surface-secondary)] text-[var(--color-text-secondary)]'
          : 'border-[var(--color-primary)]/30 bg-[var(--color-primary)]/10 text-[var(--color-primary)]')}>
        <Icon className="size-3.5" aria-hidden="true" />
      </span>
      <div className={cn('min-w-0 flex-1 text-sm leading-relaxed', user ? 'text-[var(--color-text)]' : 'text-[var(--color-text-secondary)]')}>{children}</div>
    </div>
  );
}
