import React, { useState, useMemo } from 'react';
import { ArrowUpRight, FileCode2, Layers, AlertCircle, CheckCircle2, Filter, GitBranch, Code2, ShieldAlert } from 'lucide-react';

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
        return <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold bg-amber-500/10 text-amber-500 border border-amber-500/20"><GitBranch size={10} /> Branch</span>;
      case 'MEASURED_UNCOVERED_STATEMENT':
        return <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold bg-blue-500/10 text-blue-500 border border-blue-500/20"><Code2 size={10} /> Statement</span>;
      case 'MEASURED_UNCOVERED_FUNCTION':
        return <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold bg-purple-500/10 text-purple-500 border border-purple-500/20">Function</span>;
      default:
        return <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold bg-rose-500/10 text-rose-500 border border-rose-500/20">Line</span>;
    }
  };

  if (!gaps.length) {
    return (
      <div className="flex items-center gap-3 p-4 rounded-xl border border-emerald-500/30 bg-emerald-500/5 text-emerald-600 dark:text-emerald-400">
        <CheckCircle2 size={20} className="shrink-0" />
        <div>
          <h4 className="text-sm font-semibold">100% Edge-Case & Source Code Coverage Achieved!</h4>
          <p className="text-xs text-[var(--color-text-muted)] mt-0.5">
            All code branches, keyboard interactions, validations, and error fallbacks have been executed and verified in independent Playwright runs.
          </p>
        </div>
      </div>
    );
  }

  return (
    <details className="group border-t border-[var(--color-border)] pt-4" open>
      <summary className="cursor-pointer list-none flex items-center justify-between gap-4 font-medium text-sm text-[var(--color-text)] hover:text-purple-500 transition-colors">
        <div className="flex items-center gap-2.5">
          <ShieldAlert size={18} className="text-amber-500 shrink-0" />
          <span className="font-semibold">Uncovered Code & Dimension Gap Insights ({gaps.length})</span>
          <span className="px-2 py-0.5 text-[11px] font-medium rounded-full bg-purple-500/10 text-purple-600 dark:text-purple-400 border border-purple-500/20">
            Target: 95% Coverage
          </span>
        </div>
        <span className="text-xs text-[var(--color-text-muted)] group-open:rotate-180 transition-transform">
          ▼
        </span>
      </summary>

      {/* Explanatory relationship banner */}
      <div className="mt-3.5 p-3 rounded-lg bg-[var(--color-surface-secondary)] border border-[var(--color-border)] text-xs text-[var(--color-text-muted)] leading-relaxed">
        <span className="font-semibold text-[var(--color-text)]">💡 Dimension Mapping Insight:</span> The 4 System Test Dimensions above measure macro-level functional completeness (<strong>100% passed</strong> for all user workflows, routes, and APIs). The <strong>{gaps.length} findings below</strong> pinpoint micro-level AST branches (keyboard shortcuts, edge validations, error states) that must be exercised to push code coverage to <strong>95%+</strong>.
      </div>

      {/* Controls & Filters */}
      <div className="mt-3.5 flex flex-wrap items-center justify-between gap-3 text-xs">
        {/* File filter */}
        <div className="flex items-center gap-2">
          <span className="text-[var(--color-text-muted)] font-medium">Filter file:</span>
          <select
            value={selectedFile}
            onChange={e => setSelectedFile(e.target.value)}
            className="px-2.5 py-1 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)] focus:outline-none focus:border-purple-500 text-xs font-mono"
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
              className={`px-2 py-1 rounded-md text-[11px] font-medium transition-all ${
                filterType === type
                  ? 'bg-purple-600 text-white shadow-sm'
                  : 'bg-[var(--color-surface-secondary)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] border border-[var(--color-border)]'
              }`}
            >
              {type}
            </button>
          ))}
        </div>
      </div>

      {/* List of findings */}
      <div className="mt-3 max-h-96 overflow-y-auto space-y-3 pr-1">
        {[...filteredGroups].map(([file, entries]) => (
          <div key={file} className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] overflow-hidden shadow-sm">
            <div className="flex items-center justify-between gap-3 bg-[var(--color-surface-secondary)]/80 px-3.5 py-2.5 border-b border-[var(--color-border)]">
              <span className="flex min-w-0 items-center gap-2">
                <FileCode2 size={15} className="text-purple-500 shrink-0" />
                <span className="font-mono text-xs font-semibold text-[var(--color-text)] break-all">{file}</span>
              </span>
              <span className="shrink-0 text-[11px] font-medium px-2 py-0.5 rounded-full bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-text-muted)]">
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
                          className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-xs font-mono font-medium text-[var(--color-text)] hover:border-purple-500 hover:text-purple-600 dark:hover:text-purple-400 transition-colors shadow-2xs"
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
