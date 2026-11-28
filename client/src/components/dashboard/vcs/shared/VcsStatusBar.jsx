import { useEffect, useRef, useState } from "react";
import { Check, ChevronUp, GitBranch, Layers, Loader2 } from "lucide-react";
import { VC_MODES } from "../../../../../../shared/versionControlMode.js";
import { gitService } from "../../../../services/git.service";
import { snapshotVcsService } from "../../../../services/snapshotVcs.service";

export default function VcsStatusBar({
  projectId,
  vcsSummary,
  onOpenVersionControl,
  onSync,
  isMobile = false,
  canSwitchBranch = false,
  disabledReason = "",
}) {
  const [open, setOpen] = useState(false);
  const [branches, setBranches] = useState([]);
  const [loadingBranches, setLoadingBranches] = useState(false);
  const [switchingId, setSwitchingId] = useState(null);
  const [switchError, setSwitchError] = useState("");
  const containerRef = useRef(null);

  const isGit = vcsSummary?.mode === VC_MODES.GIT_GITHUB;

  useEffect(() => {
    if (!open) return undefined;
    const handleOutside = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    window.addEventListener("mousedown", handleOutside);
    return () => window.removeEventListener("mousedown", handleOutside);
  }, [open]);

  const handleToggle = async () => {
    const nextOpen = !open;
    setOpen(nextOpen);
    setSwitchError("");
    if (!nextOpen || !projectId) return;

    setLoadingBranches(true);
    try {
      if (isGit) {
        if (!vcsSummary?.isInitialized) {
          setBranches([]);
          return;
        }
        const res = await gitService.getBranches(projectId);
        const list = res?.data?.local || [];
        setBranches(
          list.map((name) => ({
            id: name,
            name,
            isActive: name === (res?.data?.current || vcsSummary?.branchLabel),
          })),
        );
      } else {
        const res = await snapshotVcsService.listBranches(projectId);
        const list = res?.data?.branches || [];
        setBranches(
          list.map((b) => ({
            id: b.id,
            name: b.name,
            isActive: Boolean(b.isActive),
          })),
        );
      }
    } catch (err) {
      setSwitchError(err?.message || "Unable to load branches");
      setBranches([]);
    } finally {
      setLoadingBranches(false);
    }
  };

  const handleSwitchBranch = async (branch) => {
    if (!projectId || !canSwitchBranch || branch.isActive || switchingId) return;
    setSwitchingId(branch.id);
    setSwitchError("");
    try {
      if (isGit) {
        await gitService.checkout(projectId, branch.name, false);
        setOpen(false);
        await onSync?.({ reason: "git_checkout" });
      } else {
        const res = await snapshotVcsService.checkoutBranch(projectId, branch.id, {
          dirtyPolicy: "FAIL_IF_DIRTY",
        });
        setOpen(false);
        await onSync?.({
          snapshotId: res?.data?.status?.activeSnapshotId || undefined,
          reason: "snapshot_checkout",
        });
      }
      vcsSummary?.invalidateAll?.();
    } catch (err) {
      setSwitchError(
        err?.code === "DIRTY_WORKSPACE"
          ? "Uncommitted edits present — switch branch from Snapshots Workbench."
          : err?.message || "Branch switch failed",
      );
    } finally {
      setSwitchingId(null);
    }
  };

  const Icon = isGit ? GitBranch : Layers;
  const dirtyCount = vcsSummary?.dirtyCount || 0;
  const conflictCount = vcsSummary?.conflictCount || 0;
  const ahead = vcsSummary?.ahead || 0;
  const behind = vcsSummary?.behind || 0;
  const remoteRef =
    vcsSummary?.rawStatus?.remoteRef ||
    vcsSummary?.rawStatus?.tracking ||
    `origin/${vcsSummary?.branchLabel || "main"}`;

  return (
    <div className="relative flex items-center gap-1.5" ref={containerRef}>
      <button
        type="button"
        onClick={handleToggle}
        title={
          isGit
            ? `Git Branch: ${vcsSummary?.branchLabel || "main"}`
            : `Snapshot Branch: ${vcsSummary?.branchLabel || "main"} ${vcsSummary?.versionBadge || ""}`
        }
        className="flex items-center gap-1.5 px-1.5 py-0.5 rounded hover:bg-[var(--ps-surface-2)] text-[var(--ps-ink-secondary)] hover:text-[var(--ps-ink)] transition-colors duration-150 cursor-pointer"
      >
        <Icon
          size={11}
          className={
            conflictCount > 0
              ? "text-[var(--color-danger)] shrink-0"
              : dirtyCount > 0
                ? "text-[var(--color-warning)] shrink-0"
                : "text-[var(--ps-ink-muted)] shrink-0"
          }
        />
        {!isMobile && (
          <>
            <span className="font-mono tabular-nums font-medium">
              {vcsSummary?.branchLabel || "main"}
            </span>
            {vcsSummary?.versionBadge && !isGit && (
              <span className="text-[10px] font-mono tabular-nums text-[var(--ps-cobalt)]">
                {vcsSummary.versionBadge}
              </span>
            )}
            {dirtyCount > 0 && (
              <span className="text-[10px] font-mono tabular-nums text-[var(--color-warning)]">
                *{dirtyCount}
              </span>
            )}
            <ChevronUp size={10} className="text-[var(--ps-ink-muted)]" />
          </>
        )}
      </button>

      {isGit && !isMobile && behind > 0 && (
        <button
          type="button"
          data-testid="vcs-status-behind"
          onClick={() => onOpenVersionControl?.()}
          title={`Behind ${remoteRef} by ${behind} ${behind === 1 ? "commit" : "commits"} — click to open Git & GitHub and pull`}
          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-[var(--color-warning)]/12 border border-[var(--color-warning)]/30 text-[var(--color-warning)] hover:bg-[var(--color-warning)]/20 font-mono tabular-nums text-[10px] font-semibold transition-colors duration-150 cursor-pointer"
        >
          <span>↓{behind}</span>
          {ahead > 0 && (
            <span className="text-[var(--ps-ink-muted)]">↑{ahead}</span>
          )}
        </button>
      )}

      {isGit && !isMobile && behind === 0 && ahead > 0 && (
        <button
          type="button"
          onClick={() => onOpenVersionControl?.()}
          title={`Ahead of ${remoteRef} by ${ahead} ${ahead === 1 ? "commit" : "commits"} — click to push from Git & GitHub`}
          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-[var(--ps-surface-2)] border border-[var(--ps-line)] text-[var(--ps-ink-secondary)] hover:text-[var(--ps-ink)] font-mono tabular-nums text-[10px] transition-colors duration-150 cursor-pointer"
        >
          <span>↑{ahead}</span>
        </button>
      )}

      {open && (
        <div className="absolute left-0 bottom-full mb-1.5 z-50 w-64 rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface)] shadow-xl p-2 text-xs font-sans">
          <div className="flex items-center justify-between pb-1.5 mb-1.5 border-b border-[var(--color-border)]">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
              {isGit ? "Switch Git Branch" : "Switch Snapshot Branch"}
            </span>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                onOpenVersionControl?.();
              }}
              className="text-[11px] font-medium text-[var(--color-primary)] hover:underline cursor-pointer"
            >
              Open Workbench
            </button>
          </div>

          {switchError && (
            <div className="mb-1.5 px-2.5 py-1.5 rounded bg-[var(--color-surface-secondary)] border border-[var(--color-border)] border-l-2 border-l-[var(--color-danger)] text-[11px] text-[var(--color-danger)]">
              {switchError}
            </div>
          )}

          {loadingBranches ? (
            <div className="flex items-center justify-center py-4 text-[var(--color-text-muted)]">
              <Loader2 size={14} className="animate-spin" />
            </div>
          ) : branches.length === 0 ? (
            <div className="px-2 py-3 text-[11px] text-[var(--color-text-muted)] text-center">
              {isGit && !vcsSummary?.isInitialized
                ? "Git repository not initialized yet."
                : "No branches found."}
            </div>
          ) : (
            <div className="max-h-48 overflow-y-auto space-y-0.5 custom-scrollbar">
              {branches.map((branch) => {
                const disabled = !canSwitchBranch && !branch.isActive;
                return (
                  <button
                    key={branch.id}
                    type="button"
                    disabled={disabled || Boolean(switchingId)}
                    title={disabled ? disabledReason : branch.name}
                    onClick={() => handleSwitchBranch(branch)}
                    className={`w-full flex items-center justify-between gap-2 px-2 py-1.5 rounded text-left cursor-pointer transition-colors duration-150 disabled:opacity-45 disabled:cursor-not-allowed ${
                      branch.isActive
                        ? "bg-[var(--color-primary)]/12 text-[var(--color-primary)] font-semibold"
                        : "hover:bg-[var(--color-surface-secondary)] text-[var(--color-text)]"
                    }`}
                  >
                    <span className="truncate font-mono text-[11.5px]">
                      {branch.name}
                    </span>
                    {switchingId === branch.id ? (
                      <Loader2 size={11} className="animate-spin shrink-0" />
                    ) : (
                      branch.isActive && <Check size={12} className="shrink-0" />
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
