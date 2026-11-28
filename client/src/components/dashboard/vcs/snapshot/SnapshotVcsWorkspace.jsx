import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BookmarkPlus,
  Check,
  ChevronDown,
  Download,
  FolderSearch,
  GitBranch,
  GitCompare,
  GitMerge,
  HardDrive,
  History,
  Layers,
  Loader2,
  Pin,
  PinOff,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Sparkles,
  Tag,
  Trash2,
} from "lucide-react";
import Button from "../../../common/Button";
import ConfirmDialog from "../../../common/ConfirmDialog";
import { SnapshotsListSkeleton } from "../../../common/Skeleton";
import VcsChangesTree from "../shared/VcsChangesTree";
import VcsMonacoDiffEditor from "../shared/VcsMonacoDiffEditor";
import VcsCommitGraph from "../shared/VcsCommitGraph";
import VcsConflictResolver from "../shared/VcsConflictResolver";
import VcsInlineBanner from "../shared/VcsInlineBanner";
import SnapshotComparePanel from "./SnapshotComparePanel";
import SnapshotBrowsePanel from "./SnapshotBrowsePanel";
import { snapshotVcsService } from "../../../../services/snapshotVcs.service";
import { useProjectAccess } from "../../../../hooks/useProjectAccess";
import { useVcsSync } from "../../../../hooks/useVcsSync";
import {
  applyOptimisticStage,
  applyOptimisticUnstage,
  buildVcsPermissions,
  extractVcsStatusFromResponse,
  formatRelativeTime,
  getVcsStatusMeta,
} from "../../../../services/vcsUiHelpers";
import { VC_MODES } from "../../../../../../shared/versionControlMode.js";

