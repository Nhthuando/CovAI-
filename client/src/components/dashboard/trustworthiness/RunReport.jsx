import { Clock3, ListChecks, Repeat2, Scale } from 'lucide-react';
import { BarList, CategoryBar, ProgressCircle } from '../../ui/tremor';
import { Hint } from '../../ui/tooltip';
import { cn } from '../../../lib/utils';
import RunDiagnostics from './RunDiagnostics';
import { numberText, percentText, interactive } from './evaluationTheme';
import { criterionLabel } from './criterionLabels';
import { questionGroup, questionResult, reportVerdict, seconds, verdictChecks } from './reportHelpers';
import { ReportMetric } from './reportUi';
import { groupIcon } from './questionIcons';

const pct = value => `${numberText(value * 100)}%`;
const toneColor = { emerald: 'success', rose: 'danger', amber: 'warning' };
const heroTone = {
  emerald: 'border-emerald-500/25',
  rose: 'border-rose-500/25',
  amber: 'border-amber-500/25',
};
const barTone = value => (value >= 80 ? 'bg-emerald-500/15' : value >= 50 ? 'bg-amber-500/15' : 'bg-rose-500/15');

function passRate(statuses) {
  const graded = statuses.filter(status => status === 'PASSED' || status === 'FAILED');
  return graded.length ? graded.filter(status => status === 'PASSED').length / graded.length * 100 : null;
}

function OracleAgreement({ agreement }) {
  if (!agreement?.n) return null;
  const agreed = agreement.confusion.tp + agreement.confusion.tn;
  return (
    <section className="space-y-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
      <div className="flex items-center gap-2">
        <Scale className="size-4 text-[var(--color-text-muted)]" aria-hidden="true" />
        <h2 className="text-sm font-semibold tracking-tight">Rules vs grading AI</h2>
      </div>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="font-mono text-2xl font-semibold tabular-nums">{Number.isFinite(agreement.agreement) ? pct(agreement.agreement) : '—'}</span>
        <span className="text-sm text-[var(--color-text-muted)]">
          agreement on <span className="font-mono tabular-nums">{agreed}</span> of <span className="font-mono tabular-nums">{agreement.n}</span> questions with exact facts
          {Number.isFinite(agreement.kappa) && <> · kappa <span className="font-mono tabular-nums">{numberText(agreement.kappa, 2)}</span></>}
        </span>
      </div>
      {agreement.confusion.fp > 0 && (
        <p className="rounded-md border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-sm text-amber-400">
          The grading AI passed <span className="font-mono tabular-nums">{agreement.confusion.fp}</span> answer(s) where the rule check found a wrong or missing number.
        </p>
      )}
      <p className="text-xs text-[var(--color-text-muted)]">The rule check reads prices, days and hotlines without AI, so it shows where the grading AI may be too lenient.</p>
    </section>
  );
}

