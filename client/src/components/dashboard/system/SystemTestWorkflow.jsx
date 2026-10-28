import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronDown,
  FileInput,
  Play,
  Search,
  Sparkles,
  CheckCircle2,
  AlertCircle,
  FileCode,
  ExternalLink,
  ShieldCheck,
  Edit2,
  X,
  Terminal,
  Activity,
  CheckSquare,
} from 'lucide-react';
import { systemEvidenceRequest } from '../../../services/systemTest.service.js';

const message = error => error.response?.data?.message || error.message || 'System Test request failed';
const lines = value => value.split('\n').map(line => line.trim()).filter(Boolean);
const confirmed = scenario => ['EXPECTED_CONFIRMED', 'REVIEWED'].includes(scenario.reviewState);

/**
 * Parses raw scenario title into clean method tag and human-readable title.
 * e.g. "CREATE - add a new todo item successfully" -> tag: "CREATE", cleanTitle: "Add a new todo item successfully"
 */
const parseScenarioTitle = (title) => {
  if (!title) return { tag: 'TEST', cleanTitle: 'Untitled scenario' };
  const match = title.match(/^([A-Z_-]+)\s*[-:–—]\s*(.*)$/i);
  if (match) {
    const rawTag = match[1].toUpperCase().trim();
    const clean = match[2].trim();
    return {
      tag: rawTag,
      cleanTitle: clean.charAt(0).toUpperCase() + clean.slice(1),
    };
  }
  return { tag: 'TEST', cleanTitle: title };
};

/**
 * Maps method/action tag to sleek modern badge styling.
 */
const getTagBadgeStyle = (tag) => {
  const norm = String(tag).toUpperCase();
  if (['CREATE', 'ADD', 'POST', 'NEW', 'INSERT'].some(k => norm.includes(k))) {
    return 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-400 dark:border-emerald-500/30';
  }
  if (['READ', 'VIEW', 'GET', 'LIST', 'HOME', 'PAGE', 'FETCH'].some(k => norm.includes(k))) {
    return 'bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-500/15 dark:text-sky-400 dark:border-sky-500/30';
  }
  if (['UPDATE', 'EDIT', 'TOGGLE', 'PUT', 'PATCH', 'CHANGE', 'SAVE', 'MODIFY'].some(k => norm.includes(k))) {
    return 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/15 dark:text-amber-400 dark:border-amber-500/30';
  }
  if (['DELETE', 'REMOVE', 'CANCEL', 'DROP', 'CLEAR'].some(k => norm.includes(k))) {
    return 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-500/15 dark:text-rose-400 dark:border-rose-500/30';
  }
  if (['KEYBOARD', 'KEY', 'ESCAPE', 'SHORTCUT', 'EVENT'].some(k => norm.includes(k))) {
    return 'bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-500/15 dark:text-indigo-400 dark:border-indigo-500/30';
  }
  if (['NETWORK', 'ERROR', 'FAIL', 'MUTATION', 'FALLBACK', 'TIMEOUT', 'OFFLINE'].some(k => norm.includes(k))) {
    return 'bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-500/15 dark:text-orange-400 dark:border-orange-500/30';
  }
  if (['VALIDATION', 'CHECK', 'FORM', 'AUTH', 'SECURITY', 'ASSERT'].some(k => norm.includes(k))) {
    return 'bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-500/15 dark:text-purple-400 dark:border-purple-500/30';
  }
  return 'bg-slate-100 text-slate-700 border-slate-200 dark:bg-zinc-800 dark:text-zinc-300 dark:border-zinc-700';
};

/**
 * Cleans up raw robotic AI assertion strings into human-friendly assertion tags.
 */
const parseExpectedOutcome = (expectedJson) => {
  if (!expectedJson || !Array.isArray(expectedJson)) return [];
  const cleanList = expectedJson.map(item => {
    let text = String(item).trim();
    text = text.replace(/^The asserted value is\s+/i, '');
    text = text.replace(/^The asserted value has\s+/i, '');
    text = text.replace(/^The asserted value\s+/i, '');
    return text.charAt(0).toUpperCase() + text.slice(1);
  });
  return [...new Set(cleanList)];
};

/**
 * Parses raw flow strings (Playwright steps/actions) into clean discrete steps.
 */
