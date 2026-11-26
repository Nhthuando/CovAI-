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

  return (
    <div className="relative" ref={containerRef}>
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
              ? "text-rose-400 shrink-0"
              : dirtyCount > 0
                ? "text-amber-400 shrink-0"
                : "text-[var(--ps-ink-muted)] shrink-0"
          }
        />
        {!isMobile && (
          <>
            <span className="font-mono tabular-nums font-medium">
              {vcsSummary?.branchLabel || "main"}
            </span>
            {vcsSummary?.versionBadge && (
              <span className="text-[10px] font-mono tabular-nums text-[var(--ps-cobalt)]">
                {vcsSummary.versionBadge}
              </span>
            )}
            {dirtyCount > 0 && (
              <span className="text-[10px] font-mono tabular-nums text-amber-400">
                *{dirtyCount}
              </span>
            )}
            <ChevronUp size={10} className="text-[var(--ps-ink-muted)]" />
          </>
        )}
      </button>

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
            <div className="mb-1.5 px-2 py-1.5 rounded bg-rose-500/10 border border-rose-500/20 text-[11px] text-rose-400">
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
