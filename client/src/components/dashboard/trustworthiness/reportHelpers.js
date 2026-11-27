import { groupLabel } from './criterionLabels';

export function questionGroup(key) {
  return groupLabel(String(key || '').trim().replace(/([a-z])([A-Z])/g, '$1_$2').replace(/[ -]+/g, '_').toUpperCase());
}
export function runDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Date unavailable';
  const pad = n => String(n).padStart(2, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())} · ${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()}`;
}
export function runStatus(run, live) {
  const status = live?.executionStatus || run.executionStatus;
  if (['RUNNING', 'QUEUED'].includes(status)) return { label: 'Running…', tone: 'sky', running: true };
  if (['CANCELED', 'CANCELLED'].includes(status)) return { label: 'Cancelled', tone: null };
  if (['ERROR', 'FAILED'].includes(status)) return { label: 'Stopped early', tone: 'rose' };
  const verdict = run.summary?.verdict || run.verdict;
  // INDETERMINATE with a verdict: every question was graded before the run lost its lease.
  const graded = status === 'COMPLETED' || status === 'INDETERMINATE';
  if (graded && verdict === 'PASSED') return { label: 'Passed', tone: 'emerald' };
  if (graded && verdict === 'FAILED') return { label: "Didn't pass", tone: 'rose' };
  return { label: 'No verdict yet', tone: 'amber' };
}
// The rule-based keyFacts check is reported on its own; it never decides a question's result.
export const verdictChecks = item => (item.criteria || []).filter(check => check.criterionKey !== 'keyFacts');
export function questionResult(item) {
  const checks = verdictChecks(item);
  if (item.verdict === 'FAILED' || checks.some(check => check.status === 'FAILED')) return 'FAILED';
  if (['ERROR', 'INSUFFICIENT_EVIDENCE'].includes(item.verdict)) return item.verdict;
  if (checks.some(check => check.status === 'ERROR')) return 'ERROR';
  if (checks.some(check => check.status === 'INSUFFICIENT_EVIDENCE')) return 'INSUFFICIENT_EVIDENCE';
  return item.verdict === 'PASSED' ? 'PASSED' : 'ERROR';
}
export function seconds(value) { return Number.isFinite(value) ? (value / 1000).toFixed(1) : '—'; }
export function representativeScore(summary) {
  const raw = Number.isFinite(summary?.score) ? summary.score : null;
  const completeness = summary?.completeness;
  const scored = Number.isFinite(completeness?.scored) ? completeness.scored : 0;
  const applicable = Number.isFinite(completeness?.applicable) ? completeness.applicable : 0;
  const partial = summary?.partial === true || (applicable > 0 && scored < applicable);
  const hidden = raw === null || (partial && applicable > 0 && (
    scored / applicable < 0.8 || (summary.tasks || []).some(task => task.applicable > 0 && task.score == null)
  ));
  return { value: hidden ? null : raw, raw, partial, hidden, scored, applicable };
}

const isUngraded = item => !['PASSED', 'FAILED'].includes(questionResult(item));
const rateLimitMessage = "Your chatbot's AI key hit its request limit (429).";

export function rateLimited(run) {
  return (run.cases || []).some(isUngraded) && (run.summary?.rateLimit?.hits > 0 ||
    (run.evidence || []).some(record => /\b429\b|quota|rate.?limit|RESOURCE_EXHAUSTED/i.test(record.payload?.errorMessage)));
}

// Why a run stopped, in plain words; the runner's raw message carries chatbot log lines.
function stopReason(run) {
  const summary = run.summary || {};
  if ((run.errorCode || summary.errorCode) === 'KNOWLEDGE_NOT_READY' || /Knowledge readiness probe failed/i.test(summary.failureMessage || run.errorMessage || '')) {
    return "Your chatbot couldn't answer sample questions from your business documents, so the run stopped before grading.";
  }
  const message = run.errorMessage || summary.failureMessage;
  return message ? String(message).split(/\.\s+Chatbot log:/)[0] : 'No error details are available.';
}

export function reportVerdict(run) {
  const summary = run.summary || {};
  const cases = run.cases || [];
  const checks = cases.flatMap(verdictChecks);
  const errors = checks.filter(check => check.status === 'ERROR').length || run.errorCriteriaCount || 0;
  const insufficient = checks.filter(check => check.status === 'INSUFFICIENT_EVIDENCE').length;
  const passMark = summary.passMark ?? summary.passThreshold ?? run.manifest?.scoring?.threshold ?? run.profileVersion?.config?.passThreshold;
  const failed = cases.filter(item => questionResult(item) === 'FAILED').length;
  const ungraded = cases.filter(isUngraded).length;
  const limited = rateLimited(run);
  const blockingReason = Array.isArray(summary.blockingReasons) ? summary.blockingReasons.find(reason => typeof reason === 'string' || reason?.reason) : null;
  const reason = typeof blockingReason === 'string' ? blockingReason : blockingReason?.reason;
  if (['ERROR', 'FAILED', 'CANCELED', 'CANCELLED'].includes(run.executionStatus)) return {
    title: 'The evaluation stopped early', body: stopReason(run), tone: 'rose', passMark, errors,
  };
  if ((summary.verdict || run.verdict) === 'PASSED') return {
    title: 'Your chatbot passed', body: `It met the pass mark of ${passMark ?? '—'}/100 across ${cases.length} questions.`, tone: 'emerald', passMark, errors,
  };
  if ((summary.verdict || run.verdict) === 'FAILED') return {
    title: "Your chatbot didn't pass", tone: 'rose', passMark, errors,
    body: [`${failed} ${failed === 1 ? 'question' : 'questions'} failed.`, reason,
      // Score above the pass mark but FAILED: say it was the safety rule, not the score.
      summary.criticalSafetyFailure || summary.blockingFailures?.length
        ? `A tricky or unsafe request was not handled safely; this fails the run whatever the score${Number.isFinite(summary.score) && passMark != null && summary.score >= passMark ? ` (${Math.round(summary.score)}/100)` : ''}.`
        : '',
      ungraded ? `${ungraded} ${ungraded === 1 ? 'question' : 'questions'} couldn't be graded.` : '',
      limited ? rateLimitMessage : ''].filter(Boolean).join(' '),
  };
  return {
    title: 'No verdict yet', tone: 'amber', passMark, errors,
    body: [errors ? `${errors} checks couldn't be graded because the grading AI was busy or unavailable.` : '',
      insufficient ? `${insufficient} checks had too few answers because your chatbot returned errors.` : '',
      limited ? `${rateLimitMessage} Wait a minute and run again, or use a key with a higher limit.`
        : 'Try again later, when the AI service is less busy.'].filter(Boolean).join(' '),
  };
}
