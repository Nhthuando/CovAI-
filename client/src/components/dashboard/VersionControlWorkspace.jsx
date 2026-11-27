import { lazy, Suspense } from "react";
import { GitBranch, Layers } from "lucide-react";
import { useAuth } from "../../hooks/useAuth";
import { resolveVcsModeMeta } from "../../services/vcsUiHelpers";
import { SnapshotsListSkeleton } from "../common/Skeleton";

const GitWorkspace = lazy(() => import("./vcs/git/GitWorkspace"));
const SnapshotVcsWorkspace = lazy(
  () => import("./vcs/snapshot/SnapshotVcsWorkspace"),
);

export default function VersionControlWorkspace({
  projectId,
  project = null,
  onSync,
  onOpenFile,
}) {
  const { vcMode } = useAuth();
  const meta = resolveVcsModeMeta(vcMode);
  const HeaderIcon = meta.isGit ? GitBranch : Layers;

  return (
    <div className="flex flex-col h-full w-full min-h-0 overflow-hidden bg-[var(--color-bg)]">
      {/* Mode-Specific Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 border-b border-[var(--color-border)] bg-[var(--color-surface)] shrink-0">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-8 h-8 rounded-md bg-[var(--color-primary)]/10 border border-[var(--color-primary)]/25 flex items-center justify-center text-[var(--color-primary)] shrink-0">
            <HeaderIcon size={17} />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="text-sm font-bold text-[var(--color-text)] truncate">
                {meta.title}
              </h1>
              <span
                data-testid="vcs-mode-badge"
                className="text-[10px] font-mono font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-[var(--color-primary)]/10 text-[var(--color-primary)] border border-[var(--color-primary)]/20 shrink-0"
              >
                {meta.badgeLabel}
              </span>
            </div>
            <p className="text-[11.5px] text-[var(--color-text-secondary)] mt-0.5 truncate">
              {meta.subtitle}
            </p>
          </div>
        </div>
      </div>

      {/* Exclusive Mode Workbench Body (viewport-locked for docked bottom panels) */}
      <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
        {!projectId ? (
          <div className="p-6">
            <div className="p-10 text-center border border-dashed border-[var(--color-border)] rounded-lg bg-[var(--color-surface)] text-xs text-[var(--color-text-muted)] max-w-lg mx-auto">
              Select or import a project workspace to inspect version control state.
            </div>
          </div>
        ) : (
          <Suspense
            fallback={
              <div className="p-5">
                <SnapshotsListSkeleton count={4} />
              </div>
            }
          >
            {meta.isGit ? (
              <GitWorkspace
                key={`git:${projectId}`}
                projectId={projectId}
                project={project}
                onSync={onSync}
                onOpenFile={onOpenFile}
              />
            ) : (
              <SnapshotVcsWorkspace
                key={`snap:${projectId}`}
                projectId={projectId}
                project={project}
                onSync={onSync}
                onOpenFile={onOpenFile}
              />
            )}
          </Suspense>
        )}
      </div>
    </div>
  );
}
