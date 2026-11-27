import { useEffect } from "react";
import { X, SlidersHorizontal, GitBranch, ExternalLink } from "lucide-react";
import ProjectLifecycleEditor from "../../settings/ProjectLifecycleEditor.jsx";
import { resolveProjectHasActivity } from "../../settings/lifecycleSettings.utils.js";

/**
 * Quick Project Settings Modal opened from /projects Card menu (⋮ -> Project settings)
 * or Table Actions. Reuses ProjectLifecycleEditor & same RBAC/API governance flow.
 */
export default function QuickProjectSettingsModal({
  isOpen = false,
  project = null,
  onClose = null,
  onSaved = null,
  onOpenFullSettings = null,
}) {
  useEffect(() => {
    if (!isOpen) return undefined;
    const handleKeyDown = (e) => {
      if (e.key === "Escape") onClose?.();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen || !project) return null;

  const hasActivity = resolveProjectHasActivity(project);
  const displayBranch = project.branch || "local";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
      aria-labelledby="quick-project-settings-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose?.();
      }}
    >
      <div className="w-full max-w-lg rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)] shadow-xl overflow-hidden font-sans">
        {/* Modal Header */}
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-[var(--color-border)]">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <SlidersHorizontal
                size={15}
                className="text-[var(--color-primary)] shrink-0"
              />
              <h2
                id="quick-project-settings-title"
                className="text-sm font-semibold text-[var(--color-text)] truncate"
              >
                {project.name}
              </h2>
            </div>
            <div className="flex items-center gap-2 mt-1 text-[11px] font-mono text-[var(--color-text-muted)]">
              <span className="inline-flex items-center gap-1">
                <GitBranch size={11} className="text-[var(--color-primary)]" />
                <span>{displayBranch}</span>
              </span>
              {project.snapshotLabel && (
                <>
                  <span>·</span>
                  <span>{project.snapshotLabel}</span>
                </>
              )}
            </div>
          </div>

          <button
            type="button"
            onClick={() => onClose?.()}
            className="p-1.5 rounded-md text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-secondary)] transition-colors cursor-pointer"
            aria-label="Close project settings modal"
          >
            <X size={16} />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-5 max-h-[72vh] overflow-y-auto">
          <ProjectLifecycleEditor
            projectId={project.id}
            currentStatus={project.lifecycleStatus || "NOT_STARTED"}
            isPinned={Boolean(project.isPinned)}
            currentUserRole={project.currentUserRole ?? null}
            canManageLifecycle={project.canManageLifecycle}
            hasActivity={hasActivity}
            showPinToggle
            compact
            onSaved={(saved) => {
              onSaved?.(saved);
              onClose?.();
            }}
          />
        </div>

        {/* Modal Footer */}
        <div className="px-5 py-3 border-t border-[var(--color-border)] bg-[var(--color-surface-secondary)]/40 flex items-center justify-between gap-3">
          {onOpenFullSettings ? (
            <button
              type="button"
              onClick={() => onOpenFullSettings(project.id)}
              className="inline-flex items-center gap-1.5 text-xs font-mono text-[var(--color-primary)] hover:underline cursor-pointer"
            >
              <span>Open full settings in workspace</span>
              <ExternalLink size={12} />
            </button>
          ) : (
            <span />
          )}

          <button
            type="button"
            onClick={() => onClose?.()}
            className="px-3 py-1.5 rounded-md text-xs font-medium border border-[var(--color-border)] bg-[var(--color-surface-secondary)] text-[var(--color-text)] hover:border-[var(--color-border-strong)] transition-colors cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
