import { Tooltip, TooltipContent, TooltipTrigger } from './tooltip';
import { cn } from '../../lib/utils';

// Tremor Raw dashboard components (ProgressCircle, Tracker, BarList, CategoryBar),
// ported to CovAI tokens. Colors use semantic names so they follow the theme.
const strokeColor = {
  primary: 'stroke-[var(--color-primary)]',
  success: 'stroke-emerald-400',
  danger: 'stroke-rose-400',
  warning: 'stroke-amber-400',
  neutral: 'stroke-[var(--color-text-muted)]',
};
const fillColor = {
  primary: 'bg-[var(--color-primary)]',
  success: 'bg-emerald-400',
  danger: 'bg-rose-400',
  warning: 'bg-amber-400',
  info: 'bg-sky-400',
  neutral: 'bg-[var(--color-border-strong)]',
};

export function ProgressCircle({ value = 0, max = 100, radius = 48, strokeWidth = 8, color = 'primary', className, children }) {
  const safe = Math.min(max, Math.max(0, Number.isFinite(value) ? value : 0));
  const normalized = radius - strokeWidth / 2;
  const circumference = normalized * 2 * Math.PI;
  const offset = circumference - (safe / max) * circumference;
  return (
    <div className={cn('relative inline-flex items-center justify-center', className)} role="progressbar"
      aria-valuenow={safe} aria-valuemin={0} aria-valuemax={max}>
      <svg width={radius * 2} height={radius * 2} viewBox={`0 0 ${radius * 2} ${radius * 2}`} className="-rotate-90">
        <circle r={normalized} cx={radius} cy={radius} strokeWidth={strokeWidth} fill="transparent"
          className="stroke-[var(--color-surface-muted)]" />
        {safe > 0 && (
          <circle r={normalized} cx={radius} cy={radius} strokeWidth={strokeWidth} fill="transparent"
            strokeDasharray={`${circumference} ${circumference}`} strokeDashoffset={offset} strokeLinecap="round"
            className={cn('transition-all duration-300 ease-in-out', strokeColor[color] || strokeColor.primary)} />
        )}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">{children}</div>
    </div>
  );
}

// Tracker: one block per item; each block has a tooltip and may be clickable.
export function Tracker({ data = [], className, onSelect }) {
  return (
    <div className={cn('flex h-8 w-full items-center gap-[3px]', className)}>
      {data.map((item, index) => {
        const block = (
          <button type="button" key={item.key ?? index} aria-label={item.tooltip}
            onClick={onSelect ? () => onSelect(item, index) : undefined}
            className={cn('h-full min-w-[6px] flex-1 rounded-[3px] outline-none transition-opacity duration-150 first:rounded-l-md last:rounded-r-md hover:opacity-70 focus-visible:ring-2 focus-visible:ring-[var(--color-focus)]/60',
              fillColor[item.color] || fillColor.neutral, onSelect ? 'cursor-pointer' : 'cursor-default')} />
        );
        if (!item.tooltip) return block;
        return (
          <Tooltip key={item.key ?? index}>
            <TooltipTrigger asChild>{block}</TooltipTrigger>
            <TooltipContent>{item.tooltip}</TooltipContent>
          </Tooltip>
        );
      })}
    </div>
  );
}

// BarList: labelled horizontal bars with a right-aligned value.
export function BarList({ data = [], valueFormatter = value => `${value}`, className, onSelect }) {
  const max = Math.max(1, ...data.map(item => (Number.isFinite(item.value) ? item.value : 0)));
  return (
    <div className={cn('space-y-1.5', className)}>
      {data.map(item => {
        const width = Number.isFinite(item.value) ? Math.max(2, (item.value / max) * 100) : 0;
        const Row = onSelect ? 'button' : 'div';
        return (
          <Row key={item.key ?? item.name} type={onSelect ? 'button' : undefined}
            onClick={onSelect ? () => onSelect(item) : undefined}
            className={cn('group flex w-full items-center gap-4 rounded-md text-left text-sm outline-none',
              onSelect && 'cursor-pointer focus-visible:ring-2 focus-visible:ring-[var(--color-focus)]/50')}>
            <div className="relative h-8 min-w-0 flex-1">
              <div className={cn('absolute inset-y-0 left-0 rounded-md transition-all duration-300', item.barClassName || 'bg-[var(--color-primary)]/15', onSelect && 'group-hover:opacity-80')}
                style={{ width: `${width}%` }} />
              <div className="relative flex h-full min-w-0 items-center gap-2 px-2.5">
                {item.icon && <item.icon className="size-4 shrink-0 text-[var(--color-text-muted)]" aria-hidden="true" />}
                <span className="truncate text-[var(--color-text)]">{item.name}</span>
              </div>
            </div>
            <span className={cn('shrink-0 font-mono tabular-nums', Number.isFinite(item.value) ? 'text-[var(--color-text)]' : 'text-[var(--color-text-muted)]')}>
              {Number.isFinite(item.value) ? valueFormatter(item.value) : (item.emptyLabel || '—')}
            </span>
          </Row>
        );
      })}
    </div>
  );
}

// CategoryBar: a single stacked bar split into coloured segments.
export function CategoryBar({ segments = [], className }) {
  const total = segments.reduce((sum, item) => sum + (item.value || 0), 0);
  if (!total) return <div className={cn('h-2 w-full rounded-md bg-[var(--color-surface-muted)]', className)} />;
  return (
    <div className={cn('flex h-2 w-full overflow-hidden rounded-md bg-[var(--color-surface-muted)]', className)}>
      {segments.filter(item => item.value > 0).map(item => (
        <div key={item.label} title={`${item.label}: ${item.value}`}
          className={cn('h-full', fillColor[item.color] || fillColor.neutral)} style={{ width: `${(item.value / total) * 100}%` }} />
      ))}
    </div>
  );
}

export function Legend({ items = [], className }) {
  return (
    <div className={cn('flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[var(--color-text-muted)]', className)}>
      {items.map(item => (
        <span key={item.label} className="inline-flex items-center gap-1.5">
          <span className={cn('size-2 rounded-[2px]', fillColor[item.color] || fillColor.neutral)} aria-hidden="true" />
          {item.label}
          {item.value != null && <span className="font-mono tabular-nums text-[var(--color-text-secondary)]">{item.value}</span>}
        </span>
      ))}
    </div>
  );
}
