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
    <div className="flex flex-col h-full w-full overflow-hidden bg-[var(--color-bg)]">
      {/* Mode-Specific Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-4 border-b border-[var(--color-border)] bg-[var(--color-surface)] shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-lg bg-[var(--color-primary)]/10 border border-[var(--color-primary)]/25 flex items-center justify-center text-[var(--color-primary)] shrink-0">
            <HeaderIcon size={20} />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="text-base font-bold text-[var(--color-text)] truncate">
                {meta.title}
              </h1>
              <span
                data-testid="vcs-mode-badge"
                className="text-[10px] font-mono font-semibold uppercase tracking-wider px-2 py-0.5 rounded bg-[var(--color-primary)]/10 text-[var(--color-primary)] border border-[var(--color-primary)]/20 shrink-0"
              >
                {meta.badgeLabel}
              </span>
            </div>
            <p className="text-xs text-[var(--color-text-secondary)] mt-0.5 truncate">
              {meta.subtitle}
            </p>
          </div>
        </div>
      </div>

      {/* Exclusive Mode Workbench Body */}
      <div className="flex-1 overflow-y-auto custom-scrollbar p-5 sm:p-6">
        {!projectId ? (
          <div className="p-10 text-center border border-dashed border-[var(--color-border)] rounded-lg bg-[var(--color-surface)] text-xs text-[var(--color-text-muted)] max-w-lg mx-auto">
            Select or import a project workspace to inspect version control state.
          </div>
        ) : (
          <Suspense fallback={<SnapshotsListSkeleton count={4} />}>
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
