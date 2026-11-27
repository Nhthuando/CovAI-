import React, { useEffect, useMemo, useState } from "react";
import { Skeleton } from "../../common/Skeleton.jsx";
import { Badge } from "../../ui/badge.jsx";
import { Button } from "../../ui/button.jsx";
import { Card } from "../../ui/card.jsx";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "../../ui/dropdown-menu.jsx";
import { Hint } from "../../ui/tooltip.jsx";
import {
  loadMatrixSelection,
  saveMatrixSelection,
  toggleParentSelection,
  toggleAllParentsSelection,
  toggleChildSelection,
} from "../../../lib/matrixSelectionStorage.js";
import {
  Search,
  ChevronRight,
  ChevronDown,
  Play,
  Plus,
  Ellipsis,
  ScanSearch,
  Edit3,
  Code2,
  Trash2,
  CheckCircle2,
  XCircle,
  Clock,
  Loader2,
  ChevronsUpDown,
  Check,
  AlertTriangle,
  RefreshCw,
  Camera,
  FilePlus2,
  Wrench,
} from "lucide-react";
import {
  getSystemGroupCaseCoverage,
  summarizeSystemFailure,
} from "./systemCaseCoverage.js";

function systemScenarioAnnotationKey(sc, idx) {
  return String(
    sc?.id || `${sc?.filePath || sc?.testFile || "spec"}::${sc?.title || idx}`,
  );
}

function normalizeStatus(status = "") {
  const s = String(status || "").toUpperCase();
  if (s === "PASS" || s === "PASSED" || s === "SUCCESS") return "PASS";
  if (s === "FAIL" || s === "FAILED" || s === "ERROR" || s === "TIMEDOUT" || s === "INTERRUPTED") {
    return "FAIL";
  }
  if (s === "FLAKY") return "FLAKY";
  return "NOT_RUN";
}

// One short neutral tag per scenario instead of several long badges.
const CASE_TAGS = { HAPPY: "Happy", EDGE: "Edge", AUTH: "Auth", ERROR: "Error" };
function caseTag(sc) {
  const key = String(sc.caseKey || "").toUpperCase();
  if (CASE_TAGS[key]) return CASE_TAGS[key];
  const label = String(sc.caseLabel || "").toLowerCase();
  if (label.startsWith("happy")) return "Happy";
  if (label.startsWith("edge")) return "Edge";
  if (label.includes("auth")) return "Auth";
  if (label.startsWith("error")) return "Error";
  return null;
}

function formatDuration(ms) {
  const value = Number(ms);
  if (!Number.isFinite(value) || value <= 0) return null;
  return value < 1000 ? `${Math.round(value)} ms` : `${(value / 1000).toFixed(1)} s`;
}

function getGroupStatus(group) {
  if (group.fullStackCompatible === false) return "FRONTEND_ONLY";
  if (group.hasDraftOnly && !(group.scenarios || []).length) return "DRAFT";
  const scenarios = group.scenarios || [];
  if (scenarios.some((sc) => normalizeStatus(sc.status) === "FAIL")) return "FAIL";
  if (scenarios.some((sc) => normalizeStatus(sc.status) === "FLAKY")) return "FLAKY";
  const passedCount = scenarios.filter((sc) => normalizeStatus(sc.status) === "PASS").length;
  if (scenarios.length > 0 && passedCount === scenarios.length) return "PASS";
  if (passedCount > 0) return "PARTIAL";
  if (group.hasDraft) return "DRAFT";
  return "UNCOVERED";
}

const STATUS_BADGE = {
  PASS: { label: "Covered", variant: "success" },
  PARTIAL: { label: "Partial", variant: "warning" },
  FAIL: { label: "Failed", variant: "danger" },
  FLAKY: { label: "Flaky", variant: "warning" },
  DRAFT: { label: "Draft", variant: "info" },
  FRONTEND_ONLY: { label: "Frontend only", variant: "secondary" },
  UNCOVERED: { label: "Uncovered", variant: "secondary" },
};

const MOCKED_API_HINT = "Frontend-only test: it mocks API calls, so it can't run in Full Stack mode. Generate Full Stack tests instead.";

