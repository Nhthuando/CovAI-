import { Eye, Pencil, TriangleAlert } from 'lucide-react';
import { Badge } from '../../ui/badge';
import { Button } from '../../ui/button';
import { cn } from '../../../lib/utils';
import { questionTypes } from './questionLabels';
import { createElement } from 'react';
import { groupIcon, firstUserMessage } from './questionIcons';
import QuestionPreview from './QuestionPreview';

export function GroupIcon({ type, ...props }) {
  return createElement(groupIcon(type), props);
}

// Filter chips above the list: label + count, like Linear's view filters.
export function QuestionFilters({ filters, value, onChange }) {
  return (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter questions">
      {filters.map(({ key, label, count, icon: Icon, warn }) => (
        <button key={key} type="button" aria-pressed={value === key} onClick={() => onChange(key)}
          className={cn('inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-md border px-2 text-xs font-medium transition-colors duration-150 outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus)]/50',
            value === key
              ? 'border-[var(--color-primary)]/40 bg-[var(--color-primary)]/10 text-[var(--color-text)]'
              : 'border-[var(--color-border)] text-[var(--color-text-muted)] hover:border-[var(--color-border-strong)] hover:text-[var(--color-text)]')}>
          {Icon && <Icon className={cn('size-3.5', warn && 'text-amber-400')} aria-hidden="true" />}
          {label}
          <span className="font-mono tabular-nums text-[var(--color-text-muted)]">{count}</span>
        </button>
      ))}
    </div>
  );
}

export function QuestionListItem({ item, index, selected, onSelect }) {
  return (
    <button type="button" onClick={onSelect} aria-current={selected ? 'true' : undefined}
      className={cn('group flex w-full min-w-0 cursor-pointer items-start gap-3 border-l-2 px-3.5 py-3 text-left transition-colors duration-150 outline-none focus-visible:bg-[var(--color-surface-secondary)]',
        selected
          ? 'border-l-[var(--color-primary)] bg-[var(--color-surface-secondary)]'
          : 'border-l-transparent hover:bg-[var(--color-surface-secondary)]/60')}>
      <span className="mt-0.5 w-5 shrink-0 text-right font-mono text-xs tabular-nums text-[var(--color-text-muted)]">{index + 1}</span>
      <GroupIcon type={item.taskType} className={cn('mt-0.5 size-4 shrink-0', selected ? 'text-[var(--color-primary)]' : 'text-[var(--color-text-muted)]')} aria-hidden="true" />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className={cn('truncate text-sm', selected ? 'font-medium text-[var(--color-text)]' : 'text-[var(--color-text-secondary)]')}>{item.title}</span>
          {item.referenceUnverified && <TriangleAlert className="size-3.5 shrink-0 text-amber-400" aria-label="Source not verified" />}
        </span>
        <span className="mt-0.5 block truncate text-xs text-[var(--color-text-muted)]">{firstUserMessage(item)}</span>
      </span>
    </button>
  );
}

export function QuestionDetailHeader({ item, index, editing, onToggleEdit, canEdit, actions }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--color-border)] px-5 py-4">
      <div className="min-w-0 space-y-1.5">
        <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--color-text-muted)]">
          <span className="font-mono tabular-nums">#{index + 1}</span>
          <Badge variant="outline"><GroupIcon type={item.taskType} aria-hidden="true" />{questionTypes[item.taskType] || item.taskType}</Badge>
        </div>
        <h3 className="text-base font-semibold leading-snug tracking-tight">{item.title}</h3>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {actions}
        {canEdit && (
          <Button variant="secondary" size="sm" onClick={onToggleEdit}>
            {editing ? <><Eye aria-hidden="true" />Preview</> : <><Pencil aria-hidden="true" />Edit</>}
          </Button>
        )}
      </div>
    </div>
  );
}

// Read-only list used for AI proposals: compact rows with an inline preview of the selected one.
export function QuestionStack({ items, selectedIndex, onSelect }) {
  return (
    <div className="divide-y divide-[var(--color-border)] overflow-hidden rounded-lg border border-[var(--color-border)]">
      {items.map((item, index) => (
        <div key={item.caseKey || index}>
          <QuestionListItem item={item} index={index} selected={selectedIndex === index}
            onSelect={() => onSelect(selectedIndex === index ? null : index)} />
          {selectedIndex === index && <div className="border-t border-[var(--color-border)] bg-[var(--color-surface)] p-5"><QuestionPreview item={item} /></div>}
        </div>
      ))}
    </div>
  );
}