export default function RunReport({ run, api, act, busy, actions, notices }) {
  const summary = run.summary || {};
  const latency = summary.latency;
  const verdict = reportVerdict(run);
  const interval = summary.scenarioPassRate?.wilson95;
  const cases = run.cases || [];
  const results = cases.map(questionResult);
  const graded = results.filter(status => status === 'PASSED' || status === 'FAILED').length;
  const passed = results.filter(status => status === 'PASSED').length;
  const failed = results.filter(status => status === 'FAILED').length;
  const allChecks = cases.flatMap(verdictChecks).filter(check => check.status !== 'NOT_APPLICABLE');
  const gradedChecks = allChecks.filter(check => check.status === 'PASSED' || check.status === 'FAILED').length;
  const hasKeyFacts = cases.some(item => (item.criteria || []).some(check => check.criterionKey === 'keyFacts'));
  const checkKeys = [
    ...(summary.criteriaBreakdown || []).map(row => row.criterionKey).filter(key => key !== 'keyFacts'),
    ...(hasKeyFacts ? ['keyFacts'] : []),
  ];
  const corrections = run.judgeCorrection?.byCriterion || {};
  const needsCalibration = Object.values(corrections).some(item => item?.status === 'NOT_ENOUGH_CALIBRATION');
  const lower = interval?.lower ?? interval?.low;
  const upper = interval?.upper ?? interval?.high;
  const score = gradedChecks > 0 && Number.isFinite(summary.score) ? summary.score : null;

  const groupRows = (summary.tasks || []).map(row => {
    const value = passRate(cases.filter(item => questionGroup(item.testCase?.taskType) === questionGroup(row.taskType)).map(questionResult));
    return { key: row.taskType, name: questionGroup(row.taskType), value, icon: groupIcon(row.taskType), emptyLabel: 'Not graded', barClassName: Number.isFinite(value) ? barTone(value) : undefined };
  });
  const checkRows = checkKeys.map(key => {
    const value = passRate(cases.flatMap(item => item.criteria || []).filter(check => check.criterionKey === key).map(check => check.status));
    return { key, name: criterionLabel(key), value, emptyLabel: 'Not graded', barClassName: Number.isFinite(value) ? barTone(value) : undefined };
  });
  const corrected = checkKeys.map(key => [key, corrections[key]]).filter(([, item]) => item?.status === 'CORRECTED');

  return (
    <div className="space-y-5">
      <section className={cn('flex flex-wrap items-center gap-x-6 gap-y-5 rounded-lg border bg-[var(--color-surface)] p-5', heroTone[verdict.tone] || 'border-[var(--color-border)]')}>
        <ProgressCircle value={score ?? 0} radius={46} strokeWidth={7} color={toneColor[verdict.tone] || 'primary'}>
          <span className="font-mono text-2xl font-semibold tabular-nums">{score != null ? numberText(score, 0) : '—'}</span>
          <span className="text-[10px] uppercase tracking-wider text-[var(--color-text-muted)]">score</span>
        </ProgressCircle>
        <div className="min-w-[220px] flex-1 space-y-1.5">
          <h2 className="text-lg font-semibold tracking-tight">{verdict.title}</h2>
          <p className="max-w-2xl break-words text-sm text-[var(--color-text-muted)]">{verdict.body}</p>
          <p className="text-xs text-[var(--color-text-muted)]">Pass mark <span className="font-mono tabular-nums text-[var(--color-text-secondary)]">{verdict.passMark ?? '—'}</span></p>
        </div>
        {actions}
      </section>

      {notices}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <ReportMetric icon={ListChecks} label="Questions passed" value={graded > 0 ? <>{passed}<span className="text-base text-[var(--color-text-muted)]">/{graded}</span></> : '—'}>
          <CategoryBar segments={[
            { label: 'Passed', value: passed, color: 'success' },
            { label: 'Failed', value: failed, color: 'danger' },
            { label: 'Not graded', value: cases.length - graded, color: 'warning' },
          ]} />
          {Number.isFinite(lower) && Number.isFinite(upper)
            ? <Hint text="If you ran these questions many times, the true pass rate would fall in this range 95% of the time.">
              <p className="w-fit cursor-help underline decoration-dotted underline-offset-2">95% range {numberText(lower * 100, 0)}–{numberText(upper * 100, 0)}%</p>
            </Hint>
            : <p>{graded ? `${cases.length - graded} not graded` : 'No questions graded yet'}</p>}
        </ReportMetric>
        <ReportMetric icon={Scale} label="Checks graded" value={allChecks.length ? <>{gradedChecks}<span className="text-base text-[var(--color-text-muted)]">/{allChecks.length}</span></> : '—'}>
          <CategoryBar segments={[
            { label: 'Graded', value: gradedChecks, color: 'primary' },
            { label: 'Not graded', value: allChecks.length - gradedChecks, color: 'warning' },
          ]} />
          <p>{allChecks.length - gradedChecks ? `${allChecks.length - gradedChecks} couldn't be graded` : 'Every check was graded'}</p>
        </ReportMetric>
        <ReportMetric icon={Repeat2} label="Consistency" value={graded > 0 && Number.isFinite(summary.stability?.stabilityRate) ? percentText(summary.stability.stabilityRate) : '—'}>
          <p>Same verdict when asked again</p>
        </ReportMetric>
        <ReportMetric icon={Clock3} label="Reply time" value={Number.isFinite(latency?.avgMs) ? `${seconds(latency.avgMs)}s` : '—'}
          danger={Number.isFinite(latency?.avgMs) && Number.isFinite(latency?.slaMs) && latency.avgMs > latency.slaMs}>
          <p>
            {Number.isFinite(latency?.p95Ms) && <>Slowest 5% {seconds(latency.p95Ms)}s</>}
            {Number.isFinite(latency?.slaMs) && <> · target {seconds(latency.slaMs)}s</>}
          </p>
        </ReportMetric>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="space-y-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
          <div className="flex items-baseline justify-between">
            <h2 className="text-sm font-semibold tracking-tight">By question group</h2>
            <span className="text-xs text-[var(--color-text-muted)]">Pass rate</span>
          </div>
          {groupRows.length ? <BarList data={groupRows} valueFormatter={value => `${numberText(value, 0)}%`} />
            : <p className="text-sm text-[var(--color-text-muted)]">No scores available.</p>}
        </section>
        <section className="space-y-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
          <div className="flex items-baseline justify-between">
            <h2 className="text-sm font-semibold tracking-tight">By check</h2>
            <span className="text-xs text-[var(--color-text-muted)]">Pass rate</span>
          </div>
          {checkRows.length ? <BarList data={checkRows} valueFormatter={value => `${numberText(value, 0)}%`} />
            : <p className="text-sm text-[var(--color-text-muted)]">No scores available.</p>}
          {corrected.length > 0 && (
            <div className="space-y-1.5 border-t border-[var(--color-border)] pt-3 text-xs text-[var(--color-text-muted)]">
              <p className="font-medium text-[var(--color-text-secondary)]">Corrected for grading-AI mistakes</p>
              {corrected.map(([key, item]) => (
                <p key={key} className="flex justify-between gap-3">
                  <span>{criterionLabel(key)}</span>
                  <span className="font-mono tabular-nums">{pct(item.corrected)} <span className="opacity-70">({pct(item.ci95[0])}–{pct(item.ci95[1])})</span></span>
                </p>
              ))}
            </div>
          )}
          {needsCalibration && (
            <p className="border-t border-[var(--color-border)] pt-3 text-xs text-[var(--color-text-muted)]">
              Grade 10 good and 10 bad answers in Check the grading AI to see corrected rates.
            </p>
          )}
        </section>
      </div>

      <RunDiagnostics run={run} api={api} act={act} busy={busy} />
      <OracleAgreement agreement={run.oracleAgreement} />

      <details className="group rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-5 py-4">
        <summary className={`cursor-pointer list-none rounded-md text-sm font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-text)] ${interactive}`}>
          Notes and limitations
        </summary>
        <ul className="mt-3 list-disc space-y-1.5 pl-5 text-sm text-[var(--color-text-muted)]">
          <li>Questions written by AI and grades from the grading AI are a reference, not a replacement for an expert check.</li>
          <li><span className="font-mono tabular-nums">{run.unverifiedReferenceCount ?? 0}</span> questions use a quote that wasn't found word for word in your documents.</li>
          <li><span className="font-mono tabular-nums">{verdict.errors}</span> checks couldn't be graded.</li>
          {run.knowledgeProbeSkipped && <li>The document readiness check was skipped for this run.</li>}
          {(run.limitations || []).map((limitation, index) => <li key={index}>{limitation}</li>)}
        </ul>
      </details>
    </div>
  );
}