export default function SnapshotVcsWorkspace({
  projectId,
  onSync,
  onOpenFile,
}) {
  const access = useProjectAccess(projectId);
  const perms = useMemo(
    () => buildVcsPermissions(access, VC_MODES.SNAPSHOT_VCS),
    [access],
  );
  const vcsSummary = useVcsSync(projectId);
  const status = vcsSummary.rawStatus;

  const [subTab, setSubTab] = useState("diff");
  const [notice, setNotice] = useState(null);
  const [busyAction, setBusyAction] = useState("");
  const [pendingStageKeys, setPendingStageKeys] = useState(() => new Set());
  const noticeTimerRef = useRef(null);

  // Capture Box
  const [captureLabel, setCaptureLabel] = useState("");
  const [captureMessage, setCaptureMessage] = useState("");
  const [captureTag, setCaptureTag] = useState("");
  const [showExtraFields, setShowExtraFields] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);

  // Selected Diff
  const [selectedFile, setSelectedFile] = useState(null);
  const [diffData, setDiffData] = useState(null);
  const [loadingDiff, setLoadingDiff] = useState(false);
  const [diffError, setDiffError] = useState("");
  const [pendingDiscard, setPendingDiscard] = useState(null);
  const diffRequestSeqRef = useRef(0);
  const diffAbortRef = useRef(null);

  // Timeline / Checkpoints
  const [checkpoints, setCheckpoints] = useState([]);
  const [loadingTimeline, setLoadingTimeline] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [branchFilter, setBranchFilter] = useState("");
  const [tagFilter, setTagFilter] = useState("");
  const [pinnedOnly, setPinnedOnly] = useState(false);
  const [selectedCheckpoint, setSelectedCheckpoint] = useState(null);
  const [editingMeta, setEditingMeta] = useState(false);
  const [editLabelVal, setEditLabelVal] = useState("");
  const [editMsgVal, setEditMsgVal] = useState("");
  const [inlineTagName, setInlineTagName] = useState("");
  const [showInlineBranchForm, setShowInlineBranchForm] = useState(false);
  const [inlineBranchName, setInlineBranchName] = useState("");
  const [inspectorDiffState, setInspectorDiffState] = useState({
    checkpointId: null,
    loading: false,
    changes: [],
    error: "",
  });

  // Rollback & Delete Confirmations
  const [pendingRollback, setPendingRollback] = useState(null);
  const [rollbackAutoBackup, setRollbackAutoBackup] = useState(true);
  const [pendingDeleteCheckpoint, setPendingDeleteCheckpoint] = useState(null);

  // Branches & 3-Way Merge
  const [branchesState, setBranchesState] = useState({
    activeBranchId: null,
    branches: [],
  });
  const [showBranchMenu, setShowBranchMenu] = useState(false);
  const [newBranchName, setNewBranchName] = useState("");
  const [newBranchFromId, setNewBranchFromId] = useState("");
  const [newBranchDesc, setNewBranchDesc] = useState("");
  const [newBranchCheckout, setNewBranchCheckout] = useState(false);
  const [renameBranchId, setRenameBranchId] = useState(null);
  const [renameBranchVal, setRenameBranchVal] = useState("");
  const [pendingDeleteBranch, setPendingDeleteBranch] = useState(null);
  const [dirtyCheckoutPrompt, setDirtyCheckoutPrompt] = useState(null);
  const [mergeConflictState, setMergeConflictState] = useState(null);
  const [resolvingMerge, setResolvingMerge] = useState(false);
  const branchMenuRef = useRef(null);

  // Tags
  const [tags, setTags] = useState([]);
  const [tagModalName, setTagModalName] = useState("");
  const [tagModalSnapshotId, setTagModalSnapshotId] = useState("");
  const [tagModalDesc, setTagModalDesc] = useState("");
  const [pendingDeleteTag, setPendingDeleteTag] = useState(null);

  // Browse initial ID when jumping from Timeline
  const [browseSnapshotId, setBrowseSnapshotId] = useState("");

  const showNotice = useCallback((type, text) => {
    if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
    setNotice({ type, text });
    noticeTimerRef.current = setTimeout(() => setNotice(null), 5000);
  }, []);

  useEffect(() => {
    return () => {
      if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
      diffAbortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    const onOutside = (e) => {
      if (branchMenuRef.current && !branchMenuRef.current.contains(e.target)) {
        setShowBranchMenu(false);
      }
    };
    window.addEventListener("mousedown", onOutside);
    return () => window.removeEventListener("mousedown", onOutside);
  }, []);

  const loadCheckpoints = useCallback(async () => {
    if (!projectId) return;
    setLoadingTimeline(true);
    try {
      const res = await snapshotVcsService.listCheckpoints(projectId, {
        branchId: branchFilter || undefined,
        search: searchTerm.trim() || undefined,
        tag: tagFilter || undefined,
        pinnedOnly: pinnedOnly || undefined,
        limit: 100,
      });
      const rows = res?.data?.checkpoints || [];
      setCheckpoints(rows);
      setSelectedCheckpoint((prev) => {
        if (prev) {
          const updated = rows.find((r) => r.id === prev.id);
          if (updated) return updated;
        }
        return rows.find((r) => r.isCurrent) || rows[0] || null;
      });
    } catch (err) {
      showNotice("error", err?.message || "Failed to load checkpoints");
    } finally {
      setLoadingTimeline(false);
    }
  }, [projectId, branchFilter, searchTerm, tagFilter, pinnedOnly, showNotice]);

  const loadBranches = useCallback(async () => {
    if (!projectId) return;
    try {
      const res = await snapshotVcsService.listBranches(projectId);
      if (res?.data) setBranchesState(res.data);
    } catch (err) {
      showNotice("error", err?.message || "Failed to load branches");
    }
  }, [projectId, showNotice]);

  const loadTags = useCallback(async () => {
    if (!projectId) return;
    try {
      const res = await snapshotVcsService.listTags(projectId);
      setTags(res?.data || []);
    } catch (err) {
      showNotice("error", err?.message || "Failed to load tags");
    }
  }, [projectId, showNotice]);

  useEffect(() => {
    if (!projectId) return undefined;
    let active = true;
    const needsCheckpoints = ["timeline", "compare", "browse", "branches"].includes(subTab);
    const needsTags = ["timeline", "tags"].includes(subTab);

    snapshotVcsService
      .listBranches(projectId)
      .then((brRes) => {
        if (active && brRes?.data) setBranchesState(brRes.data);
      })
      .catch((err) => {
        if (active) showNotice("error", err?.message || "Failed to load branches");
      });

    if (needsCheckpoints) {
      snapshotVcsService
        .listCheckpoints(projectId, { limit: 100 })
        .then((cpRes) => {
          if (!active) return;
          const rows = cpRes?.data?.checkpoints || [];
          setCheckpoints(rows);
          setSelectedCheckpoint((prev) => {
            if (prev) {
              const updated = rows.find((r) => r.id === prev.id);
              if (updated) return updated;
            }
            return rows.find((r) => r.isCurrent) || rows[0] || null;
          });
        })
        .catch((err) => {
          if (active) showNotice("error", err?.message || "Failed to load checkpoints");
        });
    }

    if (needsTags) {
      snapshotVcsService
        .listTags(projectId)
        .then((tagRes) => {
          if (active) setTags(tagRes?.data || []);
        })
        .catch((err) => {
          if (active) showNotice("error", err?.message || "Failed to load tags");
        });
    }

    return () => {
      active = false;
    };
  }, [projectId, subTab, status?.activeSnapshotId, status?.checkpointsCount, showNotice]);

  useEffect(() => {
    const cpId = selectedCheckpoint?.id;
    const parentId = selectedCheckpoint?.parentSnapshotId;
    if (!projectId || subTab !== "timeline" || !cpId || !parentId) return undefined;

    const controller = new AbortController();
    snapshotVcsService
      .compareCheckpoints(projectId, {
        baseSnapshotId: parentId,
        targetSnapshotId: cpId,
        signal: controller.signal,
      })
      .then((res) => {
        setInspectorDiffState({
          checkpointId: cpId,
          loading: false,
          changes: res?.data?.changes || [],
          error: "",
        });
      })
      .catch((err) => {
        if (err?.name === "AbortError") return;
        setInspectorDiffState({
          checkpointId: cpId,
          loading: false,
          changes: [],
          error: err?.message || "Could not load changed files",
        });
      });

    return () => {
      controller.abort();
    };
  }, [projectId, subTab, selectedCheckpoint?.id, selectedCheckpoint?.parentSnapshotId]);

  const loadDiffPair = useCallback(
    async (item, section, { baseSnapshotId, targetSnapshotId } = {}) => {
      if (!projectId || !item?.path) return;
      diffAbortRef.current?.abort();
      const controller = new AbortController();
      diffAbortRef.current = controller;
      const reqId = ++diffRequestSeqRef.current;

      setSelectedFile({ ...item, section });
      setSubTab("diff");
      setLoadingDiff(true);
      setDiffError("");
      try {
        const res = await snapshotVcsService.getDiffPair(projectId, {
          filePath: item.path,
          origPath: item.origPath,
          baseSnapshotId,
          targetSnapshotId,
          signal: controller.signal,
        });
        if (reqId !== diffRequestSeqRef.current) return;
        setDiffData(res?.data || null);
      } catch (err) {
        if (err?.name === "AbortError" || reqId !== diffRequestSeqRef.current) return;
        setDiffError(err?.message || "Failed to load file diff");
        setDiffData(null);
      } finally {
        if (reqId === diffRequestSeqRef.current) {
          setLoadingDiff(false);
        }
      }
    },
    [projectId],
  );

  const runAction = async (
    label,
    fn,
    { syncWorkspace = false, reason = "snapshot_op", successText = "" } = {},
  ) => {
    setBusyAction(label);
    const endLocalMutation = vcsSummary.beginLocalMutation?.() || (() => {});
    try {
      const res = await fn();
      const nextStatus = extractVcsStatusFromResponse(VC_MODES.SNAPSHOT_VCS, res);
      if (nextStatus) {
        vcsSummary.applyStatusData(nextStatus);
      } else {
        vcsSummary.invalidateAll();
      }
      if (res?.data?.branches?.branches) {
        setBranchesState(res.data.branches);
      }
      if (syncWorkspace) {
        const nextSnapId =
          res?.data?.checkpoint?.id ||
          res?.data?.restoredCheckpoint?.id ||
          res?.data?.checkpointId ||
          res?.data?.status?.activeSnapshotId ||
          undefined;
        await onSync?.({
          snapshotId: nextSnapId,
          reason,
          skipVcsRefetch: Boolean(nextStatus),
        });
      }
      if (successText) showNotice("success", successText);
      return res;
    } catch (err) {
      if (
        err?.code !== "DIRTY_WORKSPACE" &&
        err?.code !== "SNAPSHOT_MERGE_CONFLICT"
      ) {
        showNotice("error", err?.message || `Failed: ${label}`);
      }
      throw err;
    } finally {
      endLocalMutation();
      setBusyAction("");
    }
  };

  const buildStageActionKeys = (prefix, { files, folder } = {}) => {
    if (folder) return [`${prefix}Folder:${folder}`];
    if (files === "all" || !files) return [`${prefix}:all`];
    return (Array.isArray(files) ? files : [files]).map((f) => `${prefix}:${f}`);
  };

  const handleStageOptimistic = async ({ files, folder } = {}) => {
    const keys = buildStageActionKeys("stage", { files, folder });
    setPendingStageKeys((prev) => new Set([...prev, ...keys]));
    const rollback = await vcsSummary.updateStatusOptimistic((prev) =>
      applyOptimisticStage(VC_MODES.SNAPSHOT_VCS, prev, { files, folder }),
    );
    try {
      const res = await snapshotVcsService.stageFiles(projectId, { files, folder });
      const nextStatus = extractVcsStatusFromResponse(VC_MODES.SNAPSHOT_VCS, res);
      if (nextStatus) {
        vcsSummary.applyStatusData(nextStatus);
      } else {
        vcsSummary.invalidateAll();
      }
    } catch (err) {
      rollback();
      showNotice("error", err?.message || "Failed to stage files");
    } finally {
      setPendingStageKeys((prev) => {
        const next = new Set(prev);
        keys.forEach((k) => next.delete(k));
        return next;
      });
    }
  };

  const handleUnstageOptimistic = async ({ files, folder } = {}) => {
    const keys = buildStageActionKeys("unstage", { files, folder });
    setPendingStageKeys((prev) => new Set([...prev, ...keys]));
    const rollback = await vcsSummary.updateStatusOptimistic((prev) =>
      applyOptimisticUnstage(VC_MODES.SNAPSHOT_VCS, prev, { files, folder }),
    );
    try {
      const res = await snapshotVcsService.unstageFiles(projectId, { files, folder });
      const nextStatus = extractVcsStatusFromResponse(VC_MODES.SNAPSHOT_VCS, res);
      if (nextStatus) {
        vcsSummary.applyStatusData(nextStatus);
      } else {
        vcsSummary.invalidateAll();
      }
    } catch (err) {
      rollback();
      showNotice("error", err?.message || "Failed to unstage files");
    } finally {
      setPendingStageKeys((prev) => {
        const next = new Set(prev);
        keys.forEach((k) => next.delete(k));
        return next;
      });
    }
  };

  const handleAiSummary = async () => {
    if (aiLoading || !perms.canAi) return;
    setAiLoading(true);
    try {
      const res = await snapshotVcsService.generateAiSummary(projectId);
      const data = res?.data;
      if (data) {
        setCaptureLabel(data.label || "");
        if (data.message) {
          setCaptureMessage(data.message);
          setShowExtraFields(true);
        }
        if (data.suggestedTag) {
          setCaptureTag(data.suggestedTag);
          setShowExtraFields(true);
        }
      }
    } catch (err) {
      showNotice("error", err?.message || "Failed to generate AI summary");
    } finally {
      setAiLoading(false);
    }
  };

  const handleCapture = async (e) => {
    e?.preventDefault?.();
    if (!captureLabel.trim() || busyAction) return;
    const totalDirty =
      (status?.staged?.length || 0) + (status?.unstaged?.length || 0);
    if (totalDirty === 0) {
      showNotice("error", "Workspace has no changes to capture.");
      return;
    }

    const res = await runAction(
      "capture checkpoint",
      () =>
        snapshotVcsService.captureCheckpoint(projectId, {
          label: captureLabel.trim(),
          message: captureMessage.trim() || undefined,
          tag: captureTag.trim() || undefined,
          stageAll: (status?.staged?.length || 0) === 0,
        }),
      {
        syncWorkspace: true,
        reason: "snapshot_capture",
        successText: `Captured checkpoint "${captureLabel.trim()}"`,
      },
    );
    if (res) {
      setCaptureLabel("");
      setCaptureMessage("");
      setCaptureTag("");
      setSelectedFile(null);
      setDiffData(null);
    }
  };

  const handleAttemptCheckoutBranch = async (branch, dirtyPolicy = "FAIL_IF_DIRTY") => {
    setShowBranchMenu(false);
    try {
      await runAction(
        `checkout ${branch.name}`,
        () =>
          snapshotVcsService.checkoutBranch(projectId, branch.id, { dirtyPolicy }),
        {
          syncWorkspace: true,
          reason: "snapshot_checkout",
          successText: `Switched to branch '${branch.name}'`,
        },
      );
      setDirtyCheckoutPrompt(null);
      setSelectedFile(null);
      setDiffData(null);
      await Promise.all([loadBranches(), loadCheckpoints()]);
    } catch (err) {
      if (err?.code === "DIRTY_WORKSPACE") {
        setDirtyCheckoutPrompt({
          kind: "checkout",
          branch,
          dirtyCount: err.details?.dirtyCount || totalChanges,
          changes: err.details?.changes || [],
        });
      }
    }
  };

  const handleMergeBranch = async (sourceBranch, dirtyPolicy = "FAIL_IF_DIRTY") => {
    try {
      const res = await runAction(
        `merge ${sourceBranch.name}`,
        () =>
          snapshotVcsService.mergeBranch(projectId, {
            sourceBranchId: sourceBranch.id,
            dirtyPolicy,
          }),
        {
          syncWorkspace: true,
          reason: "snapshot_merge",
          successText: `Merged '${sourceBranch.name}' cleanly!`,
        },
      );
      if (res?.data?.merged) {
        setDirtyCheckoutPrompt(null);
        setMergeConflictState(null);
        await Promise.all([loadBranches(), loadCheckpoints()]);
      }
    } catch (err) {
      if (err?.code === "DIRTY_WORKSPACE") {
        setDirtyCheckoutPrompt({
          kind: "merge",
          branch: sourceBranch,
          dirtyCount: err.details?.dirtyCount || totalChanges,
          changes: err.details?.changes || [],
        });
        return;
      }
      if (err?.code === "SNAPSHOT_MERGE_CONFLICT") {
        setDirtyCheckoutPrompt(null);
        setMergeConflictState({
          sourceBranch: err.details?.sourceBranch || sourceBranch,
          targetBranch: err.details?.targetBranch || activeBranch,
          conflicts: err.details?.conflicts || [],
        });
        showNotice(
          "error",
          `Merge conflict in ${err.details?.conflicts?.length || 1} file(s). Resolve conflicts below.`,
        );
      }
    }
  };

  const handleResolveSnapshotMerge = async (resolutionsMap, dirtyPolicy = "FAIL_IF_DIRTY") => {
    if (!mergeConflictState?.sourceBranch?.id) return;
    setResolvingMerge(true);
    try {
      await runAction(
        "resolve snapshot merge",
        () =>
          snapshotVcsService.resolveMergeBranch(projectId, {
            sourceBranchId: mergeConflictState.sourceBranch.id,
            dirtyPolicy,
            resolutions: resolutionsMap,
          }),
        {
          syncWorkspace: true,
          reason: "snapshot_merge_resolve",
          successText: "3-way merge completed and new checkpoint captured!",
        },
      );
      setDirtyCheckoutPrompt(null);
      setMergeConflictState(null);
      await Promise.all([loadBranches(), loadCheckpoints()]);
    } catch (err) {
      if (err?.code === "DIRTY_WORKSPACE") {
        setDirtyCheckoutPrompt({
          kind: "mergeResolve",
          branch: mergeConflictState.sourceBranch,
          resolutionsMap,
          dirtyCount: err.details?.dirtyCount || totalChanges,
          changes: err.details?.changes || [],
        });
      }
    } finally {
      setResolvingMerge(false);
    }
  };

  const stagedCount = status?.staged?.length || 0;
  const unstagedCount = status?.unstaged?.length || 0;
  const totalChanges = stagedCount + unstagedCount;
  const activeBranch = status?.activeBranch || branchesState.branches?.find((b) => b.isActive);
  const headCp = status?.headCheckpoint;

  return (
    <div className="h-full min-h-0 flex flex-col overflow-hidden px-4 sm:px-5 py-3 gap-2.5">
      {/* Real-time Operation Notice (GC completed) */}
      {vcsSummary.activeOperation && (
        <VcsInlineBanner
          tone="info"
          pulsing
          mono
          title={vcsSummary.activeOperation.message}
          actions={
            <span className="uppercase font-mono text-[10px] text-[var(--color-text-muted)]">
              {vcsSummary.activeOperation.phase}
            </span>
          }
        />
      )}

      {notice && (
        <VcsInlineBanner
          tone={notice.type === "error" ? "danger" : "success"}
          title={notice.text}
          onDismiss={() => setNotice(null)}
        />
      )}

      {/* Top Command Bar */}
      <div className="shrink-0 flex flex-wrap items-center justify-between gap-2 p-2.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]">
        <div className="flex flex-wrap items-center gap-2">
          {/* Active Snapshot Branch Dropdown */}
          <div className="relative" ref={branchMenuRef}>
            <button
              type="button"
              onClick={() => setShowBranchMenu((o) => !o)}
              className="inline-flex items-center gap-2 h-8 px-3 rounded-md bg-[var(--color-surface-secondary)] hover:bg-[var(--color-border)]/40 border border-[var(--color-border)] text-xs font-mono text-[var(--color-text)] cursor-pointer transition-colors duration-150"
            >
              <GitBranch size={13} className="text-[var(--color-primary)]" />
              <span className="font-semibold">
                {activeBranch?.name || "main"}
              </span>
              <ChevronDown size={12} className="text-[var(--color-text-muted)]" />
            </button>

            {showBranchMenu && (
              <div className="absolute left-0 top-full mt-1.5 z-40 w-64 rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface)] shadow-xl p-2 text-xs">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--color-text-muted)] px-1 pb-1.5 mb-1.5 border-b border-[var(--color-border)]">
                  Switch Local Branch
                </div>
                <div className="max-h-48 overflow-y-auto space-y-0.5 custom-scrollbar">
                  {(branchesState.branches || []).map((b) => (
                    <button
                      key={b.id}
                      type="button"
                      disabled={
                        b.isActive ||
                        !perms.canRestoreAndAdmin ||
                        Boolean(busyAction)
                      }
                      title={
                        !perms.canRestoreAndAdmin
                          ? perms.disabledReason("restore")
                          : b.name
                      }
                      onClick={() => handleAttemptCheckoutBranch(b)}
                      className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded text-left font-mono cursor-pointer disabled:opacity-50 ${
                        b.isActive
                          ? "bg-[var(--color-primary)]/12 text-[var(--color-primary)] font-semibold"
                          : "hover:bg-[var(--color-surface-secondary)] text-[var(--color-text)]"
                      }`}
                    >
                      <span className="truncate">{b.name}</span>
                      {b.isActive && <Check size={12} />}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {headCp && (
            <div className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-md bg-[var(--color-surface-secondary)] border border-[var(--color-border)] text-xs font-mono text-[var(--color-text-secondary)]">
              <Layers size={12} className="text-[var(--color-primary)]" />
              <span className="font-semibold text-[var(--color-primary)]">
                #{headCp.versionNumber ? `v${headCp.versionNumber}` : "v1"}
              </span>
              {headCp.shortHash && (
                <span className="text-[10.5px] text-[var(--color-text-muted)]">
                  {headCp.shortHash}
                </span>
              )}
              <span className="truncate max-w-[160px] font-sans">
                {headCp.label}
              </span>
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <Button
            size="sm"
            variant="secondary"
            icon={Download}
            disabled={!perms.canExport || !status?.activeSnapshotId}
            title={!perms.canExport ? perms.disabledReason("export") : "Download active checkpoint ZIP"}
            onClick={() =>
              snapshotVcsService.exportCheckpointZip(
                projectId,
                status.activeSnapshotId,
              )
            }
          >
            Export ZIP
          </Button>
          <Button
            size="sm"
            variant="outline"
            icon={HardDrive}
            loading={busyAction === "cas gc"}
            disabled={!perms.canRestoreAndAdmin || Boolean(busyAction)}
            title={
              !perms.canRestoreAndAdmin
                ? perms.disabledReason("restore")
                : "Clean up unreferenced CAS storage blobs"
            }
            onClick={async () => {
              const res = await runAction(
                "cas gc",
                () => snapshotVcsService.runGarbageCollection(projectId),
              );
              showNotice(
                "success",
                `CAS GC finished: deleted ${res?.data?.deletedCount || 0} orphan blob(s), freed ${res?.data?.freedBytes || 0} bytes.`,
              );
            }}
          >
            Storage GC
          </Button>
          <Button
            size="sm"
            variant="outline"
            icon={RefreshCw}
            onClick={() => {
              vcsSummary.refetch();
              void Promise.all([loadBranches(), loadCheckpoints(), loadTags()]);
            }}
          />
        </div>
      </div>

      {/* Main 2-Zone Workbench */}
      <div className="flex-1 min-h-0 grid grid-cols-1 xl:grid-cols-12 gap-3.5 overflow-y-auto xl:overflow-hidden">
        {/* LEFT PANE: Capture Box & Working Tree Changes */}
        <div className="xl:col-span-4 flex flex-col min-h-0 xl:overflow-y-auto custom-scrollbar gap-2.5 xl:pr-0.5">
          <form
            onSubmit={handleCapture}
            className="p-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] space-y-2 shrink-0"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-text-muted)] flex items-center gap-1.5">
                <BookmarkPlus size={13} className="text-[var(--color-primary)]" />
                Capture Checkpoint
              </span>
              <button
                type="button"
                disabled={!perms.canAi || totalChanges === 0 || aiLoading}
                title={
                  !perms.canAi
                    ? perms.disabledReason("ai")
                    : "Generate summary label & tag with Gemini AI"
                }
                onClick={handleAiSummary}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium bg-[var(--color-surface-secondary)] hover:border-[var(--color-primary)] border border-[var(--color-border)] text-[var(--color-text)] disabled:opacity-45 disabled:cursor-not-allowed cursor-pointer transition-colors duration-150"
              >
                {aiLoading ? (
                  <Loader2 size={11} className="animate-spin" />
                ) : (
                  <Sparkles size={11} className="text-[var(--color-primary)]" />
                )}
                <span>AI Summary</span>
              </button>
            </div>

            <input
              type="text"
              value={captureLabel}
              onChange={(e) => setCaptureLabel(e.target.value)}
              onKeyDown={(e) => {
                if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
                  e.preventDefault();
                  void handleCapture();
                }
              }}
              disabled={!perms.canLocalWrite}
              placeholder={
                perms.canLocalWrite
                  ? "Checkpoint label (Ctrl+Enter to capture)"
                  : perms.disabledReason("local")
              }
              className="w-full h-9 px-2.5 rounded-md bg-[var(--color-surface-secondary)] border border-[var(--color-border)] focus:border-[var(--color-primary)] outline-none text-xs font-medium text-[var(--color-text)] placeholder:text-[var(--color-text-muted)] disabled:opacity-50"
            />

            {showExtraFields && (
              <div className="space-y-2">
                <textarea
                  value={captureMessage}
                  onChange={(e) => setCaptureMessage(e.target.value)}
                  disabled={!perms.canLocalWrite}
                  placeholder="Detailed checkpoint notes (optional)"
                  rows={2}
                  className="w-full p-2 rounded-md bg-[var(--color-surface-secondary)] border border-[var(--color-border)] focus:border-[var(--color-primary)] outline-none text-xs text-[var(--color-text)] placeholder:text-[var(--color-text-muted)] resize-y"
                />
                <input
                  type="text"
                  value={captureTag}
                  onChange={(e) => setCaptureTag(e.target.value)}
                  disabled={!perms.canLocalWrite}
                  placeholder="Optional milestone tag (e.g. v1.2.0)"
                  className="w-full h-8 px-2.5 rounded-md bg-[var(--color-surface-secondary)] border border-[var(--color-border)] font-mono text-xs text-[var(--color-text)] placeholder:text-[var(--color-text-muted)] outline-none"
                />
              </div>
            )}

            <div className="flex items-center justify-between text-[11px]">
              <button
                type="button"
                onClick={() => setShowExtraFields((v) => !v)}
                className="text-[var(--color-text-muted)] hover:text-[var(--color-text)] cursor-pointer"
              >
                {showExtraFields ? "Hide notes & tag" : "+ Notes & tag"}
              </button>
              <span className="font-mono tabular-nums text-[var(--color-text-muted)]">
                {stagedCount > 0
                  ? `${stagedCount} staged`
                  : `${totalChanges} changed`}
              </span>
            </div>

            <Button
              type="submit"
              variant="primary"
              size="md"
              icon={BookmarkPlus}
              loading={busyAction === "capture checkpoint"}
              disabled={
                !perms.canLocalWrite ||
                !captureLabel.trim() ||
                totalChanges === 0 ||
                Boolean(busyAction)
              }
              title={!perms.canLocalWrite ? perms.disabledReason("local") : ""}
              className="w-full"
            >
              {stagedCount > 0
                ? `Capture Staged (${stagedCount})`
                : `Stage All & Capture (${totalChanges})`}
            </Button>
          </form>

          <VcsChangesTree
            mode="snapshot"
            staged={status?.staged || []}
            unstaged={status?.unstaged || []}
            selectedFile={selectedFile}
            onSelectFile={loadDiffPair}
            onStage={(files) => handleStageOptimistic({ files })}
            onUnstage={(files) => handleUnstageOptimistic({ files })}
            onStageAll={() => handleStageOptimistic({ files: "all" })}
            onUnstageAll={() => handleUnstageOptimistic({ files: "all" })}
            onStageFolder={(folder) => handleStageOptimistic({ folder })}
            onUnstageFolder={(folder) => handleUnstageOptimistic({ folder })}
            onDiscard={(item) => setPendingDiscard(item)}
            onDiscardAll={() => setPendingDiscard({ all: true })}
            onOpenInEditor={onOpenFile}
            canLocalWrite={perms.canLocalWrite}
            disabledReason={perms.disabledReason("local")}
            pendingActions={pendingStageKeys}
          />
        </div>

        {/* RIGHT PANE: Sub-tabs Workbench */}
        <div className="xl:col-span-8 flex flex-col min-h-0 xl:overflow-hidden gap-2.5 min-w-0">
          <div className="shrink-0 flex items-center gap-1 p-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] overflow-x-auto custom-scrollbar">
            {[
              { id: "diff", label: "Diff Editor", icon: GitCompare },
              { id: "timeline", label: "Timeline & Graph", icon: History },
              { id: "compare", label: "Compare", icon: Layers },
              { id: "browse", label: "Browse Files", icon: FolderSearch },
              { id: "branches", label: "Branches & Merge", icon: GitBranch },
              { id: "tags", label: "Tags", icon: Tag },
            ].map((tab) => {
              const Icon = tab.icon;
              const active = subTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setSubTab(tab.id)}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap cursor-pointer transition-colors duration-150 ${
                    active
                      ? "bg-[var(--color-surface-secondary)] text-[var(--color-text)] border border-[var(--color-border-strong)]"
                      : "text-[var(--color-text-muted)] hover:text-[var(--color-text)] border border-transparent"
                  }`}
                >
                  <Icon
                    size={13}
                    className={active ? "text-[var(--color-primary)]" : ""}
                  />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </div>

          {/* SUB-TAB 1: DIFF EDITOR */}
          {subTab === "diff" && (
            <div className="flex-1 min-h-[260px]">
              <VcsMonacoDiffEditor
                diffData={diffData}
                loading={loadingDiff}
                error={diffError}
                emptyTitle="No changed file selected"
                emptySubtitle="Select a modified, added, renamed, or deleted file on the left to inspect its diff against the HEAD checkpoint."
                onOpenInEditor={onOpenFile}
              />
            </div>
          )}

          {/* SUB-TAB 2: TIMELINE & GRAPH */}
          {subTab === "timeline" && (
            <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar pr-0.5 space-y-3">
              {/* Filters */}
              <div className="p-2.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] flex flex-wrap items-center gap-2 text-xs">
                <div className="flex-1 min-w-[160px] flex items-center gap-1.5 h-8 px-2.5 rounded-md bg-[var(--color-surface-secondary)] border border-[var(--color-border)]">
                  <Search size={12} className="text-[var(--color-text-muted)]" />
                  <input
                    type="text"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    placeholder="Search checkpoints..."
                    className="w-full bg-transparent outline-none text-xs text-[var(--color-text)]"
                  />
                </div>
                <select
                  value={branchFilter}
                  onChange={(e) => setBranchFilter(e.target.value)}
                  className="h-8 px-2 rounded-md bg-[var(--color-surface-secondary)] border border-[var(--color-border)] font-mono text-xs text-[var(--color-text)]"
                >
                  <option value="">All Branches</option>
                  {(branchesState.branches || []).map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
                <select
                  value={tagFilter}
                  onChange={(e) => setTagFilter(e.target.value)}
                  className="h-8 px-2 rounded-md bg-[var(--color-surface-secondary)] border border-[var(--color-border)] font-mono text-xs text-[var(--color-text)]"
                >
                  <option value="">All Tags</option>
                  {tags.map((t) => (
                    <option key={t.id} value={t.name}>
                      {t.name}
                    </option>
                  ))}
                </select>
                <label className="inline-flex items-center gap-1.5 px-2 text-xs text-[var(--color-text-secondary)] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={pinnedOnly}
                    onChange={(e) => setPinnedOnly(e.target.checked)}
                  />
                  <span>Pinned only</span>
                </label>
                <Button size="sm" variant="secondary" onClick={loadCheckpoints}>
                  Apply
                </Button>
              </div>

              {loadingTimeline && checkpoints.length === 0 ? (
                <SnapshotsListSkeleton count={4} />
              ) : (
                <VcsCommitGraph
                  items={checkpoints}
                  selectedId={selectedCheckpoint?.id}
                  onSelect={(cp) => {
                    setSelectedCheckpoint(cp);
                    setEditingMeta(false);
                  }}
                  renderItemMeta={(cp) => (
                    <div className="hidden sm:flex items-center gap-1 shrink-0">
                      {cp.isCurrent && (
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-[var(--color-success)]/12 text-[var(--color-success)] border border-[var(--color-success)]/25">
                          ACTIVE
                        </span>
                      )}
                      {cp.vcsBranch?.name && (
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-[var(--color-secondary)]/12 text-[var(--color-secondary)] border border-[var(--color-secondary)]/25">
                          {cp.vcsBranch.name}
                        </span>
                      )}
                      {cp.isPinned && (
                        <Pin size={11} className="text-[var(--color-warning)] shrink-0" />
                      )}
                      {(cp.tags || []).slice(0, 2).map((t) => (
                        <span
                          key={t.id}
                          className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-[var(--color-primary)]/12 text-[var(--color-primary)] border border-[var(--color-primary)]/25"
                        >
                          {t.name}
                        </span>
                      ))}
                    </div>
                  )}
                />
              )}

              {/* Selected Checkpoint Inspector */}
              {selectedCheckpoint && (
                <div className="p-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] space-y-3">
                  <div className="flex flex-wrap items-start justify-between gap-3 pb-3 border-b border-[var(--color-border)]">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono text-xs font-semibold text-[var(--color-primary)]">
                          #v{selectedCheckpoint.versionNumber || 1}
                        </span>
                        <span className="font-mono text-[11px] text-[var(--color-text-muted)]">
                          {selectedCheckpoint.shortHash || selectedCheckpoint.id.slice(0, 7)}
                        </span>
                        <h4 className="text-sm font-semibold text-[var(--color-text)]">
                          {selectedCheckpoint.label}
                        </h4>
                        {selectedCheckpoint.isAutoBackup && (
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-[var(--color-warning)]/12 text-[var(--color-warning)] border border-[var(--color-warning)]/25">
                            AUTO BACKUP
                          </span>
                        )}
                      </div>
                      {selectedCheckpoint.commitMessage && (
                        <p className="text-xs text-[var(--color-text-secondary)] mt-1 whitespace-pre-wrap">
                          {selectedCheckpoint.commitMessage}
                        </p>
                      )}
                      <p className="text-[11px] font-mono text-[var(--color-text-muted)] mt-1">
                        Author: {selectedCheckpoint.author?.name || selectedCheckpoint.author?.email || "Owner"} ·{" "}
                        {formatRelativeTime(selectedCheckpoint.createdAt)} ·{" "}
                        {selectedCheckpoint.statsJson?.filesTotal ?? 0} files
                      </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5">
                      <Button
                        size="sm"
                        variant="outline"
                        icon={selectedCheckpoint.isPinned ? PinOff : Pin}
                        disabled={!perms.canLocalWrite}
                        title={!perms.canLocalWrite ? perms.disabledReason("local") : ""}
                        onClick={() =>
                          runAction("toggle pin", () =>
                            snapshotVcsService.updateCheckpoint(
                              projectId,
                              selectedCheckpoint.id,
                              { isPinned: !selectedCheckpoint.isPinned },
                            ),
                          ).then(loadCheckpoints)
                        }
                      >
                        {selectedCheckpoint.isPinned ? "Unpin" : "Pin"}
                      </Button>

                      <Button
                        size="sm"
                        variant="outline"
                        disabled={!perms.canLocalWrite}
                        onClick={() => {
                          setEditingMeta((v) => !v);
                          setEditLabelVal(selectedCheckpoint.label || "");
                          setEditMsgVal(selectedCheckpoint.commitMessage || "");
                        }}
                      >
                        Edit Info
                      </Button>

                      <Button
                        size="sm"
                        variant="outline"
                        icon={GitBranch}
                        disabled={!perms.canLocalWrite}
                        title={
                          !perms.canLocalWrite
                            ? perms.disabledReason("local")
                            : "Create a branch starting from this checkpoint"
                        }
                        onClick={() => {
                          setShowInlineBranchForm((v) => !v);
                          if (!inlineBranchName) {
                            setInlineBranchName(
                              `branch-v${selectedCheckpoint.versionNumber || 1}`,
                            );
                          }
                        }}
                      >
                        Create Branch Here
                      </Button>

                      <Button
                        size="sm"
                        variant="secondary"
                        icon={FolderSearch}
                        onClick={() => {
                          setBrowseSnapshotId(selectedCheckpoint.id);
                          setSubTab("browse");
                        }}
                      >
                        Browse Files
                      </Button>

                      <Button
                        size="sm"
                        variant="secondary"
                        icon={Download}
                        disabled={!perms.canExport}
                        onClick={() =>
                          snapshotVcsService.exportCheckpointZip(
                            projectId,
                            selectedCheckpoint.id,
                          )
                        }
                      >
                        ZIP
                      </Button>

                      {!selectedCheckpoint.isCurrent && (
                        <Button
                          size="sm"
                          variant="primary"
                          icon={RotateCcw}
                          disabled={!perms.canRestoreAndAdmin}
                          title={
                            !perms.canRestoreAndAdmin
                              ? perms.disabledReason("restore")
                              : "Rollback entire workspace to this checkpoint"
                          }
                          onClick={() => {
                            setRollbackAutoBackup(true);
                            setPendingRollback(selectedCheckpoint);
                          }}
                        >
                          Full Rollback
                        </Button>
                      )}

                      <Button
                        size="sm"
                        variant="outline"
                        icon={Trash2}
                        disabled={
                          !perms.canRestoreAndAdmin ||
                          selectedCheckpoint.isCurrent ||
                          selectedCheckpoint.isPinned
                        }
                        title={
                          !perms.canRestoreAndAdmin
                            ? perms.disabledReason("restore")
                            : selectedCheckpoint.isCurrent
                              ? "Cannot delete active checkpoint"
                              : selectedCheckpoint.isPinned
                                ? "Unpin checkpoint before deleting"
                                : "Delete checkpoint"
                        }
                        onClick={() => setPendingDeleteCheckpoint(selectedCheckpoint)}
                      />
                    </div>
                  </div>

                  {editingMeta && (
                    <div className="p-3 rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] space-y-2 text-xs">
                      <input
                        type="text"
                        value={editLabelVal}
                        onChange={(e) => setEditLabelVal(e.target.value)}
                        className="w-full h-8 px-2.5 rounded bg-[var(--color-surface-secondary)] border border-[var(--color-border)] text-[var(--color-text)]"
                      />
                      <textarea
                        value={editMsgVal}
                        onChange={(e) => setEditMsgVal(e.target.value)}
                        rows={2}
                        className="w-full p-2 rounded bg-[var(--color-surface-secondary)] border border-[var(--color-border)] text-[var(--color-text)]"
                      />
                      <div className="flex justify-end gap-2">
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => setEditingMeta(false)}
                        >
                          Cancel
                        </Button>
                        <Button
                          size="sm"
                          variant="primary"
                          onClick={async () => {
                            await runAction(
                              "update checkpoint",
                              () =>
                                snapshotVcsService.updateCheckpoint(
                                  projectId,
                                  selectedCheckpoint.id,
                                  {
                                    label: editLabelVal.trim(),
                                    commitMessage: editMsgVal.trim(),
                                  },
                                ),
                              { successText: "Updated checkpoint metadata" },
                            );
                            setEditingMeta(false);
                            await loadCheckpoints();
                          }}
                        >
                          Save
                        </Button>
                      </div>
                    </div>
                  )}

                  {/* Quick Add Tag */}
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="text-[var(--color-text-muted)]">Add release tag:</span>
                    <input
                      type="text"
                      value={inlineTagName}
                      onChange={(e) => setInlineTagName(e.target.value)}
                      placeholder="v1.0.0"
                      disabled={!perms.canLocalWrite}
                      className="w-36 h-7 px-2 rounded bg-[var(--color-surface-secondary)] border border-[var(--color-border)] font-mono text-xs text-[var(--color-text)]"
                    />
                    <Button
                      size="sm"
                      variant="secondary"
                      icon={Tag}
                      disabled={!perms.canLocalWrite || !inlineTagName.trim()}
                      onClick={async () => {
                        const name = inlineTagName.trim();
                        await runAction(
                          `tag ${name}`,
                          () =>
                            snapshotVcsService.createTag(
                              projectId,
                              selectedCheckpoint.id,
                              { name },
                            ),
                          { successText: `Tagged #v${selectedCheckpoint.versionNumber} as '${name}'` },
                        );
                        setInlineTagName("");
                        await Promise.all([loadCheckpoints(), loadTags()]);
                      }}
                    >
                      Attach Tag
                    </Button>
                  </div>

                  {showInlineBranchForm && (
                    <div className="p-2.5 rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] flex flex-wrap items-center gap-2 text-xs">
                      <GitBranch size={13} className="text-[var(--color-primary)] shrink-0" />
                      <input
                        type="text"
                        value={inlineBranchName}
                        onChange={(e) => setInlineBranchName(e.target.value)}
                        placeholder="feat/from-checkpoint"
                        className="flex-1 min-w-[160px] h-7 px-2 rounded bg-[var(--color-surface-secondary)] border border-[var(--color-border)] font-mono text-xs text-[var(--color-text)]"
                      />
                      <Button
                        size="sm"
                        variant="primary"
                        disabled={!inlineBranchName.trim() || Boolean(busyAction)}
                        onClick={async () => {
                          const name = inlineBranchName.trim();
                          const res = await runAction(
                            `create branch ${name}`,
                            () =>
                              snapshotVcsService.createBranch(projectId, {
                                name,
                                fromSnapshotId: selectedCheckpoint.id,
                                checkout: Boolean(perms.canRestoreAndAdmin),
                              }),
                            {
                              syncWorkspace: Boolean(perms.canRestoreAndAdmin),
                              reason: "snapshot_branch_create",
                              successText: `Created branch '${name}' from #v${selectedCheckpoint.versionNumber || 1}`,
                            },
                          );
                          if (res) {
                            setShowInlineBranchForm(false);
                            setInlineBranchName("");
                            await Promise.all([loadBranches(), loadCheckpoints()]);
                          }
                        }}
                      >
                        {perms.canRestoreAndAdmin ? "Create & Switch" : "Create Branch"}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setShowInlineBranchForm(false)}
                      >
                        Cancel
                      </Button>
                    </div>
                  )}

                  {selectedCheckpoint.parentSnapshotId && (
                    <div className="pt-2 border-t border-[var(--color-border)] space-y-1.5">
                      <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
                        <span>
                          Changed Files vs Parent (
                          {inspectorDiffState.checkpointId === selectedCheckpoint.id
                            ? inspectorDiffState.changes.length
                            : 0}
                          )
                        </span>
                      </div>
                      {inspectorDiffState.error ? (
                        <p className="text-[11px] text-[var(--color-danger)]">
                          {inspectorDiffState.error}
                        </p>
                      ) : (inspectorDiffState.checkpointId === selectedCheckpoint.id
                          ? inspectorDiffState.changes
                          : []
                        ).length === 0 ? (
                        <p className="text-[11px] text-[var(--color-text-muted)]">
                          No file-level delta recorded against parent checkpoint.
                        </p>
                      ) : (
                        <div className="max-h-40 overflow-y-auto custom-scrollbar space-y-1">
                          {(inspectorDiffState.checkpointId === selectedCheckpoint.id
                            ? inspectorDiffState.changes
                            : []
                          )
                            .slice(0, 60)
                            .map((ch) => {
                              const meta = getVcsStatusMeta(ch.status);
                              return (
                                <button
                                  key={`${ch.status}:${ch.path}`}
                                  type="button"
                                  onClick={() =>
                                    loadDiffPair(ch, "compare", {
                                      baseSnapshotId: selectedCheckpoint.parentSnapshotId,
                                      targetSnapshotId: selectedCheckpoint.id,
                                    })
                                  }
                                  className="w-full flex items-center justify-between gap-2 px-2 py-1 rounded text-left text-xs hover:bg-[var(--color-surface-secondary)] cursor-pointer transition-colors duration-150"
                                >
                                  <span className="font-mono text-[11.5px] text-[var(--color-text)] truncate">
                                    {ch.origPath ? `${ch.origPath} → ${ch.path}` : ch.path}
                                  </span>
                                  <span
                                    className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-bold shrink-0 ${meta.badgeClass}`}
                                  >
                                    {meta.char}
                                  </span>
                                </button>
                              );
                            })}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* SUB-TAB 3: COMPARE */}
          {subTab === "compare" && (
            <div className="flex-1 min-h-0 flex flex-col overflow-y-auto xl:overflow-hidden">
              <SnapshotComparePanel
                projectId={projectId}
                checkpoints={checkpoints}
                activeSnapshotId={status?.activeSnapshotId}
                onOpenInEditor={onOpenFile}
              />
            </div>
          )}

          {/* SUB-TAB 4: BROWSE HISTORICAL FILES & SINGLE-FILE RESTORE */}
          {subTab === "browse" && (
            <div className="flex-1 min-h-0 flex flex-col overflow-y-auto xl:overflow-hidden">
              <SnapshotBrowsePanel
                projectId={projectId}
                checkpoints={checkpoints}
                initialSnapshotId={browseSnapshotId || selectedCheckpoint?.id}
                canLocalWrite={perms.canLocalWrite}
                canExport={perms.canExport}
                disabledReason={perms.disabledReason("local")}
                onFileRestored={async () => {
                  vcsSummary.invalidateAll();
                  await onSync?.({ reason: "snapshot_restore_file" });
                }}
              />
            </div>
          )}

          {/* SUB-TAB 5: LOCAL BRANCHES & 3-WAY MERGE */}
          {subTab === "branches" && (
            <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar pr-0.5 space-y-3.5">
              {mergeConflictState && (
                <VcsConflictResolver
                  mode="snapshot"
                  operationLabel={`3-Way Snapshot Merge: ${mergeConflictState.sourceBranch?.name} → ${mergeConflictState.targetBranch?.name}`}
                  conflicts={mergeConflictState.conflicts}
                  canResolve={perms.canRestoreAndAdmin}
                  disabledReason={perms.disabledReason("restore")}
                  resolving={resolvingMerge}
                  onResolveAllSnapshot={handleResolveSnapshotMerge}
                  onAbort={() => setMergeConflictState(null)}
                />
              )}

              {/* Create Branch Form */}
              <div className="p-3.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] space-y-2.5 text-xs">
                <div className="font-semibold text-[var(--color-text)]">
                  Create Local Snapshot Branch
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="text"
                    value={newBranchName}
                    onChange={(e) => setNewBranchName(e.target.value)}
                    placeholder="experiment/refactor"
                    disabled={!perms.canLocalWrite}
                    className="flex-1 min-w-[160px] h-8 px-2.5 rounded-md bg-[var(--color-surface-secondary)] border border-[var(--color-border)] font-mono text-xs text-[var(--color-text)]"
                  />
                  <select
                    value={newBranchFromId}
                    onChange={(e) => setNewBranchFromId(e.target.value)}
                    className="h-8 px-2 rounded-md bg-[var(--color-surface-secondary)] border border-[var(--color-border)] font-mono text-xs text-[var(--color-text)] max-w-[200px]"
                  >
                    <option value="">Fork from current HEAD</option>
                    {checkpoints.map((cp) => (
                      <option key={cp.id} value={cp.id}>
                        #v{cp.versionNumber || 1} · {cp.label}
                      </option>
                    ))}
                  </select>
                  <input
                    type="text"
                    value={newBranchDesc}
                    onChange={(e) => setNewBranchDesc(e.target.value)}
                    placeholder="Description (optional)"
                    disabled={!perms.canLocalWrite}
                    className="w-44 h-8 px-2.5 rounded-md bg-[var(--color-surface-secondary)] border border-[var(--color-border)] text-xs text-[var(--color-text)]"
                  />
                  <label
                    className="inline-flex items-center gap-1.5 text-xs text-[var(--color-text-secondary)]"
                    title={!perms.canRestoreAndAdmin ? perms.disabledReason("restore") : ""}
                  >
                    <input
                      type="checkbox"
                      checked={newBranchCheckout}
                      disabled={!perms.canRestoreAndAdmin}
                      onChange={(e) => setNewBranchCheckout(e.target.checked)}
                    />
                    <span>Switch immediately</span>
                  </label>
                  <Button
                    size="sm"
                    variant="primary"
                    icon={Plus}
                    disabled={
                      !perms.canLocalWrite || !newBranchName.trim() || Boolean(busyAction)
                    }
                    title={!perms.canLocalWrite ? perms.disabledReason("local") : ""}
                    onClick={async () => {
                      const name = newBranchName.trim();
                      const res = await runAction(
                        `create branch ${name}`,
                        () =>
                          snapshotVcsService.createBranch(projectId, {
                            name,
                            fromSnapshotId: newBranchFromId || undefined,
                            description: newBranchDesc.trim() || undefined,
                            checkout: newBranchCheckout && perms.canRestoreAndAdmin,
                          }),
                        {
                          syncWorkspace: newBranchCheckout && perms.canRestoreAndAdmin,
                          reason: "snapshot_branch_create",
                          successText: `Created branch '${name}'`,
                        },
                      );
                      if (res) {
                        setNewBranchName("");
                        setNewBranchDesc("");
                        setNewBranchCheckout(false);
                        await loadBranches();
                      }
                    }}
                  >
                    Create Branch
                  </Button>
                </div>
              </div>

              {/* Branch Cards */}
              <div className="border border-[var(--color-border)] rounded-lg bg-[var(--color-surface)] divide-y divide-[var(--color-border)]">
                {(branchesState.branches || []).map((branch) => (
                  <div
                    key={branch.id}
                    className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-xs"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <GitBranch
                          size={13}
                          className={
                            branch.isActive
                              ? "text-[var(--color-success)]"
                              : "text-[var(--color-text-muted)]"
                          }
                        />
                        <span className="font-mono font-semibold text-[var(--color-text)]">
                          {branch.name}
                        </span>
                        {branch.isDefault && (
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-[var(--color-surface-secondary)] border border-[var(--color-border)] text-[var(--color-text-muted)]">
                            DEFAULT
                          </span>
                        )}
                        {branch.isActive && (
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-[var(--color-success)]/12 text-[var(--color-success)] border border-[var(--color-success)]/25">
                            ACTIVE
                          </span>
                        )}
                        {branch.headCheckpoint && (
                          <span className="font-mono text-[10.5px] text-[var(--color-primary)]">
                            HEAD: #v{branch.headCheckpoint.versionNumber}
                          </span>
                        )}
                      </div>
                      {branch.description && (
                        <p className="text-[11px] text-[var(--color-text-muted)] mt-0.5 pl-5">
                          {branch.description}
                        </p>
                      )}
                    </div>

                    {renameBranchId === branch.id ? (
                      <div className="flex items-center gap-1.5">
                        <input
                          type="text"
                          value={renameBranchVal}
                          onChange={(e) => setRenameBranchVal(e.target.value)}
                          className="h-7 px-2 rounded bg-[var(--color-surface-secondary)] border border-[var(--color-border)] font-mono text-xs text-[var(--color-text)]"
                        />
                        <Button
                          size="sm"
                          variant="primary"
                          onClick={async () => {
                            await runAction(
                              `rename branch`,
                              () =>
                                snapshotVcsService.updateBranch(
                                  projectId,
                                  branch.id,
                                  { name: renameBranchVal.trim() },
                                ),
                              { successText: `Renamed branch to '${renameBranchVal.trim()}'` },
                            );
                            setRenameBranchId(null);
                            await loadBranches();
                          }}
                        >
                          Save
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => setRenameBranchId(null)}
                        >
                          Cancel
                        </Button>
                      </div>
                    ) : (
                      <div className="flex flex-wrap items-center gap-1.5">
                        {!branch.isActive && (
                          <>
                            <Button
                              size="sm"
                              variant="secondary"
                              disabled={!perms.canRestoreAndAdmin || Boolean(busyAction)}
                              title={
                                !perms.canRestoreAndAdmin
                                  ? perms.disabledReason("restore")
                                  : "Switch workspace to this branch"
                              }
                              onClick={() => handleAttemptCheckoutBranch(branch)}
                            >
                              Checkout
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              icon={GitMerge}
                              disabled={!perms.canRestoreAndAdmin || Boolean(busyAction)}
                              title={
                                !perms.canRestoreAndAdmin
                                  ? perms.disabledReason("restore")
                                  : `Merge ${branch.name} into ${activeBranch?.name || "current"}`
                              }
                              onClick={() => handleMergeBranch(branch)}
                            >
                              Merge Into {activeBranch?.name || "Active"}
                            </Button>
                          </>
                        )}
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={!perms.canRestoreAndAdmin}
                          title={
                            !perms.canRestoreAndAdmin
                              ? perms.disabledReason("restore")
                              : "Rename branch"
                          }
                          onClick={() => {
                            setRenameBranchId(branch.id);
                            setRenameBranchVal(branch.name);
                          }}
                        >
                          Rename
                        </Button>
                        {!branch.isActive && !branch.isDefault && (
                          <Button
                            size="sm"
                            variant="outline"
                            icon={Trash2}
                            disabled={!perms.canRestoreAndAdmin}
                            title={
                              !perms.canRestoreAndAdmin
                                ? perms.disabledReason("restore")
                                : "Delete branch"
                            }
                            onClick={() => setPendingDeleteBranch(branch)}
                          />
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* SUB-TAB 6: RELEASE TAGS */}
          {subTab === "tags" && (
            <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar pr-0.5 space-y-3">
              <div className="p-3.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] flex flex-wrap items-center gap-2 text-xs">
                <input
                  type="text"
                  value={tagModalName}
                  onChange={(e) => setTagModalName(e.target.value)}
                  placeholder="v1.0.0-stable"
                  disabled={!perms.canLocalWrite}
                  className="w-40 h-8 px-2.5 rounded-md bg-[var(--color-surface-secondary)] border border-[var(--color-border)] font-mono text-xs text-[var(--color-text)]"
                />
                <select
                  value={tagModalSnapshotId || status?.activeSnapshotId || ""}
                  onChange={(e) => setTagModalSnapshotId(e.target.value)}
                  className="h-8 px-2 rounded-md bg-[var(--color-surface-secondary)] border border-[var(--color-border)] font-mono text-xs text-[var(--color-text)] max-w-[220px]"
                >
                  {checkpoints.map((cp) => (
                    <option key={cp.id} value={cp.id}>
                      #v{cp.versionNumber || 1} · {cp.label}
                    </option>
                  ))}
                </select>
                <input
                  type="text"
                  value={tagModalDesc}
                  onChange={(e) => setTagModalDesc(e.target.value)}
                  placeholder="Release note (optional)"
                  disabled={!perms.canLocalWrite}
                  className="flex-1 min-w-[160px] h-8 px-2.5 rounded-md bg-[var(--color-surface-secondary)] border border-[var(--color-border)] text-xs text-[var(--color-text)]"
                />
                <Button
                  size="sm"
                  variant="primary"
                  icon={Tag}
                  disabled={!perms.canLocalWrite || !tagModalName.trim()}
                  onClick={async () => {
                    const targetId =
                      tagModalSnapshotId || status?.activeSnapshotId;
                    if (!targetId) return;
                    const cleanName = tagModalName.trim();
                    await runAction(
                      `create tag ${cleanName}`,
                      () =>
                        snapshotVcsService.createTag(projectId, targetId, {
                          name: cleanName,
                          description: tagModalDesc.trim() || undefined,
                        }),
                      { successText: `Created tag '${cleanName}'` },
                    );
                    setTagModalName("");
                    setTagModalDesc("");
                    await Promise.all([loadTags(), loadCheckpoints()]);
                  }}
                >
                  Create Tag
                </Button>
              </div>

              {tags.length === 0 ? (
                <div className="p-8 text-center border border-dashed border-[var(--color-border)] rounded-lg bg-[var(--color-surface)] text-xs text-[var(--color-text-muted)]">
                  No checkpoint release tags yet.
                </div>
              ) : (
                <div className="border border-[var(--color-border)] rounded-lg bg-[var(--color-surface)] divide-y divide-[var(--color-border)]">
                  {tags.map((t) => (
                    <div
                      key={t.id}
                      className="flex items-center justify-between gap-2 px-4 py-2.5 text-xs"
                    >
                      <div className="min-w-0 flex items-center gap-2">
                        <Tag size={13} className="text-[var(--color-primary)] shrink-0" />
                        <span className="font-mono font-semibold text-[var(--color-text)]">
                          {t.name}
                        </span>
                        {t.snapshot && (
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-[var(--color-surface-secondary)] border border-[var(--color-border)] text-[var(--color-text-secondary)]">
                            #v{t.snapshot.versionNumber || 1} · {t.snapshot.label}
                          </span>
                        )}
                        {t.description && (
                          <span className="truncate text-[var(--color-text-muted)]">
                            {t.description}
                          </span>
                        )}
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        icon={Trash2}
                        disabled={!perms.canRestoreAndAdmin}
                        title={
                          !perms.canRestoreAndAdmin
                            ? perms.disabledReason("restore")
                            : "Delete tag"
                        }
                        onClick={() => setPendingDeleteTag(t)}
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Discard Confirmation */}
      <ConfirmDialog
        isOpen={Boolean(pendingDiscard)}
        onClose={() => setPendingDiscard(null)}
        onConfirm={async () => {
          const target = pendingDiscard;
          setPendingDiscard(null);
          await runAction(
            "discard changes",
            () =>
              snapshotVcsService.discardChanges(projectId, {
                files: target.all ? "all" : [target.path],
              }),
            {
              syncWorkspace: true,
              reason: "snapshot_discard",
              successText: target.all
                ? "Discarded all uncommitted changes"
                : `Discarded changes in ${target.path}`,
            },
          );
          if (target.all || selectedFile?.path === target.path) {
            setSelectedFile(null);
            setDiffData(null);
          }
        }}
        title={
          pendingDiscard?.all
            ? "Discard All Working Tree Changes?"
            : `Discard Changes in ${pendingDiscard?.path}?`
        }
        message="Uncommitted edits will be reverted back to the active HEAD checkpoint."
        confirmText="Discard Changes"
        variant="danger"
      />

      {/* Full Rollback Confirmation */}
      <ConfirmDialog
        isOpen={Boolean(pendingRollback)}
        onClose={() => setPendingRollback(null)}
        onConfirm={async () => {
          const snap = pendingRollback;
          setPendingRollback(null);
          await runAction(
            `rollback #v${snap.versionNumber || 1}`,
            () =>
              snapshotVcsService.restoreCheckpoint(projectId, snap.id, {
                dirtyPolicy: rollbackAutoBackup ? "AUTO_BACKUP" : "DISCARD_DIRTY",
                autoBackup: rollbackAutoBackup,
              }),
            {
              syncWorkspace: true,
              reason: "snapshot_rollback",
              successText: `Workspace rolled back to #v${snap.versionNumber || 1} (${snap.label})`,
            },
          );
          setSelectedFile(null);
          setDiffData(null);
          await Promise.all([loadCheckpoints(), loadBranches()]);
        }}
        title={`Rollback Workspace to #v${pendingRollback?.versionNumber || 1}?`}
        message={`All files in the live workspace will revert to "${pendingRollback?.label || "Checkpoint"}".`}
        confirmText="Confirm Full Rollback"
        variant="warning"
        loading={busyAction.startsWith("rollback")}
      >
        <label className="inline-flex items-center gap-2 text-xs text-[var(--color-text-secondary)] cursor-pointer">
          <input
            type="checkbox"
            checked={rollbackAutoBackup}
            onChange={(e) => setRollbackAutoBackup(e.target.checked)}
          />
          <span>
            Auto-Backup current changes before rolling back (Recommended)
          </span>
        </label>
      </ConfirmDialog>

      {/* Dirty Workspace Prompt (Branch Checkout & 3-Way Merge) */}
      <ConfirmDialog
        isOpen={Boolean(dirtyCheckoutPrompt)}
        onClose={() => setDirtyCheckoutPrompt(null)}
        onConfirm={() => {
          if (dirtyCheckoutPrompt?.kind === "merge") {
            return handleMergeBranch(dirtyCheckoutPrompt.branch, "AUTO_BACKUP");
          }
          if (dirtyCheckoutPrompt?.kind === "mergeResolve") {
            return handleResolveSnapshotMerge(
              dirtyCheckoutPrompt.resolutionsMap,
              "AUTO_BACKUP",
            );
          }
          return handleAttemptCheckoutBranch(
            dirtyCheckoutPrompt.branch,
            "AUTO_BACKUP",
          );
        }}
        title="Uncommitted Changes Detected"
        message={
          dirtyCheckoutPrompt?.kind === "merge" ||
          dirtyCheckoutPrompt?.kind === "mergeResolve"
            ? `You have ${dirtyCheckoutPrompt?.dirtyCount || 0} uncommitted change(s). Create an automatic safety backup checkpoint before merging '${dirtyCheckoutPrompt?.branch?.name || ""}'?`
            : `You have ${dirtyCheckoutPrompt?.dirtyCount || 0} uncommitted change(s). Create an automatic safety backup checkpoint before switching to '${dirtyCheckoutPrompt?.branch?.name || ""}'?`
        }
        confirmText={
          dirtyCheckoutPrompt?.kind === "merge" ||
          dirtyCheckoutPrompt?.kind === "mergeResolve"
            ? "Auto-Backup & Merge"
            : "Auto-Backup & Switch"
        }
        variant="warning"
      >
        <div className="pt-1">
          <button
            type="button"
            onClick={() => {
              if (dirtyCheckoutPrompt?.kind === "merge") {
                void handleMergeBranch(dirtyCheckoutPrompt.branch, "DISCARD_DIRTY");
              } else if (dirtyCheckoutPrompt?.kind === "mergeResolve") {
                void handleResolveSnapshotMerge(
                  dirtyCheckoutPrompt.resolutionsMap,
                  "DISCARD_DIRTY",
                );
              } else {
                void handleAttemptCheckoutBranch(
                  dirtyCheckoutPrompt.branch,
                  "DISCARD_DIRTY",
                );
              }
            }}
            className="text-xs font-medium text-[var(--color-danger)] hover:underline cursor-pointer"
          >
            {dirtyCheckoutPrompt?.kind === "merge" ||
            dirtyCheckoutPrompt?.kind === "mergeResolve"
              ? "Or discard uncommitted edits and merge anyway"
              : "Or discard uncommitted edits and switch anyway"}
          </button>
        </div>
      </ConfirmDialog>

      {/* Delete Checkpoint / Branch / Tag Confirmations */}
      <ConfirmDialog
        isOpen={Boolean(pendingDeleteCheckpoint)}
        onClose={() => setPendingDeleteCheckpoint(null)}
        onConfirm={async () => {
          const cp = pendingDeleteCheckpoint;
          setPendingDeleteCheckpoint(null);
          await runAction(
            "delete checkpoint",
            () => snapshotVcsService.deleteCheckpoint(projectId, cp.id),
            { successText: `Deleted checkpoint #v${cp.versionNumber || ""}` },
          );
          await loadCheckpoints();
        }}
        title={`Delete Checkpoint "${pendingDeleteCheckpoint?.label || ""}"?`}
        message="Unreferenced blobs will be scheduled for garbage collection cleanly."
        confirmText="Delete Checkpoint"
        variant="danger"
      />

      <ConfirmDialog
        isOpen={Boolean(pendingDeleteBranch)}
        onClose={() => setPendingDeleteBranch(null)}
        onConfirm={async () => {
          const b = pendingDeleteBranch;
          setPendingDeleteBranch(null);
          await runAction(
            `delete branch ${b.name}`,
            () => snapshotVcsService.deleteBranch(projectId, b.id),
            { successText: `Deleted branch '${b.name}'` },
          );
          await loadBranches();
        }}
        title={`Delete Branch "${pendingDeleteBranch?.name || ""}"?`}
        message="Branch pointer will be removed; existing checkpoints remain intact."
        confirmText="Delete Branch"
        variant="danger"
      />

      <ConfirmDialog
        isOpen={Boolean(pendingDeleteTag)}
        onClose={() => setPendingDeleteTag(null)}
        onConfirm={async () => {
          const t = pendingDeleteTag;
          setPendingDeleteTag(null);
          await runAction(
            `delete tag ${t.name}`,
            () => snapshotVcsService.deleteTag(projectId, t.id),
            { successText: `Removed tag '${t.name}'` },
          );
          await Promise.all([loadTags(), loadCheckpoints()]);
        }}
        title={`Delete Tag "${pendingDeleteTag?.name || ""}"?`}
        message="This removes the release tag label without affecting checkpoint data."
        confirmText="Delete Tag"
        variant="danger"
      />
    </div>
  );
}