const parseExecutionSteps = (flowJson) => {
  if (!flowJson || !Array.isArray(flowJson)) return [];
  const steps = [];
  for (const raw of flowJson) {
    const line = String(raw).trim();
    if (!line) continue;
    const stepMatch = line.match(/test\.step\(\s*['"`](.*?)['"`]/i);
    if (stepMatch) {
      steps.push({ type: 'step', text: stepMatch[1] });
      continue;
    }
    const routeMatch = line.match(/page\.route\(\s*['"`](.*?)['"`]/i);
    if (routeMatch) {
      steps.push({ type: 'mock', text: `Mock API: ${routeMatch[1]}` });
      continue;
    }
    const gotoMatch = line.match(/page\.goto\(\s*['"`](.*?)['"`]/i);
    if (gotoMatch) {
      steps.push({ type: 'nav', text: `Navigate to ${gotoMatch[1]}` });
      continue;
    }
    const actionMatch = line.match(/(locator|todoRow|editInput|button|input)\.?(.*?)\.(fill|click|hover)\((.*?)\)/i);
    if (actionMatch) {
      steps.push({ type: 'action', text: `${actionMatch[3].toUpperCase()}: ${actionMatch[4] || actionMatch[2]}` });
      continue;
    }
    if (
      !line.startsWith('route.fulfill') &&
      !line.startsWith('test.info') &&
      !line.startsWith('page.screenshot') &&
      line.length > 5
    ) {
      steps.push({ type: 'code', text: line });
    }
  }
  return steps.filter((step, idx, arr) => idx === 0 || step.text !== arr[idx - 1].text);
};

export default function SystemTestWorkflow({
  snapshotId,
  framework = 'playwright',
  refreshKey,
  onReadyChange,
  onOpenFile,
  onGenerate,
  onChanged,
  onRunScenario,
  onRunSelected,
}) {
  const [catalog, setCatalog] = useState([]);
  const [features, setFeatures] = useState([]);
  const [selectedIds, setSelectedIds] = useState(null);
  const [expandedId, setExpandedId] = useState(null);
  const [analysis, setAnalysis] = useState(null);
  const [editingExpected, setEditingExpected] = useState(null);
  const [expectedText, setExpectedText] = useState('');
  const [filter, setFilter] = useState('all'); // all, needs_review, verified
  const [search, setSearch] = useState('');
  const [module, setModule] = useState('all');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [readiness, setReadiness] = useState({ ready: false, blockers: [] });
  const inFlightRefreshRef = useRef(null);

  const refresh = useCallback(async (sync = false) => {
    if (!snapshotId) return;
    if (inFlightRefreshRef.current) return inFlightRefreshRef.current;
    const task = (async () => {
      try {
        const [nextCatalog, nextFeatures] = await Promise.all([
          systemEvidenceRequest(snapshotId, sync ? 'catalog/sync' : 'catalog', { method: sync ? 'POST' : 'GET' }),
          systemEvidenceRequest(snapshotId, 'catalog/features'),
        ]);
        const rows = nextCatalog.scenarios || [];
        setCatalog(rows);
        const runnableRows = rows.filter(row => row.filePath);
        setSelectedIds(previous =>
          previous === null
            ? runnableRows.map(row => row.id)
            : previous.filter(id => runnableRows.some(row => row.id === id))
        );

        // Immediately inform parent so workflowReady is never empty
        if (runnableRows.length > 0) {
          const initIds = runnableRows.map(r => r.id);
          const initFiles = [...new Set(runnableRows.map(r => r.filePath))];
          onReadyChange?.({
            ready: true,
            blockers: [],
            scenarioIds: initIds,
            testFiles: initFiles,
            selectedCount: initIds.length,
          });
        }

        const groups = nextFeatures.features || [];
        setFeatures(groups);
      } finally {
        inFlightRefreshRef.current = null;
      }
    })();
    inFlightRefreshRef.current = task;
    return task;
  }, [snapshotId, onReadyChange]);

  useEffect(() => {
    let active = true;
    Promise.resolve().then(() => refresh(true)).catch(err => { if (active) setError(message(err)); });
    return () => { active = false; };
  }, [refresh, refreshKey]);

  const runnable = useMemo(() => catalog.filter(row => row.filePath), [catalog]);
  const selectedRows = useMemo(() => runnable.filter(row => selectedIds?.includes(row.id)), [runnable, selectedIds]);
  const selectedKey = selectedRows.map(row => row.id).join(',');
  const catalogKey = catalog.map(row => `${row.id}:${row.reviewState}:${row.testHash}:${row.scenarioHash}`).join('|');
  const testFiles = useMemo(() => [...new Set(selectedRows.map(row => row.filePath))], [selectedRows]);
  const fileKey = testFiles.join(',');

  useEffect(() => {
    if (!snapshotId) return;
    const currentScenarioIds = selectedRows.map(r => r.id);
    const currentTestFiles = testFiles;

    if (!selectedKey || !currentScenarioIds.length) {
      const result = {
        ready: false,
        blockers: [{ code: 'NO_SELECTION', message: 'Select at least one scenario to run' }],
        scenarioIds: [],
        testFiles: [],
        selectedCount: 0,
      };
      queueMicrotask(() => {
        setReadiness(result);
        onReadyChange?.(result);
      });
      return;
    }

    queueMicrotask(() => {
      onReadyChange?.({
        ready: true,
        blockers: [],
        scenarioIds: currentScenarioIds,
        testFiles: currentTestFiles,
        selectedCount: currentScenarioIds.length,
      });
    });

    let active = true;
    const query = new URLSearchParams({ reviewMode: 'scenario', scenarioIds: selectedKey, testFiles: fileKey });
    systemEvidenceRequest(snapshotId, `readiness?${query}`)
      .then(result => {
        if (active) {
          setReadiness(result);
          onReadyChange?.({
            ...result,
            scenarioIds: currentScenarioIds,
            testFiles: currentTestFiles,
            selectedCount: currentScenarioIds.length,
          });
        }
      })
      .catch(err => {
        if (active) {
          setError(message(err));
        }
      });
    return () => { active = false; };
  }, [snapshotId, selectedKey, fileKey, catalogKey, onReadyChange, selectedRows, testFiles]);

  const act = async (work, success, sync = false) => {
    setBusy(true); setError(''); setNotice('');
    try {
      await work();
      await refresh(sync);
      onChanged?.();
      if (success) setNotice(success);
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  };

  const confirm = row => act(
    () => systemEvidenceRequest(snapshotId, `catalog/${row.id}/confirm-expected`, { method: 'POST', data: { expectedScenarioHash: row.scenarioHash } }),
    'Expected outcome confirmed.',
    true
  );

  const confirmAll = () => act(async () => {
    const targets = catalog.filter(item => !confirmed(item) && item.expectedJson?.length && item.reviewState !== 'STALE');
    for (const row of targets) {
      await systemEvidenceRequest(snapshotId, `catalog/${row.id}/confirm-expected`, { method: 'POST', data: { expectedScenarioHash: row.scenarioHash } });
    }
  }, 'All eligible expected outcomes confirmed.', true);

  const saveExpected = row => {
    setEditingExpected(null);
    const expected = lines(expectedText);
    if (JSON.stringify(expected) === JSON.stringify(row.expectedJson || [])) return;
    act(
      () => systemEvidenceRequest(snapshotId, `catalog/${row.id}`, { method: 'PUT', data: { title: row.title, flow: row.flowJson || [], inputs: row.inputJson || [], expected, criterionIds: row.criterionIds || [], expectedScenarioHash: row.scenarioHash } }),
      'Expected outcome saved.'
    );
  };

  const expand = async row => {
    if (expandedId === row.id) { setExpandedId(null); return; }
    setExpandedId(row.id);
    setAnalysis(null);
    if (row.filePath) {
      try {
        setAnalysis(await systemEvidenceRequest(snapshotId, `tests/analyze?filePath=${encodeURIComponent(row.filePath)}`));
      } catch (err) {
        setError(message(err));
      }
    }
  };

  const unconfirmedCount = catalog.filter(item => !confirmed(item)).length;
  const verifiedCount = catalog.filter(item => confirmed(item)).length;

  const modules = useMemo(() => {
    const list = catalog.map(r => r.filePath ? r.filePath.split('/')[1] || r.filePath : 'root').filter(Boolean);
    return [...new Set(list)];
  }, [catalog]);

  const visible = useMemo(() => {
    return catalog.filter(row => {
      if (filter === 'needs_review' && confirmed(row)) return false;
      if (filter === 'verified' && !confirmed(row)) return false;
      if (module !== 'all') {
        const mod = row.filePath ? row.filePath.split('/')[1] || row.filePath : 'root';
        if (mod !== module) return false;
      }
      if (search) {
        const q = search.toLowerCase();
        const matchesTitle = row.title?.toLowerCase().includes(q);
        const matchesPath = row.filePath?.toLowerCase().includes(q);
        const matchesExpected = (row.expectedJson || []).some(item => item.toLowerCase().includes(q));
        if (!matchesTitle && !matchesPath && !matchesExpected) return false;
      }
      return true;
    });
  }, [catalog, filter, module, search]);

  const allSelected = runnable.length > 0 && selectedRows.length === runnable.length;

  return (
    <section className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-xs overflow-hidden font-sans">
      {/* Scope Selector Card if zero test project */}
      {!catalog.length && features.length > 0 && (
        <div className="p-6 border-b border-[var(--color-border)] bg-[var(--color-surface-secondary)]/30 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-bold text-[var(--color-text)] flex items-center gap-2">
                <Sparkles size={16} className="text-amber-400" />
                Select Initial Feature Scope for Playwright Tests
              </h2>
              <p className="text-xs text-[var(--color-text-secondary)] mt-0.5">
                CovAI discovered application entrypoints. Choose which areas to generate test journeys for.
              </p>
            </div>
            <button
              type="button"
              disabled={busy}
              onClick={() => onGenerate?.()}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-[var(--color-primary)] text-white text-xs font-semibold hover:opacity-90 transition-opacity shadow-xs cursor-pointer disabled:opacity-50"
            >
              <Sparkles size={13} /> Generate Scenarios
            </button>
          </div>
        </div>
      )}

      {/* Catalog Table Header & Modern Filter Bar */}
      <div className="p-5 border-b border-[var(--color-border)] space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <h2 className="text-base font-bold text-[var(--color-text)] tracking-tight">
              Test Scenarios
            </h2>
            <span className="tabular-nums px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-slate-100 text-slate-600 border border-slate-200 dark:bg-zinc-800/80 dark:text-zinc-400 dark:border-zinc-700/50">
              {catalog.length}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => act(() => systemEvidenceRequest(snapshotId, 'catalog/sync', { method: 'POST' }), 'Scenarios synced with test files.', true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] text-xs font-medium text-[var(--color-text)] hover:bg-[var(--color-border)]/40 transition-colors cursor-pointer disabled:opacity-50"
            >
              <FileInput size={13} /> Sync Files
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => onGenerate?.()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gradient-to-r from-purple-600 to-indigo-600 text-white text-xs font-semibold hover:opacity-90 transition-opacity shadow-xs cursor-pointer disabled:opacity-50"
            >
              <Sparkles size={13} /> Generate with AI
            </button>
          </div>
        </div>

        {/* Filter Segmented Toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
          {/* Segmented Status Pills */}
          <div className="flex items-center gap-1 p-1 rounded-lg bg-[var(--color-surface-secondary)] border border-[var(--color-border)] text-xs">
            <button
              type="button"
              onClick={() => setFilter('all')}
              className={`px-3 py-1 rounded-md transition-all font-medium cursor-pointer ${
                filter === 'all'
                  ? 'bg-[var(--color-surface)] text-[var(--color-text)] shadow-xs font-semibold'
                  : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text)]'
              }`}
            >
              All <span className="ml-1 text-[11px] opacity-70">({catalog.length})</span>
            </button>
            <button
              type="button"
              onClick={() => setFilter('needs_review')}
              className={`px-3 py-1 rounded-md transition-all font-medium cursor-pointer ${
                filter === 'needs_review'
                  ? 'bg-[var(--color-surface)] text-[var(--color-text)] shadow-xs font-semibold'
                  : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text)]'
              }`}
            >
              Needs Review <span className="ml-1 text-[11px] opacity-70">({unconfirmedCount})</span>
            </button>
            <button
              type="button"
              onClick={() => setFilter('verified')}
              className={`px-3 py-1 rounded-md transition-all font-medium cursor-pointer ${
                filter === 'verified'
                  ? 'bg-[var(--color-surface)] text-[var(--color-text)] shadow-xs font-semibold'
                  : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text)]'
              }`}
            >
              Verified <span className="ml-1 text-[11px] opacity-70">({verifiedCount})</span>
            </button>
          </div>

          {/* Search Box & Module Dropdown */}
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search size={13} className="absolute left-2.5 top-2.5 text-zinc-500" />
              <input
                aria-label="Search scenarios"
                className="w-48 sm:w-56 pl-8 pr-7 py-1.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] text-xs text-[var(--color-text)] outline-none focus:border-[var(--color-primary)] transition-colors placeholder:text-[var(--color-text-secondary)]/60 font-sans"
                placeholder="Filter scenarios..."
                value={search}
                onChange={event => setSearch(event.target.value)}
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch('')}
                  className="absolute right-2 text-zinc-500 hover:text-zinc-300"
                >
                  <X size={12} />
                </button>
              )}
            </div>

            <div className="relative">
              <select
                aria-label="Filter scenario module"
                className="appearance-none rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] py-1.5 pl-3 pr-8 text-xs text-[var(--color-text)] outline-none focus:border-[var(--color-primary)] transition-colors cursor-pointer"
                value={module}
                onChange={event => setModule(event.target.value)}
              >
                <option value="all">All Modules</option>
                {modules.map(val => (
                  <option key={val} value={val}>{val}</option>
                ))}
              </select>
              <ChevronDown size={12} className="pointer-events-none absolute right-2.5 top-2.5 text-[var(--color-text-secondary)]" />
            </div>
          </div>
        </div>
      </div>

      {/* Selection Action Bar with DIRECT RUN BUTTON */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-2.5 bg-[var(--color-surface-secondary)]/50 border-b border-[var(--color-border)] text-xs">
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-2 cursor-pointer font-medium text-[var(--color-text)] select-none">
            <input
              type="checkbox"
              aria-label="Select all scenarios"
              checked={allSelected}
              onChange={event => setSelectedIds(event.target.checked ? runnable.map(r => r.id) : [])}
              className="accent-[var(--color-primary)] h-4 w-4 rounded cursor-pointer"
            />
            <span>
              <strong>{selectedRows.length}</strong> of {runnable.length} selected
            </span>
          </label>
          {selectedRows.length > 0 && (
            <span className="inline-flex items-center gap-1.5 text-[11px] text-emerald-600 dark:text-emerald-400 font-medium">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 dark:bg-emerald-400" />
              Ready
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {unconfirmedCount > 0 && (
            <button
              type="button"
              disabled={busy}
              onClick={confirmAll}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-amber-200 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-500/20 text-xs font-medium transition-colors cursor-pointer"
            >
              <CheckSquare size={12} /> Confirm All
            </button>
          )}

          <button
            type="button"
            disabled={!selectedRows.length || busy}
            onClick={() => {
              if (onRunSelected) onRunSelected(selectedRows);
              else onRunScenario?.(null, selectedRows);
            }}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--color-primary)] text-white text-xs font-semibold hover:opacity-90 transition-opacity shadow-xs cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Play size={12} fill="currentColor" />
            Run Selected ({selectedRows.length})
          </button>
        </div>
      </div>

      {/* Scenarios Table */}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[800px] border-collapse text-left text-xs">
          <thead className="bg-[var(--color-surface-secondary)]/70 text-[11px] font-semibold text-[var(--color-text-secondary)] border-b border-[var(--color-border)]">
            <tr>
              <th className="w-[42%] px-5 py-3">Scenario &amp; Spec File</th>
              <th className="w-[32%] px-4 py-3">Expected Outcome</th>
              <th className="w-[14%] px-4 py-3">Status</th>
              <th className="w-[12%] px-4 py-3 text-center">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--color-border)]">
            {visible.map(row => {
              const open = expandedId === row.id;
              const site = analysis?.scenarioSites?.find(item => item.title === row.title);
              const assertions = analysis?.assertionSites?.filter(item => item.scenarioLine === site?.line && item.supported) || [];
              const isSelected = Boolean(selectedIds?.includes(row.id));

              return (
                <ModernScenarioRow
                  key={row.id}
                  row={row}
                  open={open}
                  selected={isSelected}
                  onSelect={checked =>
                    setSelectedIds(prev => (checked ? [...new Set([...(prev || []), row.id])] : (prev || []).filter(id => id !== row.id)))
                  }
                  onExpand={() => expand(row)}
                  onRun={() => onRunScenario?.(row)}
                  canRun={framework === 'playwright' && Boolean(row.filePath) && confirmed(row) && !busy}
                  onConfirm={() => confirm(row)}
                  busy={busy}
                  editingExpected={editingExpected === row.id}
                  expectedText={expectedText}
                  setExpectedText={setExpectedText}
                  onEdit={() => {
                    setEditingExpected(row.id);
                    setExpectedText((row.expectedJson || []).join('\n'));
                  }}
                  onSaveExpected={() => saveExpected(row)}
                  onCancelExpected={() => {
                    setExpectedText((row.expectedJson || []).join('\n'));
                    setEditingExpected(null);
                  }}
                  assertions={assertions}
                  onOpenFile={() => onOpenFile?.(row.filePath)}
                />
              );
            })}
          </tbody>
        </table>
      </div>

      {!visible.length && (
        <div className="py-12 text-center text-xs text-[var(--color-text-secondary)] space-y-1">
          <p className="font-semibold text-sm">No scenarios match this filter</p>
          <p>Try resetting the search query or selecting "All Modules".</p>
        </div>
      )}

      {selectedRows.length > 0 && !readiness.ready && readiness.blockers?.length > 0 && (
        <div className="border-t border-amber-500/20 bg-amber-500/5 px-5 py-2.5 text-xs text-amber-300 flex items-center gap-2">
          <AlertCircle size={14} className="shrink-0" />
          <span>{readiness.blockers[0]?.message}</span>
        </div>
      )}

      {error && (
        <div role="alert" className="border-t border-rose-500/30 bg-rose-500/10 px-5 py-3 text-xs text-rose-300 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <AlertCircle size={14} className="shrink-0" />
            <span>{error}</span>
          </div>
          <button type="button" onClick={() => setError('')} className="underline text-[11px] cursor-pointer">
            Dismiss
          </button>
        </div>
      )}

      {notice && (
        <div role="status" className="border-t border-emerald-500/30 bg-emerald-500/10 px-5 py-2.5 text-xs text-emerald-300 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <CheckCircle2 size={14} className="shrink-0" />
            <span>{notice}</span>
          </div>
          <button type="button" onClick={() => setNotice('')} className="underline text-[11px] cursor-pointer">
            Dismiss
          </button>
        </div>
      )}
    </section>
  );
}

function ModernScenarioRow({
  row,
  open,
  selected,
  onSelect,
  onExpand,
  onRun,
  canRun,
  onConfirm,
  busy,
  editingExpected,
  expectedText,
  setExpectedText,
  onEdit,
  onSaveExpected,
  onCancelExpected,
  assertions,
  onOpenFile,
}) {
  const { tag, cleanTitle } = parseScenarioTitle(row.title);
  const tagBadge = getTagBadgeStyle(tag);
  const outcomes = parseExpectedOutcome(row.expectedJson);
  const isVerified = confirmed(row);

  return (
    <>
      <tr
        className={`group transition-colors ${
          open
            ? 'bg-[var(--color-surface-secondary)]/50'
            : selected
            ? 'bg-[var(--color-primary)]/[0.03] hover:bg-[var(--color-surface-secondary)]/40'
            : 'hover:bg-[var(--color-surface-secondary)]/30'
        }`}
      >
        {/* Scenario Column: Tag + Title + File Path */}
        <td className="px-5 py-4 align-middle">
          <div className="flex items-start gap-3">
            <input
              type="checkbox"
              aria-label={`Select ${cleanTitle}`}
              checked={selected}
              disabled={!row.filePath}
              onChange={event => onSelect(event.target.checked)}
              className="mt-1 accent-[var(--color-primary)] h-4 w-4 rounded cursor-pointer"
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span
                  className={`inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-semibold uppercase tracking-wide border ${tagBadge}`}
                >
                  {tag}
                </span>
                <button
                  type="button"
                  aria-expanded={open}
                  onClick={onExpand}
                  className="font-semibold text-sm text-[var(--color-text)] hover:text-[var(--color-primary)] transition-colors text-left leading-snug cursor-pointer"
                >
                  {cleanTitle}
                </button>
              </div>
              {row.filePath && (
                <div className="mt-1 flex items-center gap-1 text-[11px] text-[var(--color-text-secondary)]/80 font-mono">
                  <FileCode size={11} className="shrink-0" />
                  <span className="truncate">{row.filePath}</span>
                </div>
              )}
            </div>
          </div>
        </td>

        {/* Expected Outcome Column */}
        <td className="px-4 py-4 align-middle">
          {editingExpected ? (
            <input
              autoFocus
              aria-label={`Expected outcome for ${cleanTitle}`}
              className="w-full rounded-md border border-[var(--color-primary)] bg-[var(--color-surface)] px-2.5 py-1 text-xs text-[var(--color-text)] outline-none font-sans"
              value={expectedText}
              onChange={event => setExpectedText(event.target.value)}
              onBlur={onSaveExpected}
              onKeyDown={event => {
                if (event.key === 'Escape') {
                  event.preventDefault();
                  onCancelExpected();
                } else if (event.key === 'Enter') {
                  event.preventDefault();
                  event.currentTarget.blur();
                }
              }}
            />
          ) : (
            <div
              onClick={onEdit}
              className="group/item flex items-center justify-between gap-2 p-1 rounded-md border border-transparent hover:border-[var(--color-border)] hover:bg-[var(--color-surface)]/70 transition-all cursor-pointer"
              title="Click to edit expected outcome"
            >
              <div className="flex flex-wrap items-center gap-1.5 min-w-0">
                {outcomes.length > 0 ? (
                  outcomes.map((item, idx) => (
                    <span
                      key={idx}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium bg-slate-100 text-slate-700 border border-slate-200/90 dark:bg-zinc-800/60 dark:border-zinc-700/50 dark:text-zinc-200 transition-colors shadow-2xs"
                    >
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 dark:bg-emerald-400 shrink-0" />
                      <span className="truncate max-w-[260px]">{item}</span>
                    </span>
                  ))
                ) : (
                  <span className="text-xs text-[var(--color-text-secondary)]/60 italic">
                    No assertions defined
                  </span>
                )}
              </div>
              <Edit2 size={12} className="text-[var(--color-text-secondary)] opacity-0 group-hover/item:opacity-100 transition-opacity shrink-0" />
            </div>
          )}
        </td>

        {/* Status Column */}
        <td className="px-4 py-4 align-middle">
          {isVerified ? (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-400 dark:border-emerald-500/25 whitespace-nowrap">
              <CheckCircle2 size={12} className="shrink-0 text-emerald-600 dark:text-emerald-400" />
              Verified
            </span>
          ) : (
            <button
              type="button"
              disabled={busy || !row.expectedJson?.length}
              onClick={onConfirm}
              className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100 dark:bg-amber-500/15 dark:text-amber-300 dark:border-amber-500/30 transition-colors cursor-pointer disabled:opacity-40"
            >
              <AlertCircle size={12} className="shrink-0 text-amber-600 dark:text-amber-400" />
              Confirm
            </button>
          )}
        </td>

        {/* Action Column */}
        <td className="px-4 py-4 align-middle text-center">
          <div className="flex items-center justify-center gap-1.5">
            <button
              type="button"
              aria-label={`Run ${cleanTitle}`}
              title="Run this scenario"
              disabled={!canRun}
              onClick={onRun}
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 dark:text-zinc-400 hover:bg-[var(--color-primary)]/15 hover:text-[var(--color-primary)] transition-all cursor-pointer disabled:opacity-25 disabled:pointer-events-none"
            >
              <Play size={14} fill="currentColor" />
            </button>
            <button
              type="button"
              aria-expanded={open}
              onClick={onExpand}
              title={open ? 'Collapse details' : 'Expand details'}
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 dark:text-zinc-400 hover:text-[var(--color-text)] hover:bg-[var(--color-surface-secondary)] transition-all cursor-pointer"
            >
              <ChevronDown size={15} className={`transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
            </button>
          </div>
        </td>
      </tr>

      {/* Expanded Scenario Inspector: Clean Developer Tool View */}
      {open && (
        <tr className="border-t border-[var(--color-border)] bg-[var(--color-surface-secondary)]/25">
          <td colSpan={4} className="p-5 sm:p-6 space-y-4">
            <ScenarioInspectorView
              row={row}
              cleanTitle={cleanTitle}
              tag={tag}
              tagBadge={tagBadge}
              outcomes={outcomes}
              assertions={assertions}
              onRun={onRun}
              canRun={canRun}
              onOpenFile={onOpenFile}
              onConfirm={onConfirm}
              isVerified={isVerified}
              busy={busy}
            />
          </td>
        </tr>
      )}
    </>
  );
}

/**
 * Dedicated Scenario Inspector Card that renders test steps, assertion bindings,
 * and inputs cleanly WITHOUT any raw HTML textareas.
 */
function ScenarioInspectorView({
  row,
  cleanTitle,
  tag,
  tagBadge,
  outcomes,
  assertions,
  onRun,
  canRun,
  onOpenFile,
  onConfirm,
  isVerified,
  busy,
}) {
  const steps = useMemo(() => parseExecutionSteps(row.flowJson), [row.flowJson]);
  const inputs = row.inputJson || [];

  return (
    <div className="space-y-4">
      {/* Inspector Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-[var(--color-border)]">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono font-bold uppercase border ${tagBadge}`}>
              {tag}
            </span>
            <h3 className="text-sm font-bold text-[var(--color-text)]">{cleanTitle}</h3>
            {isVerified ? (
              <span className="text-[11px] text-emerald-600 dark:text-emerald-400 flex items-center gap-1 font-mono">
                <CheckCircle2 size={12} /> Verified Journey
              </span>
            ) : (
              <button
                type="button"
                disabled={busy}
                onClick={onConfirm}
                className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 dark:text-amber-300 dark:bg-amber-500/10 dark:border-amber-500/30 px-2 py-0.5 rounded-full hover:bg-amber-100 dark:hover:bg-amber-500/20 transition-colors"
              >
                Confirm Expected Outcome
              </button>
            )}
          </div>
          {row.filePath && (
            <p className="text-[11px] font-mono text-[var(--color-text-secondary)] flex items-center gap-1">
              <FileCode size={12} className="text-[var(--color-text-secondary)]" />
              {row.filePath}
            </p>
          )}
        </div>

        <div className="flex items-center gap-2">
          {row.filePath && (
            <button
              type="button"
              onClick={onOpenFile}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] text-xs font-medium text-[var(--color-text)] hover:bg-[var(--color-surface-secondary)] transition-colors cursor-pointer shadow-2xs"
            >
              <ExternalLink size={12} /> Open Test File
            </button>
          )}
          <button
            type="button"
            disabled={!canRun}
            onClick={onRun}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--color-primary)] text-white text-xs font-semibold hover:opacity-90 transition-opacity shadow-xs cursor-pointer disabled:opacity-40"
          >
            <Play size={12} fill="currentColor" /> Run Scenario
          </button>
        </div>
      </div>

      {/* Main Grid: Execution Steps vs Verification */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Left Column: Execution Steps Timeline */}
        <div className="lg:col-span-7 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4 space-y-3 shadow-2xs">
          <div className="flex items-center justify-between pb-2 border-b border-[var(--color-border)]/80">
            <span className="text-xs font-semibold text-[var(--color-text)] flex items-center gap-1.5 font-mono">
              <Activity size={13} className="text-cyan-500 dark:text-cyan-400" />
              Execution Steps ({steps.length})
            </span>
            <span className="text-[10px] font-mono text-[var(--color-text-secondary)]">Playwright Flow</span>
          </div>

          <div className="space-y-2">
            {steps.length > 0 ? (
              steps.map((step, idx) => (
                <div
                  key={idx}
                  className="flex items-start gap-2.5 text-xs text-[var(--color-text)] font-mono p-2 rounded bg-[var(--color-surface-secondary)]/50 border border-[var(--color-border)]/60"
                >
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-slate-200 text-slate-700 dark:bg-zinc-800 text-[10px] font-bold dark:text-zinc-300">
                    {idx + 1}
                  </span>
                  <div className="min-w-0 flex-1 pt-0.5">
                    <span className={step.type === 'mock' ? 'text-amber-600 dark:text-amber-300 font-semibold' : step.type === 'nav' ? 'text-sky-600 dark:text-sky-300 font-semibold' : 'text-[var(--color-text)]'}>
                      {step.text}
                    </span>
                  </div>
                </div>
              ))
            ) : (
              <p className="text-xs text-[var(--color-text-secondary)] italic py-2">
                No discrete test steps detected in scenario definition.
              </p>
            )}
          </div>

          {/* Test Input Data */}
          {inputs.length > 0 && (
            <div className="pt-2 border-t border-[var(--color-border)]/80 space-y-1.5">
              <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-secondary)] font-mono">
                Interactive Test Inputs
              </span>
              <div className="flex flex-wrap gap-1.5">
                {inputs.map((inp, idx) => (
                  <span
                    key={idx}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-sky-50 text-sky-700 border border-sky-200 dark:bg-sky-950/60 dark:border-sky-800/50 dark:text-sky-300 font-mono text-xs"
                  >
                    <Terminal size={11} className="text-sky-600 dark:text-sky-400 shrink-0" />
                    {inp}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Right Column: Verification & Assertions */}
        <div className="lg:col-span-5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4 space-y-3 shadow-2xs">
          <div className="flex items-center justify-between pb-2 border-b border-[var(--color-border)]/80">
            <span className="text-xs font-semibold text-[var(--color-text)] flex items-center gap-1.5 font-mono">
              <ShieldCheck size={13} className="text-emerald-500 dark:text-emerald-400" />
              Verification &amp; Assertions
            </span>
            <span className="text-[10px] font-mono text-[var(--color-text-secondary)]">Verified Checks</span>
          </div>

          {/* Expected Outcome Callout */}
          <div className="p-3 rounded-lg bg-emerald-50/70 border border-emerald-200 dark:bg-emerald-950/40 dark:border-emerald-800/40 space-y-1">
            <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-400 font-mono block">
              Expected Business Outcome
            </span>
            <div className="space-y-1">
              {outcomes.length > 0 ? (
                outcomes.map((item, idx) => (
                  <div key={idx} className="flex items-center gap-2 text-xs text-emerald-800 dark:text-emerald-200">
                    <CheckCircle2 size={13} className="text-emerald-600 dark:text-emerald-400 shrink-0" />
                    <span>{item}</span>
                  </div>
                ))
              ) : (
                <p className="text-xs text-[var(--color-text-secondary)] italic">No expected outcome confirmed yet.</p>
              )}
            </div>
          </div>

          {/* Static Assertions Code Block */}
          <div className="space-y-1.5">
            <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-secondary)] font-mono">
              Underlying Playwright Assertions
            </span>
            <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
              {assertions.length > 0 ? (
                assertions.map(a => (
                  <div
                    key={a.id}
                    className="p-2 rounded bg-slate-50 dark:bg-zinc-950 border border-slate-200 dark:border-zinc-800/80 text-[11px] font-mono text-emerald-700 dark:text-emerald-400 flex items-center justify-between gap-2"
                  >
                    <span className="truncate">{a.code}</span>
                    <span className="text-[10px] text-[var(--color-text-secondary)] font-sans shrink-0">Line {a.line}</span>
                  </div>
                ))
              ) : (
                <div className="p-2.5 rounded bg-slate-50 dark:bg-zinc-950/60 border border-slate-200 dark:border-zinc-800/50 text-xs text-[var(--color-text-secondary)] italic">
                  Awaited assertions are verified through the spec file directly.
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
