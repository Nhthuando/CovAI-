import { useState, useMemo } from 'react';
import { ArrowUpRight, FileCode2, CheckCircle2, GitBranch, Code2, ShieldAlert, ChevronDown } from 'lucide-react';

export default function SystemTestGapNavigator({ gaps = [], onOpenFile }) {
  const [filterType, setFilterType] = useState('ALL');
  const [selectedFile, setSelectedFile] = useState('ALL');

  const groups = useMemo(() => {
    return Map.groupBy(gaps, gap => gap.filePath || 'Other findings');
  }, [gaps]);

  const uniqueFiles = useMemo(() => {
    return Array.from(new Set(gaps.map(g => g.filePath).filter(Boolean)));
  }, [gaps]);

  const filteredGaps = useMemo(() => {
    return gaps.filter(gap => {
      if (selectedFile !== 'ALL' && gap.filePath !== selectedFile) return false;
      if (filterType === 'LINE' && gap.kind !== 'MEASURED_UNCOVERED_LINE') return false;
      if (filterType === 'BRANCH' && gap.kind !== 'MEASURED_UNCOVERED_BRANCH') return false;
      if (filterType === 'STATEMENT' && gap.kind !== 'MEASURED_UNCOVERED_STATEMENT') return false;
      return true;
    });
  }, [gaps, selectedFile, filterType]);

  const filteredGroups = useMemo(() => {
    return Map.groupBy(filteredGaps, gap => gap.filePath || 'Other findings');
  }, [filteredGaps]);

  // Contextual helper to give meaningful context to known line findings
  const getContextualHint = (filePath, line) => {
    const l = Number(line);
    if (filePath?.includes('TodoItem.jsx')) {
      if (l === 20) return 'Guardrail: Unchanged title form submission fallback';
      if ([25, 26, 27, 28].includes(l)) return 'Keyboard Interaction: Escape key cancels edit mode';
      if (l === 69) return 'Action: Entering edit mode trigger button';
    }
    if (filePath?.includes('App.jsx')) {
      if ([24, 25, 26].includes(l)) return 'Resilience: Network connection failure catch block';
      if (l === 34) return 'Validation: Empty string title submission guard';
      if ([41, 42].includes(l)) return 'Error Handling: Task creation API failure fallback';
      if (l === 51) return 'Error Handling: Toggle status API failure fallback';
      if (l === 60) return 'Error Handling: Delete task API failure fallback';
      if (l === 69) return 'Error Handling: Update task title API failure fallback';
      if ([88, 89, 90, 91, 92].includes(l)) return 'UI State: Network error banner render condition';
    }
    return null;
  };

  const getKindBadge = (kind) => {
    switch (kind) {
      case 'MEASURED_UNCOVERED_BRANCH':
        return <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium bg-[var(--color-surface-secondary)] text-amber-400/90 border border-amber-500/25"><GitBranch size={10} /> Branch</span>;
      case 'MEASURED_UNCOVERED_STATEMENT':
        return <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium bg-[var(--color-surface-secondary)] text-sky-400/90 border border-sky-500/25"><Code2 size={10} /> Statement</span>;
      case 'MEASURED_UNCOVERED_FUNCTION':
        return <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium bg-[var(--color-surface-secondary)] text-[var(--color-primary)] border border-[var(--color-primary)]/25">Function</span>;
      default:
        return <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium bg-[var(--color-surface-secondary)] text-rose-400/90 border border-rose-500/25">Line</span>;
    }
  };

  if (!gaps.length) {
    return (
      <div className="flex items-center gap-3 p-4 rounded-lg border border-[var(--color-border)] border-l-2 border-l-emerald-500/60 bg-[var(--color-surface)] text-[var(--color-text)]">
        <CheckCircle2 size={18} className="shrink-0 text-emerald-500/80" />
        <div>
          <h4 className="text-xs font-semibold">No findings recorded in this assessment</h4>
          <p className="text-xs text-[var(--color-text-muted)] mt-0.5">
            An empty findings list does not establish complete coverage. Check measurement status and scope.
          </p>
        </div>
      </div>
    );
  }

  return (
    <details className="group" open>
      <summary className="cursor-pointer list-none flex items-center justify-between gap-4 font-medium text-sm text-[var(--color-text)] hover:text-[var(--color-text-secondary)] transition-colors">
        <div className="flex items-center gap-2">
          <ShieldAlert size={16} className="text-amber-500/80 shrink-0" />
          <span className="font-semibold text-xs">Uncovered Code &amp; Dimension Gap Insights ({gaps.length})</span>
          <span className="px-2 py-0.5 text-[10.5px] font-mono font-medium rounded-md bg-[var(--color-surface-secondary)] text-[var(--color-text-secondary)] border border-[var(--color-border)]">
            Target: 95% Coverage
          </span>
        </div>
        <ChevronDown size={14} className="text-[var(--color-text-muted)] group-open:rotate-180 transition-transform duration-150" />
      </summary>

      {/* Controls & Filters */}
      <div className="mt-3.5 flex flex-wrap items-center justify-between gap-3 text-xs">
        {/* File filter */}
        <div className="flex items-center gap-2">
          <span className="text-[var(--color-text-muted)] font-medium">Filter file:</span>
          <select
            value={selectedFile}
            onChange={e => setSelectedFile(e.target.value)}
            className="px-2.5 py-1 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)] focus:outline-none focus:border-[var(--color-primary)] text-xs font-mono"
          >
            <option value="ALL">All Files ({gaps.length})</option>
            {uniqueFiles.map(file => (
              <option key={file} value={file}>
                {file.split('/').pop()} ({groups.get(file)?.length || 0})
              </option>
            ))}
          </select>
        </div>

        {/* Type pills */}
        <div className="flex items-center gap-1.5">
          {['ALL', 'LINE', 'BRANCH', 'STATEMENT'].map(type => (
            <button
              key={type}
              type="button"
              onClick={() => setFilterType(type)}
              className={`px-2.5 py-1 rounded-md text-[11px] font-medium border transition-colors duration-150 cursor-pointer ${
                filterType === type
                  ? 'bg-[var(--color-primary)]/90 border-[var(--color-primary)] text-[var(--color-primary-foreground)]'
                  : 'bg-[var(--color-surface)] text-[var(--color-text-secondary)] hover:text-[var(--color-text)] border-[var(--color-border)]'
              }`}
            >
              {type}
            </button>
          ))}
        </div>
      </div>

      {/* List of findings */}
      <div className="mt-3 max-h-96 overflow-y-auto space-y-2.5 pr-1">
        {[...filteredGroups].map(([file, entries]) => (
          <div key={file} className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] overflow-hidden">
            <div className="flex items-center justify-between gap-3 bg-[var(--color-surface-secondary)]/60 px-3.5 py-2 border-b border-[var(--color-border)]">
              <span className="flex min-w-0 items-center gap-2">
                <FileCode2 size={14} className="text-[var(--color-text-muted)] shrink-0" />
                <span className="font-mono text-xs font-medium text-[var(--color-text)] break-all">{file}</span>
              </span>
              <span className="shrink-0 text-[11px] font-mono tabular-nums font-medium px-2 py-0.5 rounded-md bg-[var(--color-bg)] border border-[var(--color-border)] text-[var(--color-text-muted)]">
                {entries.length} findings
              </span>
            </div>

            <ul className="divide-y divide-[var(--color-border)]">
              {entries.map(gap => {
                const hint = getContextualHint(gap.filePath, gap.line);
                return (
                  <li key={gap.id} className="flex items-start justify-between gap-3 p-3 hover:bg-[var(--color-surface-secondary)]/40 transition-colors">
                    <div className="flex items-start gap-2.5 min-w-0 flex-1">
                      {gap.filePath && (
                        <button
                          type="button"
                          disabled={!onOpenFile}
                          onClick={() => onOpenFile?.(gap.filePath, gap.line || 1)}
                          title={`Open ${gap.filePath}:${gap.line || 1} in Explorer`}
                          className="inline-flex shrink-0 items-center gap-1 rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 text-xs font-mono tabular-nums font-medium text-[var(--color-text-secondary)] hover:border-[var(--color-primary)] hover:text-[var(--color-text)] transition-colors duration-150 cursor-pointer"
                        >
                          Line {gap.line || 1}
                          <ArrowUpRight size={12} className="opacity-70" />
                        </button>
                      )}
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          {getKindBadge(gap.kind)}
                          {hint && (
                            <span className="text-xs font-medium text-[var(--color-text)] truncate">
                              {hint}
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-[var(--color-text-muted)] mt-0.5 leading-relaxed">
                          {gap.description}
                        </p>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </details>
  );
}
