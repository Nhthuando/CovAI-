import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Lock, Info, Star, Loader2, Check, AlertCircle } from "lucide-react";
import { LIFECYCLE_META } from "../../../../../shared/portfolioGovernance.js";
import { updateProjectLifecycleStatusApi } from "../../../services/portfolio.service.js";
import {
  applyProjectPatchToPortfolioCache,
  applyProjectPatchToProjectsList,
} from "../../../services/portfolioDashboard/portfolioLifecycleCache.js";
import { useToast } from "../ToastContext.jsx";
import LifecycleStatusBadge from "../portfolio/primitives/LifecycleStatusBadge.jsx";
import {
  resolveLifecycleEditorState,
  formatLifecycleMutationError,
} from "./lifecycleSettings.utils.js";

/**
 * Shared lifecycle governance & pin editor used by both QuickProjectSettingsModal (/projects)
 * and Workspace Settings -> General & Lifecycle.
 */
export default function ProjectLifecycleEditor({
  projectId,
  currentStatus = "NOT_STARTED",
  isPinned = false,
  currentUserRole = null,
  canManageLifecycle = undefined,
  hasActivity = false,
  showPinToggle = true,
  compact = false,
  onSaved = null,
}) {
  const queryClient = useQueryClient();
  const { addToast, showToast } = useToast?.() || {};

  const normalizedCurrent = LIFECYCLE_META[currentStatus]
    ? currentStatus
    : "NOT_STARTED";
  const normalizedPinned = Boolean(isPinned);
  const baseKey = `${projectId || ""}:${normalizedCurrent}:${normalizedPinned}`;

  const [draft, setDraft] = useState({
    baseKey,
    status: normalizedCurrent,
    pinned: normalizedPinned,
  });
  const [isSaving, setIsSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  const activeStatus =
    draft.baseKey === baseKey ? draft.status : normalizedCurrent;
  const activePinned =
    draft.baseKey === baseKey ? draft.pinned : normalizedPinned;

  const statusChanged = activeStatus !== normalizedCurrent;
  const pinnedChanged = showPinToggle && activePinned !== normalizedPinned;
  const isDirty = statusChanged || pinnedChanged;

  const { canEdit, readOnlyReason, options } = resolveLifecycleEditorState({
    currentStatus: normalizedCurrent,
    currentUserRole,
    canManageLifecycle,
    hasActivity,
  });

  const handleSelectStatus = (nextValue) => {
    if (!canEdit || isSaving) return;
    setErrorMsg("");
    setDraft({
      baseKey,
      status: nextValue,
      pinned: activePinned,
    });
  };

  const handleTogglePin = () => {
    if (!canEdit || isSaving) return;
    setErrorMsg("");
    setDraft({
      baseKey,
      status: activeStatus,
      pinned: !activePinned,
    });
  };

  const handleReset = () => {
    setErrorMsg("");
    setDraft({
      baseKey,
      status: normalizedCurrent,
      pinned: normalizedPinned,
    });
  };

  const notifyToast = (payload) => {
    if (typeof showToast === "function") showToast(payload);
    else if (typeof addToast === "function") addToast(payload);
  };

  const handleSave = async (e) => {
    if (e?.preventDefault) e.preventDefault();
    if (!projectId || !canEdit || !isDirty || isSaving) return;

    const payload = {};
    if (statusChanged) payload.lifecycleStatus = activeStatus;
    if (pinnedChanged) payload.isPinned = activePinned;

    try {
      setIsSaving(true);
      setErrorMsg("");
      const saved = await updateProjectLifecycleStatusApi(projectId, payload);

      const nextLifecycleStatus = saved?.lifecycleStatus ?? activeStatus;
      const nextIsPinned =
        saved?.isPinned !== undefined ? Boolean(saved.isPinned) : activePinned;

      const patch = {
        ...(statusChanged && { lifecycleStatus: nextLifecycleStatus }),
        ...(pinnedChanged && { isPinned: nextIsPinned }),
      };

      queryClient.setQueryData(["projectsPortfolio", "live"], (old) =>
        applyProjectPatchToPortfolioCache(old, projectId, patch),
      );
      queryClient.setQueriesData({ queryKey: ["projects"] }, (old) =>
        applyProjectPatchToProjectsList(old, projectId, patch),
      );

      if (typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent("covai:project-status-updated", {
            detail: {
              projectId,
              lifecycleStatus: nextLifecycleStatus,
              isPinned: nextIsPinned,
            },
          }),
        );
      }

      queryClient.invalidateQueries({ queryKey: ["projectsPortfolio"] });
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      queryClient.invalidateQueries({ queryKey: ["unifiedDashboard"] });

      notifyToast({
        type: "success",
        title: "Lifecycle updated",
        message: `Project saved as ${LIFECYCLE_META[nextLifecycleStatus]?.label || nextLifecycleStatus}.`,
      });

      onSaved?.({
        projectId,
        lifecycleStatus: nextLifecycleStatus,
        isPinned: nextIsPinned,
      });
    } catch (err) {
      const msg = formatLifecycleMutationError(err);
      setErrorMsg(msg);
      notifyToast({
        type: "error",
        title: "Update failed",
        message: msg,
      });
    } finally {
      setIsSaving(false);
    }
  };

  const activeMeta = LIFECYCLE_META[activeStatus] || LIFECYCLE_META.NOT_STARTED;

  return (
    <form onSubmit={handleSave} className="space-y-4 font-sans">
      {/* Current Summary Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-[var(--color-border)]">
        <div className="flex items-center gap-2 flex-wrap">
          <LifecycleStatusBadge status={normalizedCurrent} size="sm" />
          <span
            className={`px-2 py-0.5 rounded-md text-[11px] font-mono border ${
              LIFECYCLE_META[normalizedCurrent]?.includedInKpis
                ? "bg-[var(--color-primary)]/10 text-[var(--color-primary)] border-[var(--color-primary)]/25"
                : "bg-[var(--color-surface-secondary)] text-[var(--color-text-muted)] border-[var(--color-border)]"
            }`}
          >
            {LIFECYCLE_META[normalizedCurrent]?.includedInKpis
              ? "Included in Portfolio KPIs"
              : "Excluded from Portfolio KPIs"}
          </span>
        </div>

        {currentUserRole && (
          <span className="text-[11px] font-mono text-[var(--color-text-muted)]">
            Role: <strong className="text-[var(--color-text)]">{currentUserRole}</strong>
          </span>
        )}
      </div>

      {/* RBAC Read-Only Banner */}
      {!canEdit && (
        <div
          role="status"
          className="flex items-start gap-2.5 p-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-secondary)] text-xs text-[var(--color-text-secondary)]"
        >
          <Lock size={14} className="text-[var(--color-text-muted)] shrink-0 mt-0.5" />
          <div>
            <div className="font-semibold text-[var(--color-text)]">Read-only access</div>
            <p className="mt-0.5 text-[var(--color-text-muted)]">{readOnlyReason}</p>
          </div>
        </div>
      )}

      {/* 5 Lifecycle Radio Cards */}
      <div
        role="radiogroup"
        aria-label="Project lifecycle state"
        className={compact ? "space-y-2" : "grid grid-cols-1 gap-2"}
      >
        {options.map((opt) => {
          const isSelected = activeStatus === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              role="radio"
              aria-checked={isSelected}
              disabled={opt.disabled || isSaving}
              onClick={() => handleSelectStatus(opt.value)}
              className={`w-full text-left px-3 py-2.5 rounded-lg border transition-colors duration-150 flex items-start justify-between gap-3 ${
                opt.disabled
                  ? "opacity-60 cursor-not-allowed bg-[var(--color-surface-secondary)]/50 border-[var(--color-border)]"
                  : isSelected
                    ? "bg-[var(--color-primary)]/10 border-[var(--color-primary)] cursor-pointer"
                    : "bg-[var(--color-surface)] border-[var(--color-border)] hover:border-[var(--color-border-strong)] hover:bg-[var(--color-surface-secondary)]/60 cursor-pointer"
              }`}
            >
              <div className="flex items-start gap-2.5 min-w-0">
                <span
                  className={`mt-0.5 w-4 h-4 rounded-full border flex items-center justify-center shrink-0 ${
                    isSelected
                      ? "border-[var(--color-primary)] bg-[var(--color-primary)] text-white"
                      : "border-[var(--color-border-strong)] bg-[var(--color-bg)]"
                  }`}
                >
                  {isSelected && <Check size={10} strokeWidth={3} />}
                </span>

                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-semibold text-[var(--color-text)]">
                      {opt.label}
                    </span>
                    <span
                      className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${
                        opt.includedInKpis
                          ? "bg-[var(--color-primary)]/10 text-[var(--color-primary)] border-[var(--color-primary)]/25"
                          : "bg-[var(--color-surface-secondary)] text-[var(--color-text-muted)] border-[var(--color-border)]"
                      }`}
                    >
                      {opt.includedInKpis ? "In KPIs" : "Isolated"}
                    </span>
                  </div>
                  <p className="text-[11px] text-[var(--color-text-muted)] mt-0.5 leading-snug">
                    {opt.description}
                  </p>
                  {opt.disabledReason && !opt.isCurrent && canEdit && (
                    <p className="text-[11px] text-[var(--color-warning)] mt-1 flex items-center gap-1">
                      <Info size={11} className="shrink-0" />
                      <span>{opt.disabledReason}</span>
                    </p>
                  )}
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {/* Optional Pin Toggle */}
      {showPinToggle && (
        <div className="flex items-center justify-between gap-3 p-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-secondary)]/40">
          <div className="flex items-center gap-2.5 min-w-0">
            <Star
              size={14}
              className={
                activePinned
                  ? "text-[var(--color-warning)] shrink-0"
                  : "text-[var(--color-text-muted)] shrink-0"
              }
              fill={activePinned ? "currentColor" : "none"}
            />
            <div className="min-w-0">
              <div className="text-xs font-medium text-[var(--color-text)]">
                Pin project in Portfolio
              </div>
              <div className="text-[11px] text-[var(--color-text-muted)]">
                Prioritize this repository at the top of default portfolio views
              </div>
            </div>
          </div>

          <button
            type="button"
            role="switch"
            aria-checked={activePinned}
            aria-label="Pin project in Portfolio"
            disabled={!canEdit || isSaving}
            onClick={handleTogglePin}
            className={`px-2.5 py-1 rounded-md text-xs font-mono font-medium border transition-colors duration-150 shrink-0 ${
              !canEdit
                ? "opacity-55 cursor-not-allowed bg-[var(--color-surface-secondary)] border-[var(--color-border)] text-[var(--color-text-muted)]"
                : activePinned
                  ? "bg-[var(--color-warning)]/15 text-[var(--color-warning)] border-[var(--color-warning)]/40 cursor-pointer"
                  : "bg-[var(--color-surface)] text-[var(--color-text-secondary)] border-[var(--color-border)] hover:border-[var(--color-border-strong)] cursor-pointer"
            }`}
          >
            {activePinned ? "Pinned" : "Unpinned"}
          </button>
        </div>
      )}

      {/* Auto-Transition Governance Note */}
      <div className="p-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-secondary)]/40 text-[11px] text-[var(--color-text-secondary)] space-y-1">
        <div className="font-semibold text-[var(--color-text)] flex items-center gap-1.5">
          <Info size={12} className="text-[var(--color-primary)] shrink-0" />
          <span>Lifecycle &amp; Auto-Transition Rules</span>
        </div>
        <p className="text-[var(--color-text-muted)] leading-relaxed">
          Selected state <strong>{activeMeta.label}</strong>{" "}
          {activeMeta.includedInKpis
            ? "feeds Portfolio KPIs and Risk Quadrants."
            : "is isolated from active Portfolio KPIs."}
          {" "}Projects in <strong>Not Started</strong> automatically move to{" "}
          <strong>Doing</strong> on Unit, Integration, Playwright API, System E2E, or AI
          evaluation activity. Manual <strong>Paused</strong>, <strong>Completed</strong>, and{" "}
          <strong>Cancelled</strong> states are never overwritten.
        </p>
      </div>

      {/* Inline Error Alert */}
      {errorMsg && (
        <div
          role="alert"
          className="flex items-start gap-2 p-3 rounded-lg border border-[var(--color-danger)]/35 bg-[var(--color-danger)]/10 text-xs text-[var(--color-danger)]"
        >
          <AlertCircle size={14} className="shrink-0 mt-0.5" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* Save / Reset Footer */}
      {canEdit && (
        <div className="flex items-center justify-end gap-2 pt-2">
          {isDirty && (
            <button
              type="button"
              disabled={isSaving}
              onClick={handleReset}
              className="px-3 py-1.5 rounded-md text-xs font-medium border border-[var(--color-border)] bg-[var(--color-surface-secondary)] text-[var(--color-text)] hover:border-[var(--color-border-strong)] transition-colors duration-150 cursor-pointer disabled:opacity-50"
            >
              Reset
            </button>
          )}
          <button
            type="submit"
            disabled={!isDirty || isSaving}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-md text-xs font-medium border border-transparent bg-[var(--color-primary)] text-white hover:bg-[var(--color-primary-hover)] transition-colors duration-150 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.98]"
          >
            {isSaving && <Loader2 size={13} className="animate-spin" />}
            <span>{isSaving ? "Saving..." : "Save changes"}</span>
          </button>
        </div>
      )}
    </form>
  );
}
