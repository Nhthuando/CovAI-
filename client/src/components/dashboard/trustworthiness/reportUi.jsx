import { Check, CircleAlert, CircleHelp, Minus, X } from 'lucide-react';
import { Badge } from '../../ui/badge';
import { cn } from '../../../lib/utils';
import { resultLabel } from './criterionLabels';

const resultStyle = {
  PASSED: { variant: 'success', icon: Check, cell: 'border-emerald-500/20 bg-emerald-500/10 text-emerald-400' },
  FAILED: { variant: 'danger', icon: X, cell: 'border-rose-500/25 bg-rose-500/15 text-rose-400' },
  ERROR: { variant: 'warning', icon: CircleAlert, cell: 'border-amber-500/20 bg-amber-500/10 text-amber-400' },
  INSUFFICIENT_EVIDENCE: { variant: 'warning', icon: CircleHelp, cell: 'border-amber-500/20 bg-amber-500/10 text-amber-400' },
  NOT_APPLICABLE: { variant: 'outline', icon: Minus, cell: 'border-transparent bg-[var(--color-surface-secondary)]/50 text-[var(--color-text-disabled)]' },
};
const styleFor = value => resultStyle[value] || resultStyle.NOT_APPLICABLE;

export function ResultChip({ value, className }) {
  const { variant, icon: Icon } = styleFor(value);
  return <Badge variant={variant} className={className}><Icon aria-hidden="true" />{resultLabel(value)}</Badge>;
}

// One square in the results matrix.
export function ResultCell({ value, label }) {
  const { cell, icon: Icon } = styleFor(value);
  return (
    <span title={label ? `${label}: ${resultLabel(value)}` : resultLabel(value)}
      className={cn('mx-auto flex h-7 w-full max-w-14 items-center justify-center rounded-md border', cell)}>
      <Icon className="size-3.5" aria-label={resultLabel(value)} />
    </span>
  );
}

export function ReportMetric({ label, value, children, danger = false, icon: Icon }) {
  return (
    <div className="min-w-0 space-y-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
      <p className="flex items-center gap-2 text-xs font-medium text-[var(--color-text-muted)]">
        {Icon && <Icon className="size-3.5" aria-hidden="true" />}{label}
      </p>
      <p className={cn('break-words font-mono text-2xl font-semibold tracking-tight tabular-nums', danger && 'text-rose-400')}>{value}</p>
      {children && <div className="space-y-1.5 text-xs text-[var(--color-text-muted)]">{children}</div>}
    </div>
  );
}
