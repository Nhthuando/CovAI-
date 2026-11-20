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
  if (status === 'COMPLETED' && verdict === 'PASSED') return { label: 'Passed', tone: 'emerald' };
  if (status === 'COMPLETED' && verdict === 'FAILED') return { label: "Didn't pass", tone: 'rose' };
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
export function reportVerdict(run) {
  const summary = run.summary || {};
  const cases = run.cases || [];
  const checks = cases.flatMap(verdictChecks);
  const errors = checks.filter(check => check.status === 'ERROR').length || run.errorCriteriaCount || 0;
  const insufficient = checks.filter(check => check.status === 'INSUFFICIENT_EVIDENCE').length;
  const passMark = summary.passMark ?? summary.passThreshold ?? run.manifest?.scoring?.threshold ?? run.profileVersion?.config?.passThreshold;
  const failed = cases.filter(item => questionResult(item) === 'FAILED').length;
  const blockingReason = Array.isArray(summary.blockingReasons) ? summary.blockingReasons.find(reason => typeof reason === 'string' || reason?.reason) : null;
  const reason = typeof blockingReason === 'string' ? blockingReason : blockingReason?.reason;
  if (['ERROR', 'FAILED', 'CANCELED', 'CANCELLED'].includes(run.executionStatus)) return {
    title: 'The evaluation stopped early', body: run.errorMessage || 'No error details are available.', tone: 'rose', passMark, errors,
  };
  if ((summary.verdict || run.verdict) === 'PASSED') return {
    title: 'Your chatbot passed', body: `It met the pass mark of ${passMark ?? '—'}/100 across ${cases.length} questions.`, tone: 'emerald', passMark, errors,
  };
  if ((summary.verdict || run.verdict) === 'FAILED') return {
    title: "Your chatbot didn't pass", body: `${failed} ${failed === 1 ? 'question' : 'questions'} failed.${reason ? ` ${reason}` : ''}`, tone: 'rose', passMark, errors,
  };
  return {
    title: 'No verdict yet', tone: 'amber', passMark, errors,
    body: [errors ? `${errors} checks couldn't be graded because the grading AI was busy or unavailable.` : '',
      insufficient ? `${insufficient} checks had too few answers because your chatbot returned errors.` : '',
      'Try again later, when the AI service is less busy.'].filter(Boolean).join(' '),
  };
}
