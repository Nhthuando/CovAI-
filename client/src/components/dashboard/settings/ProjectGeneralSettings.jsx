import { SlidersHorizontal, GitBranch, ExternalLink, Loader2, Layers } from "lucide-react";
import { LIFECYCLE_MANAGE_CAPABILITY } from "../../../../../shared/portfolioGovernance.js";
import ProjectLifecycleEditor from "./ProjectLifecycleEditor.jsx";
import { resolveProjectHasActivity } from "./lifecycleSettings.utils.js";

/**
 * Workspace Settings -> General & Lifecycle tab (setting=project-general).
 */
export default function ProjectGeneralSettings({
  project,
  vcsSummary = null,
  unifiedSummary = null,
  access = null,
  loading = false,
  error = null,
  onRetry = null,
  onProjectUpdated = null,
}) {
  if (!project?.id) return null;

  const hasActivity = resolveProjectHasActivity(project, unifiedSummary);
  const canManageLifecycle = Boolean(
    access?.capabilities?.includes(LIFECYCLE_MANAGE_CAPABILITY),
  );
  const activeBranch =
    vcsSummary?.branchLabel && vcsSummary.branchLabel !== "No Repo"
      ? vcsSummary.branchLabel
      : project.defaultBranch || "Local workspace";
  const activeSnapshot =
    vcsSummary?.versionBadge ||
    (project.activeSnapshotId ? project.activeSnapshotId.slice(0, 8) : "—");

  return (
    <section
      className="max-w-3xl mx-auto p-6 space-y-6 font-sans text-[var(--color-text)]"
      aria-label="Project General and Lifecycle Settings"
    >
      {/* Header */}
      <header className="space-y-1">
        <h1 className="text-lg font-semibold tracking-tight flex items-center gap-2 text-[var(--color-text)]">
          <SlidersHorizontal size={18} className="text-[var(--color-primary)] shrink-0" />
          <span>General &amp; Lifecycle</span>
        </h1>
        <p className="text-sm text-[var(--color-text-secondary)]">
          Workspace metadata and Portfolio KPI lifecycle governance for{" "}
          <strong className="text-[var(--color-text)]">{project.name}</strong>.
        </p>
      </header>

      {loading ? (
        <div
          role="status"
          className="flex items-center gap-2 p-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] text-sm text-[var(--color-text-secondary)]"
        >
          <Loader2 size={16} className="animate-spin" />
          <span>Loading project governance permissions…</span>
        </div>
      ) : error ? (
        <div
          role="alert"
          className="flex items-center justify-between gap-3 p-4 rounded-lg border border-[var(--color-danger)]/35 bg-[var(--color-danger)]/10 text-sm text-[var(--color-danger)]"
        >
          <span>{error.message || "Failed to load project permissions."}</span>
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="px-3 py-1 rounded-md text-xs font-medium border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)] cursor-pointer"
            >
              Retry
            </button>
          )}
        </div>
      ) : (
        <>
          {/* Repository & Snapshot Metadata */}
          <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg p-5 space-y-4">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
              Workspace Summary
            </h2>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
              <div className="p-3 rounded-md bg-[var(--color-surface-secondary)]/60 border border-[var(--color-border)]">
                <div className="text-[var(--color-text-muted)] mb-1">Project Name</div>
                <div className="font-semibold text-sm text-[var(--color-text)] truncate">
                  {project.name}
                </div>
              </div>

              <div className="p-3 rounded-md bg-[var(--color-surface-secondary)]/60 border border-[var(--color-border)]">
                <div className="text-[var(--color-text-muted)] mb-1">Source</div>
                {project.repoUrl ? (
                  <a
                    href={project.repoUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 font-mono text-[var(--color-primary)] hover:underline truncate max-w-full"
                  >
                    <span className="truncate">{project.repoUrl}</span>
                    <ExternalLink size={11} className="shrink-0" />
                  </a>
                ) : (
                  <span className="font-mono text-[var(--color-text-secondary)]">
                    Uploaded Snapshot Workspace
                  </span>
                )}
              </div>

              <div className="p-3 rounded-md bg-[var(--color-surface-secondary)]/60 border border-[var(--color-border)]">
                <div className="text-[var(--color-text-muted)] mb-1">Active Branch</div>
                <div className="inline-flex items-center gap-1.5 font-mono font-medium text-[var(--color-text)]">
                  <GitBranch size={12} className="text-[var(--color-primary)] shrink-0" />
                  <span>{activeBranch}</span>
                </div>
              </div>

              <div className="p-3 rounded-md bg-[var(--color-surface-secondary)]/60 border border-[var(--color-border)]">
                <div className="text-[var(--color-text-muted)] mb-1">Active Snapshot</div>
                <div className="inline-flex items-center gap-1.5 font-mono font-medium text-[var(--color-text)]">
                  <Layers size={12} className="text-[var(--color-text-muted)] shrink-0" />
                  <span>{activeSnapshot}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Lifecycle Governance Card */}
          <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg p-5 space-y-4">
            <div>
              <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
                Portfolio Lifecycle &amp; KPI Scope
              </h2>
              <p className="text-xs text-[var(--color-text-muted)] mt-1">
                Control whether this project participates in Portfolio Executive KPIs and Risk
                Quadrant metrics.
              </p>
            </div>

            <ProjectLifecycleEditor
              projectId={project.id}
              currentStatus={project.lifecycleStatus || "NOT_STARTED"}
              isPinned={Boolean(project.isPinned)}
              currentUserRole={access?.role || null}
              canManageLifecycle={canManageLifecycle}
              hasActivity={hasActivity}
              showPinToggle
              onSaved={onProjectUpdated}
            />
          </div>
        </>
      )}
    </section>
  );
}
