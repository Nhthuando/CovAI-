import { ArrowUpRight, FileCode2 } from 'lucide-react';

export default function SystemTestGapNavigator({ gaps, onOpenFile }) {
  const groups = Map.groupBy(gaps, gap => gap.filePath || 'Other findings');
  return <details className="border-t border-[var(--color-border)] pt-4">
    <summary className="cursor-pointer font-medium">Uncovered code & assertion findings ({gaps.length})</summary>
    <p className="mt-3 text-xs text-[var(--color-text-muted)]">Select a line to open it in Explorer.</p>
    <div className="mt-3 max-h-80 overflow-y-auto space-y-3 pr-1">{[...groups].map(([file, entries]) => <div key={file} className="rounded-[var(--radius-md)] border border-[var(--color-border)]">
      <div className="flex items-start justify-between gap-3 bg-[var(--color-surface-secondary)] px-3 py-3"><span className="flex min-w-0 items-start gap-2"><FileCode2 size={14} className="shrink-0 mt-0.5" /><span className="font-mono text-xs break-all">{file}</span></span><span className="shrink-0 text-[10px] text-[var(--color-text-muted)]">{entries.length} findings</span></div>
      <ul className="divide-y divide-[var(--color-border)]">{entries.map(gap => <li key={gap.id} className="flex items-start gap-3 p-3">
        {gap.filePath && <button type="button" disabled={!onOpenFile} onClick={() => onOpenFile?.(gap.filePath, gap.line || 1)} title={`Open ${gap.filePath}:${gap.line || 1}`} className="inline-flex shrink-0 items-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface-secondary)] px-2.5 py-1.5 text-xs text-[var(--color-text)] hover:border-[var(--color-primary)] focus-visible:outline-2 focus-visible:outline-[var(--color-focus)]">Line {gap.line || 1}<ArrowUpRight size={13} /></button>}
        <p className="min-w-0 text-xs leading-relaxed text-[var(--color-text-muted)]">{gap.description}</p>
      </li>)}</ul>
    </div>)}</div>
    {!gaps.length && <p className="mt-3 text-xs text-[var(--color-text-muted)]">No gaps identified in the measured scope. This does not prove complete correctness.</p>}
  </details>;
}
