export const interactive =
  'transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-[var(--color-focus)]/50';
export const buttonClass = `${interactive} active:scale-[0.98] rounded-md`;
// Matches the shadcn/ui Input in components/ui/input.jsx.
export const inputClass =
  'w-full min-w-0 rounded-md border border-[var(--color-border)] bg-[var(--color-surface-secondary)] px-3 py-2 text-sm leading-relaxed text-[var(--color-text)] placeholder:text-[var(--color-text-muted)] transition-colors duration-150 outline-none hover:border-[var(--color-border-strong)] focus-visible:border-[var(--color-primary)]/60 focus-visible:ring-2 focus-visible:ring-[var(--color-focus)]/30 disabled:cursor-not-allowed disabled:opacity-60';
export const tones = {
  emerald: 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20',
  rose: 'bg-rose-500/10 text-rose-400 border border-rose-500/20',
  amber: 'bg-amber-500/10 text-amber-400 border border-amber-500/20',
  sky: 'bg-sky-500/10 text-sky-400 border border-sky-500/20',
};

export const taskLabels = {
  HAPPY_PATH: 'Happy path',
  MULTI_TURN: 'Multi-turn',
  OUT_OF_SCOPE: 'Out of scope',
  ADVERSARIAL: 'Adversarial',
  KNOWLEDGE_QA: 'Knowledge Q&A',
  USAGE_GUIDANCE: 'Usage guidance',
  ACTION_TOOL: 'Action tool',
};
export const verdicts = ['PASSED', 'FAILED', 'INSUFFICIENT_EVIDENCE', 'NOT_APPLICABLE'];
export const statusText = value => String(value || 'NOT_EVALUATED').replaceAll('_', ' ');
export const numberText = (value, digits = 1) => Number.isFinite(value) ? value.toFixed(digits) : '—';
export const percentText = value => Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : '—';
export const intervalText = interval => interval
  ? `95% CI: ${percentText(interval.lower)} – ${percentText(interval.upper)}`
  : '95% CI: —';