const rowLayout = "grid grid-cols-[1rem_minmax(0,1fr)_7rem_6rem_2.5rem_6rem] items-center gap-3 px-4";

export default function SystemSpecMatrixTable({
  snapshotId = null,
  specGroups = [],
  loading = false,
  syncingCatalog = false,
  runningTarget = null,
  fixingTarget = null,
  deletingTarget = null,
  canRunTests = true,
  canEditTests = true,
  canUseAi = true,
  onSyncCatalog,
  onGenerateSelected,
  onRunSelectedFiles,
  onRunSelectedScenarios,
  onRunSpecFile,
  onRunScenario,
  onOpenAddTest,
  onOpenEditScenario,
  onDeleteScenario,
  onAIFixScenario,
  onInspectScenario,
  onOpenSpecFile,
  pendingOpsCount = 0,
  isApplyingPending = false,
  onApplyPendingChanges = null,
  onDiscardPendingChanges = null,
}) {
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [expandedKeys, setExpandedKeys] = useState(() => new Set());
  const [selectedFiles, setSelectedFiles] = useState(
    () => loadMatrixSelection("system", snapshotId).parents,
  );
  const [selectedScenarioKeys, setSelectedScenarioKeys] = useState(
    () => loadMatrixSelection("system", snapshotId).children,
  );

  useEffect(() => {
    saveMatrixSelection("system", snapshotId, selectedFiles, selectedScenarioKeys);
  }, [snapshotId, selectedFiles, selectedScenarioKeys]);

  const enrichedGroups = useMemo(() => {
    return (specGroups || []).map((group) => {
      const scenarios = group.scenarios || [];
      const caseCov = getSystemGroupCaseCoverage(group, scenarios);
      const coverageRatio =
        caseCov.totalRequired > 0
          ? caseCov.coveredCount / caseCov.totalRequired
          : 0;
      const annotatedScenarios = scenarios.map((sc, idx) => {
        const ann =
          caseCov.scenarioAnnotations?.[systemScenarioAnnotationKey(sc, idx)] || {};
        return {
          ...sc,
          caseLabel: ann.caseLabel || ann.caseKey || "Flow",
          badgeType: ann.badgeType || "OPTIONAL",
          badgeLabel: ann.badgeLabel || ann.caseLabel || "Flow",
          isCoveredForCase: String(ann.badgeType || "").startsWith("PRIMARY_"),
          isDuplicateCase: ann.badgeType === "DUPLICATE",
        };
      });
      const groupStatus = getGroupStatus(group);
      return {
        ...group,
        annotatedScenarios,
        caseCov: { ...caseCov, coverageRatio },
        groupStatus,
      };
    });
  }, [specGroups]);

  const filteredGroups = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return enrichedGroups.filter((group) => {
      if (statusFilter !== "ALL") {
        if (statusFilter === "UNCOVERED" && !["UNCOVERED", "DRAFT"].includes(group.groupStatus)) {
          return false;
        }
        if (statusFilter !== "UNCOVERED" && group.groupStatus !== statusFilter) {
          return false;
        }
      }
      if (!q) return true;
      if (
        String(group.filePath || "").toLowerCase().includes(q) ||
        String(group.featureName || "").toLowerCase().includes(q)
      ) {
        return true;
      }
      return (group.annotatedScenarios || []).some(
        (sc) =>
          String(sc.title || "").toLowerCase().includes(q) ||
          String(sc.caseLabel || "").toLowerCase().includes(q),
      );
    });
  }, [enrichedGroups, statusFilter, searchQuery]);

  const allExpanded =
    filteredGroups.length > 0 && filteredGroups.every((g) => expandedKeys.has(g.key));

  const toggleExpandAll = () => {
    if (allExpanded) {
      setExpandedKeys(new Set());
    } else {
      setExpandedKeys(new Set(filteredGroups.map((g) => g.key)));
    }
  };

  const toggleExpand = (key) => {
    setExpandedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const scenarioSelectionKey = (sc, group) =>
    `${sc.testFile || group.filePath}::${sc.title || sc.id}`;

  const toggleSelectFile = (filePath) => {
    const targetGroup = enrichedGroups.find((g) => g.filePath === filePath);
    if (targetGroup?.fullStackCompatible === false) return;
    const next = toggleParentSelection({
      parentKey: filePath,
      childKeys: (targetGroup?.annotatedScenarios || []).map((sc) =>
        scenarioSelectionKey(sc, targetGroup),
      ),
      parents: selectedFiles,
      children: selectedScenarioKeys,
    });
    setSelectedFiles(next.parents);
    setSelectedScenarioKeys(next.children);
  };

  const selectableGroups = filteredGroups.filter((group) => group.filePath && group.fullStackCompatible !== false);
  const allVisibleSelected = selectableGroups.length > 0 &&
    selectableGroups.every((group) => selectedFiles.has(group.filePath));

  const toggleSelectAllFiles = () => {
    const next = toggleAllParentsSelection({
      items: selectableGroups.map((group) => ({
        parentKey: group.filePath,
        childKeys: (group.annotatedScenarios || []).map((sc) =>
          scenarioSelectionKey(sc, group),
        ),
      })),
      allSelected: allVisibleSelected,
      parents: selectedFiles,
      children: selectedScenarioKeys,
    });
    setSelectedFiles(next.parents);
    setSelectedScenarioKeys(next.children);
  };

  const toggleSelectScenario = (sc, group) => {
    if (group.fullStackCompatible === false) return;
    const next = toggleChildSelection({
      childKey: scenarioSelectionKey(sc, group),
      parentKey: group?.filePath || null,
      siblingKeys: (group?.annotatedScenarios || []).map((item) =>
        scenarioSelectionKey(item, group),
      ),
      parents: selectedFiles,
      children: selectedScenarioKeys,
    });
    setSelectedFiles(next.parents);
    setSelectedScenarioKeys(next.children);
  };

  const selectedFileList = useMemo(() => enrichedGroups
    .filter((group) => group.fullStackCompatible !== false && selectedFiles.has(group.filePath))
    .map((group) => group.filePath), [enrichedGroups, selectedFiles]);

  const selectedScenarioObjects = useMemo(() => {
    const out = [];
    for (const group of enrichedGroups) {
      if (group.fullStackCompatible === false) continue;
      const parentSelected = Boolean(group.filePath && selectedFiles.has(group.filePath));
      for (const sc of group.annotatedScenarios || []) {
        if (parentSelected || selectedScenarioKeys.has(scenarioSelectionKey(sc, group))) {
          out.push({ ...sc, filePath: sc.testFile || group.filePath });
        }
      }
    }
    return out;
  }, [enrichedGroups, selectedFiles, selectedScenarioKeys]);

  const hasSelection = selectedFileList.length > 0 || selectedScenarioObjects.length > 0;
  const stagedActions = pendingOpsCount > 0 && onApplyPendingChanges && (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        size="sm"
        onClick={onApplyPendingChanges}
        loading={isApplyingPending}
        title="Write temporary UI edits, additions, and deletions to spec files"
      >
        {!isApplyingPending && <Check />}
        {isApplyingPending ? "Applying…" : `Apply changes (${pendingOpsCount})`}
      </Button>
      {onDiscardPendingChanges && !isApplyingPending && (
        <Button size="sm" variant="outline" onClick={onDiscardPendingChanges}>Discard</Button>
      )}
    </div>
  );
  const expandLabel = allExpanded ? "Collapse all" : "Expand all";

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-1 basis-[28rem] flex-wrap items-center gap-2">
          <div className="relative min-w-0 flex-1 basis-40">
            <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" />
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              aria-label="Search specs, features, or scenarios"
              placeholder="Search specs, features, or scenarios…"
              className="h-8 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] pr-2 pl-8 text-sm text-[var(--color-text)] outline-none placeholder:text-[var(--color-text-muted)] focus-visible:border-[var(--color-primary)]"
            />
          </div>

          <div className="flex flex-wrap items-center rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-0.5 text-xs" role="group" aria-label="Filter specs by status">
            {[
              { id: "ALL", label: "All" },
              { id: "PASS", label: "Pass" },
              { id: "FAIL", label: "Fail" },
              { id: "FLAKY", label: "Flaky" },
              { id: "UNCOVERED", label: "Uncovered" },
            ].map((pill) => (
              <button
                key={pill.id}
                type="button"
                onClick={() => setStatusFilter(pill.id)}
                aria-pressed={statusFilter === pill.id}
                className="cursor-pointer rounded px-2 py-1 text-[var(--color-text-muted)] transition-colors hover:text-[var(--color-text)] aria-pressed:bg-[var(--color-surface-secondary)] aria-pressed:font-semibold aria-pressed:text-[var(--color-text)]"
              >
                {pill.label}
              </button>
            ))}
          </div>
        </div>

        <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
          {!hasSelection && stagedActions}
          {onSyncCatalog && (
            <Hint text="Scan specs">
              <span className="inline-flex">
                <Button size="icon-sm" variant="outline" onClick={onSyncCatalog} disabled={syncingCatalog} aria-label="Scan specs">
                  {syncingCatalog ? <RefreshCw className="animate-spin" /> : <ScanSearch />}
                </Button>
              </span>
            </Hint>
          )}
          {canEditTests && onOpenAddTest && (
            <Hint text="New scenario">
              <Button size="icon-sm" variant="outline" onClick={() => onOpenAddTest(null)} aria-label="New scenario">
                <Plus />
              </Button>
            </Hint>
          )}
          <Hint text={expandLabel}>
            <Button size="icon-sm" variant="outline" onClick={toggleExpandAll} aria-label={expandLabel}>
              <ChevronsUpDown />
            </Button>
          </Hint>
        </div>
      </div>

      {hasSelection && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm">
          <span className="text-[var(--color-text-secondary)]">
            {selectedFileList.length > 0
              ? `${selectedFileList.length} ${selectedFileList.length === 1 ? "spec" : "specs"} selected`
              : `${selectedScenarioObjects.length} ${selectedScenarioObjects.length === 1 ? "scenario" : "scenarios"} selected`}
          </span>

          <div className="flex flex-wrap items-center gap-2">
            {canUseAi && selectedFileList.length > 0 && onGenerateSelected && (
              <Button size="sm" variant="outline" onClick={() => onGenerateSelected(selectedFileList)}>
                <FilePlus2 />
                Generate selected ({selectedFileList.length})
              </Button>
            )}
            {stagedActions}
            {canRunTests && selectedFileList.length > 0 && onRunSelectedFiles && (
              <Button size="sm" onClick={() => onRunSelectedFiles(selectedFileList)}>
                <Play />
                Run selected specs ({selectedFileList.length})
              </Button>
            )}
            {canRunTests && selectedScenarioObjects.length > 0 && onRunSelectedScenarios && (
              <Button size="sm" onClick={() => onRunSelectedScenarios(selectedScenarioObjects)}>
                <Play />
                Run selected scenarios ({selectedScenarioObjects.length})
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setSelectedFiles(new Set());
                setSelectedScenarioKeys(new Set());
              }}
            >
              Clear
            </Button>
          </div>
        </div>
      )}

      <Card className="gap-0 overflow-x-auto py-0" aria-busy={loading}>
        <div className={`${rowLayout} min-w-[600px] border-b border-[var(--color-border)] bg-[var(--color-surface-secondary)]/50 py-2 text-xs font-medium text-[var(--color-text-muted)]`}>
          <input
            type="checkbox"
            checked={allVisibleSelected}
            disabled={selectableGroups.length === 0}
            onChange={toggleSelectAllFiles}
            className="size-4 cursor-pointer rounded accent-[var(--color-primary)]"
            aria-label="Select all visible spec files"
          />
          <span>Spec file</span>
          <span>Cases</span>
          <span>Status</span>
          <span className="text-right">Tests</span>
          <span className="sr-only">Actions</span>
        </div>

        {loading && specGroups.length === 0 ? (
          <div className="min-w-[600px] divide-y divide-[var(--color-border)]" aria-hidden="true">
            {Array.from({ length: 4 }, (_, index) => (
              <div key={index} className={`${rowLayout} min-h-12`}>
                <Skeleton className="size-4" />
                <Skeleton className="h-4 w-3/4 max-w-56" />
                <Skeleton className="h-2 w-16" />
                <Skeleton className="h-5 w-16" />
                <Skeleton className="ml-auto h-4 w-5" />
                <Skeleton className="ml-auto h-6 w-20" />
              </div>
            ))}
          </div>
        ) : filteredGroups.length === 0 ? (
          !loading && (
            <p className="px-4 py-10 text-sm text-[var(--color-text-muted)]">
              {specGroups.length === 0 ? "No system test specs found." : "No specs match your search or filter."}
            </p>
          )
        ) : (
          <div className="min-w-[600px] divide-y divide-[var(--color-border)]">
            {filteredGroups.map((group) => {
              const isExpanded = expandedKeys.has(group.key);
              const isFrontendOnly = group.fullStackCompatible === false;
              const isFileSelected = !isFrontendOnly && group.filePath && selectedFiles.has(group.filePath);
              const badge = STATUS_BADGE[group.groupStatus] || STATUS_BADGE.UNCOVERED;
              const isRunningGroup = runningTarget === group.filePath;
              const { coveredCount, totalRequired, coverageRatio } = group.caseCov;
              const coverageColor = coverageRatio >= 0.8
                ? "bg-emerald-500"
                : coverageRatio >= 0.4 ? "bg-amber-500" : "bg-[var(--color-danger)]";
              const featureName = group.featureName?.trim();
              const canAddScenario = canEditTests && onOpenAddTest;

              return (
                <div key={group.key} className="bg-[var(--color-surface)]">
                  <div
                    onClick={() => toggleExpand(group.key)}
                    className={`${rowLayout} min-h-12 cursor-pointer py-1.5 transition-colors hover:bg-[var(--color-surface-secondary)]/50`}
                  >
                    <input
                      type="checkbox"
                      checked={Boolean(isFileSelected)}
                      disabled={isFrontendOnly}
                      onClick={(e) => e.stopPropagation()}
                      onChange={() => group.filePath && toggleSelectFile(group.filePath)}
                      className="size-4 cursor-pointer rounded accent-[var(--color-primary)]"
                      aria-label={`Select ${group.filePath}`}
                    />
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="shrink-0 text-[var(--color-text-muted)]" aria-hidden="true">
                        {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                      </span>
                      <div className="min-w-0">
                        <div className="flex min-w-0 items-center gap-2">
                          <span className="truncate font-mono text-sm" title={group.filePath}>{group.filePath}</span>
                          {isFrontendOnly && (
                            <Hint text={MOCKED_API_HINT}>
                              <span className="shrink-0" tabIndex={0}><Badge variant="secondary">Mocked API</Badge></span>
                            </Hint>
                          )}
                        </div>
                        {featureName && featureName !== "E2E Spec Flow" && (
                          <div className="truncate text-xs text-[var(--color-text-muted)]" title={featureName}>{featureName}</div>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 text-xs tabular-nums text-[var(--color-text-secondary)]">
                      <div className="h-1.5 w-16 shrink-0 overflow-hidden rounded-full bg-[var(--color-surface-secondary)]" aria-hidden="true">
                        <div className={`h-full rounded-full ${coverageColor}`} style={{ width: `${Math.min(1, coverageRatio) * 100}%` }} />
                      </div>
                      <span>{coveredCount}/{totalRequired}</span>
                    </div>
                    <Badge variant={badge.variant} className="text-[var(--color-text)]">{badge.label}</Badge>
                    <div className="text-right text-sm tabular-nums text-[var(--color-text-secondary)]">
                      {group.annotatedScenarios.length}
                    </div>

                    <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                      {canRunTests && onRunSpecFile && (
                        <Hint text={isFrontendOnly ? MOCKED_API_HINT : undefined}>
                          <span className="inline-flex" tabIndex={isFrontendOnly ? 0 : undefined}>
                            <Button
                              size="sm"
                              variant="outline"
                              className="gap-1 px-2 [&_svg]:size-3"
                              onClick={() => onRunSpecFile(group)}
                              disabled={isFrontendOnly || isRunningGroup}
                              title={isFrontendOnly ? undefined : "Run this spec file"}
                            >
                              {isRunningGroup ? <Loader2 className="animate-spin" /> : <Play />}
                              Run
                            </Button>
                          </span>
                        </Hint>
                      )}
                      {(canAddScenario || onOpenSpecFile) && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button size="icon-sm" variant="ghost" aria-label={`Actions for ${group.filePath}`}>
                              <Ellipsis />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            {canAddScenario && (
                              <DropdownMenuItem onSelect={() => onOpenAddTest(group)}>Add scenario</DropdownMenuItem>
                            )}
                            {onOpenSpecFile && (
                              <DropdownMenuItem onSelect={() => onOpenSpecFile(group.filePath)}>Open code</DropdownMenuItem>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </div>
                  </div>

                  {/* Expanded Spec Body: one quiet line per scenario, secondary actions in a menu */}
                  {isExpanded && (
                    <div className="border-t border-[var(--color-border)] bg-[var(--color-bg)]/40 px-4 py-3">
                      {group.annotatedScenarios.length === 0 ? (
                        <div className="rounded-md border border-dashed border-[var(--color-border)] px-4 py-5 text-center text-sm text-[var(--color-text-muted)]">
                          No tests in this spec yet.{" "}
                          {canAddScenario && (
                            <button
                              type="button"
                              onClick={() => onOpenAddTest?.(group)}
                              className="cursor-pointer text-[var(--color-primary)] hover:underline"
                            >
                              Add a scenario
                            </button>
                          )}
                        </div>
                      ) : (
                        <ul className="divide-y divide-[var(--color-border)] overflow-hidden rounded-md border border-[var(--color-border)] bg-[var(--color-surface)]">
                          {group.annotatedScenarios.map((sc, idx) => {
                            const st = normalizeStatus(sc.status);
                            const selKey = scenarioSelectionKey(sc, group);
                            const isChecked = !isFrontendOnly && (Boolean(isFileSelected) || selectedScenarioKeys.has(selKey));
                            const isFixingThis = fixingTarget === selKey || fixingTarget === sc.id;
                            const isDeletingThis = deletingTarget === selKey || deletingTarget === sc.id;
                            const failed = st === "FAIL" || st === "FLAKY";
                            const cleanFailSummary = failed
                              ? sc.failureSummary || summarizeSystemFailure(sc.failureMessages || "")
                              : "";
                            const rawTechnicalLog = Array.isArray(sc.failureMessages)
                              ? sc.failureMessages.join("\n\n")
                              : String(sc.failureMessages || "");
                            const hasEvidence =
                              sc.evidence?.hasScreenshot || sc.evidence?.hasDomSnapshot || Boolean(sc.failureBreakpoint);
                            const tag = caseTag(sc);
                            const duration = formatDuration(sc.durationMs);
                            const title = sc.title || sc.testName;
                            const hasMenu =
                              (canEditTests && (onOpenEditScenario || onDeleteScenario)) ||
                              onOpenSpecFile ||
                              (hasEvidence && onInspectScenario);

                            return (
                              <li
                                key={`${selKey}-${idx}`}
                                className={`group/row px-3 py-2 transition-colors duration-150 hover:bg-[var(--color-surface-secondary)]/60 ${
                                  st === "FAIL" ? "bg-rose-500/[0.04]" : ""
                                }`}
                              >
                                <div className="flex items-center gap-3">
                                  <input
                                    type="checkbox"
                                    checked={isChecked}
                                    disabled={isFrontendOnly}
                                    onChange={() => toggleSelectScenario(sc, group)}
                                    className="shrink-0 cursor-pointer rounded border-[var(--color-border)] bg-[var(--color-bg)]"
                                    aria-label={`Select scenario ${title}`}
                                  />
                                  <span className="shrink-0" aria-label={st === "NOT_RUN" ? "Not run" : st.toLowerCase()}>
                                    {st === "PASS" ? (
                                      <CheckCircle2 size={16} className="text-emerald-500" />
                                    ) : st === "FAIL" ? (
                                      <XCircle size={16} className="text-rose-500" />
                                    ) : st === "FLAKY" ? (
                                      <AlertTriangle size={16} className="text-amber-500" />
                                    ) : (
                                      <Clock size={16} className="text-[var(--color-text-muted)]" />
                                    )}
                                  </span>
                                  <span className="min-w-0 flex-1 truncate text-sm text-[var(--color-text)]" title={title}>
                                    {title}
                                  </span>
                                  {tag && (
                                    <span className="hidden shrink-0 rounded-md border border-[var(--color-border)] px-1.5 py-0.5 text-xs text-[var(--color-text-muted)] sm:inline">
                                      {tag}
                                    </span>
                                  )}
                                  {duration && (
                                    <span className="hidden w-14 shrink-0 text-right font-mono text-xs tabular-nums text-[var(--color-text-muted)] md:inline">
                                      {duration}
                                    </span>
                                  )}
                                  <div className="flex shrink-0 items-center gap-1">
                                    {failed && canUseAi && onAIFixScenario && (
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        className="h-7 gap-1 px-2 text-xs [&_svg]:size-3"
                                        onClick={() => onAIFixScenario(sc, group)}
                                        disabled={isFixingThis}
                                        title="Ask AI to diagnose and repair this failing scenario"
                                      >
                                        {isFixingThis ? <Loader2 className="animate-spin" /> : <Wrench />}
                                        AI fix
                                      </Button>
                                    )}
                                    {canRunTests && onRunScenario && !isFrontendOnly && (
                                      <Hint text="Run this test">
                                        <Button
                                          size="icon-sm"
                                          variant="ghost"
                                          aria-label={`Run ${title}`}
                                          onClick={() => onRunScenario(sc, group)}
                                        >
                                          <Play />
                                        </Button>
                                      </Hint>
                                    )}
                                    {hasMenu && (
                                      <DropdownMenu>
                                        <DropdownMenuTrigger asChild>
                                          <Button size="icon-sm" variant="ghost" aria-label={`More actions for ${title}`}>
                                            {isDeletingThis ? <Loader2 className="animate-spin" /> : <Ellipsis />}
                                          </Button>
                                        </DropdownMenuTrigger>
                                        <DropdownMenuContent align="end">
                                          {hasEvidence && onInspectScenario && (
                                            <DropdownMenuItem onSelect={() => onInspectScenario(sc)}>
                                              <Camera size={14} /> View evidence
                                            </DropdownMenuItem>
                                          )}
                                          {canEditTests && onOpenEditScenario && (
                                            <DropdownMenuItem onSelect={() => onOpenEditScenario(sc, group)}>
                                              <Edit3 size={14} /> Edit
                                            </DropdownMenuItem>
                                          )}
                                          {onOpenSpecFile && (
                                            <DropdownMenuItem onSelect={() => onOpenSpecFile(sc.testFile || group.filePath, sc)}>
                                              <Code2 size={14} /> Open code
                                            </DropdownMenuItem>
                                          )}
                                          {canEditTests && onDeleteScenario && (
                                            <DropdownMenuItem
                                              disabled={isDeletingThis}
                                              onSelect={() => onDeleteScenario(sc, group)}
                                              className="text-rose-500 focus:text-rose-500"
                                            >
                                              <Trash2 size={14} /> Delete
                                            </DropdownMenuItem>
                                          )}
                                        </DropdownMenuContent>
                                      </DropdownMenu>
                                    )}
                                  </div>
                                </div>

                                {failed && cleanFailSummary && (
                                  <div className="ml-[3.25rem] mt-1.5 space-y-1 text-sm">
                                    <p className="leading-snug text-rose-600 dark:text-rose-300">{cleanFailSummary}</p>
                                    {rawTechnicalLog && (
                                      <details className="text-xs text-[var(--color-text-muted)]">
                                        <summary className="cursor-pointer select-none hover:text-[var(--color-text-secondary)]">
                                          Technical details
                                        </summary>
                                        <pre className="mt-1.5 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] p-2 font-mono text-xs text-[var(--color-text-secondary)]">
                                          {rawTechnicalLog}
                                        </pre>
                                      </details>
                                    )}
                                  </div>
                                )}
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}
