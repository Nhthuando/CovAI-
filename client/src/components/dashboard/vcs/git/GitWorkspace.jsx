import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  AlertTriangle,
  Archive,
  ArrowDown,
  ArrowUp,
  Check,
  CheckCircle2,
  ChevronDown,
  ExternalLink,
  FolderGit2,
  GitBranch,
  GitCommit,
  GitMerge,
  History,
  Link2,
  Loader2,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldAlert,
  Sparkles,
  Tag,
  Terminal,
  Trash2,
  UploadCloud,
} from "lucide-react";
import Button from "../../../common/Button";
import ConfirmDialog from "../../../common/ConfirmDialog";
import { SnapshotsListSkeleton } from "../../../common/Skeleton";
import VcsChangesTree from "../shared/VcsChangesTree";
import VcsMonacoDiffEditor from "../shared/VcsMonacoDiffEditor";
import VcsCommitGraph from "../shared/VcsCommitGraph";
import VcsConflictResolver from "../shared/VcsConflictResolver";
import GitOutputConsole from "./GitOutputConsole";
import GitPublishModal from "./GitPublishModal";
import GitPullRequestsPanel from "./GitPullRequestsPanel";
import { gitService } from "../../../../services/git.service";
import {
  fetchGithubAuthorizeUrlApi,
  getGithubCapabilitiesApi,
} from "../../../../services/auth.service";
import { useProjectAccess } from "../../../../hooks/useProjectAccess";
import { useVcsSync } from "../../../../hooks/useVcsSync";
import {
  applyOptimisticStage,
  applyOptimisticUnstage,
  buildVcsPermissions,
  extractVcsStatusFromResponse,
  formatAiCommitSubject,
  formatRelativeTime,
} from "../../../../services/vcsUiHelpers";
import { VC_MODES } from "../../../../../../shared/versionControlMode.js";

const CONVENTIONAL_PREFIXES = ["feat:", "fix:", "test:", "refactor:", "chore:"];

export default function GitWorkspace({
  projectId,
  project = null,
  onSync,
  onOpenFile,
}) {
  const access = useProjectAccess(projectId);
  const perms = useMemo(
    () => buildVcsPermissions(access, VC_MODES.GIT_GITHUB),
    [access],
  );
  const vcsSummary = useVcsSync(projectId);
  const status = vcsSummary.rawStatus;

  const [subTab, setSubTab] = useState("diff");
  const [notice, setNotice] = useState(null);
  const [busyAction, setBusyAction] = useState("");
  const [pendingStageKeys, setPendingStageKeys] = useState(() => new Set());
  const [logs, setLogs] = useState([]);
  const [showConsole, setShowConsole] = useState(false);
  const [runningConsole, setRunningConsole] = useState(false);

  // Capabilities
  const [capabilities, setCapabilities] = useState(null);
  const [reauthorizing, setReauthorizing] = useState(false);

  // Commit box
  const [commitMessage, setCommitMessage] = useState("");
  const [commitDescription, setCommitDescription] = useState("");
  const [showDescription, setShowDescription] = useState(false);
  const [showSplitMenu, setShowSplitMenu] = useState(false);
  const [aiDrafting, setAiDrafting] = useState(false);
  const [confirmUndoPushed, setConfirmUndoPushed] = useState(false);
  const [confirmForcePush, setConfirmForcePush] = useState(false);
  const splitMenuRef = useRef(null);

  // Selected diff
  const [selectedFile, setSelectedFile] = useState(null);
  const [diffData, setDiffData] = useState(null);
  const [loadingDiff, setLoadingDiff] = useState(false);
  const [diffError, setDiffError] = useState("");
  const diffRequestSeqRef = useRef(0);
  const diffAbortRef = useRef(null);

  // Conflicts
  const [conflictsDetail, setConflictsDetail] = useState([]);
  const [resolvingConflict, setResolvingConflict] = useState(false);

  // Discard & destructive confirms
  const [pendingDiscard, setPendingDiscard] = useState(null);
  const [pendingReset, setPendingReset] = useState(null);

  // Modals (Publish / Remote)
  const [showPublishModal, setShowPublishModal] = useState(false);
  const [showRemoteModal, setShowRemoteModal] = useState(false);
  const [remoteUrlInput, setRemoteUrlInput] = useState("");

  // History & Commit detail
  const [commits, setCommits] = useState([]);
  const [hasMoreCommits, setHasMoreCommits] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [logSearch, setLogSearch] = useState("");
  const [logBranch, setLogBranch] = useState("");
  const [selectedCommit, setSelectedCommit] = useState(null);
  const [commitDetail, setCommitDetail] = useState(null);
  const [loadingCommitDetail, setLoadingCommitDetail] = useState(false);

  // Branches
  const [branchesData, setBranchesData] = useState({
    current: "main",
    defaultBranch: "main",
    local: [],
    remote: [],
    localBranches: [],
    remoteBranches: [],
  });
  const [showBranchMenu, setShowBranchMenu] = useState(false);
  const [newBranchName, setNewBranchName] = useState("");
  const [newBranchFrom, setNewBranchFrom] = useState("");
  const [stashBeforeCheckout, setStashBeforeCheckout] = useState(true);
  const [renameTarget, setRenameTarget] = useState(null);
  const [renameValue, setRenameValue] = useState("");
  const [mergeMode, setMergeMode] = useState("merge");
  const [pendingDeleteBranch, setPendingDeleteBranch] = useState(null);
  const [deleteRemoteBranch, setDeleteRemoteBranch] = useState(false);
  const branchDropdownRef = useRef(null);

  // Stashes & Tags
  const [stashes, setStashes] = useState([]);
  const [stashMessage, setStashMessage] = useState("");
  const [stashIncludeUntracked, setStashIncludeUntracked] = useState(true);
  const [stashDiffPreview, setStashDiffPreview] = useState(null);
  const [pendingDropStash, setPendingDropStash] = useState(null);

  const [tags, setTags] = useState([]);
  const [tagNameInput, setTagNameInput] = useState("");
  const [tagMessageInput, setTagMessageInput] = useState("");
  const [tagPushAfter, setTagPushAfter] = useState(false);
  const [pendingDeleteTag, setPendingDeleteTag] = useState(null);
  const [deleteRemoteTag, setDeleteRemoteTag] = useState(false);

  const noticeTimerRef = useRef(null);

  const appendLog = useCallback((line, { isError = false } = {}) => {
    const stamp = new Date().toLocaleTimeString();
    setLogs((prev) =>
      [
        {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          timestamp: stamp,
          text: String(line ?? ""),
          isError,
        },
        ...prev,
      ].slice(0, 80),
    );
  }, []);

  const showNotice = useCallback((type, text, code = null) => {
    if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
    setNotice({ type, text, code });
    if (!["GIT_PUSH_REJECTED", "GIT_AUTH_FAILED"].includes(code)) {
      noticeTimerRef.current = setTimeout(() => {
        setNotice(null);
      }, 5000);
    }
  }, []);

  useEffect(() => {
    return () => {
      if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
      diffAbortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    const onOutside = (e) => {
      if (splitMenuRef.current && !splitMenuRef.current.contains(e.target)) {
        setShowSplitMenu(false);
      }
      if (
        branchDropdownRef.current &&
        !branchDropdownRef.current.contains(e.target)
      ) {
        setShowBranchMenu(false);
      }
    };
    window.addEventListener("mousedown", onOutside);
    return () => window.removeEventListener("mousedown", onOutside);
  }, []);

  // Load GitHub OAuth capabilities once per mount/project
  useEffect(() => {
    let active = true;
    getGithubCapabilitiesApi()
      .then((caps) => {
        if (active) setCapabilities(caps);
      })
      .catch((err) => {
        console.warn("[GitWorkspace] Capabilities check failed:", err?.message);
      });
    return () => {
      active = false;
    };
  }, [projectId]);

  const loadBranches = useCallback(async () => {
    if (!projectId) return;
    try {
      const res = await gitService.getBranches(projectId);
      if (res?.data) setBranchesData(res.data);
    } catch (err) {
      appendLog(`branch list skipped: ${err.message}`);
    }
  }, [projectId, appendLog]);

  const loadHistory = useCallback(
    async ({ reset = true } = {}) => {
      if (!projectId) return;
      setLoadingHistory(true);
      try {
        const skip = reset ? 0 : commits.length;
        const res = await gitService.getLog(projectId, {
          branch: logBranch || undefined,
          search: logSearch.trim() || undefined,
          skip,
          limit: 30,
        });
        const nextRows = res?.data || [];
        setCommits((prev) => (reset ? nextRows : [...prev, ...nextRows]));
        setHasMoreCommits(Boolean(res?.hasMore));
      } catch (err) {
        showNotice("error", err?.message || "Failed to load commit log");
      } finally {
        setLoadingHistory(false);
      }
    },
    [projectId, logBranch, logSearch, commits.length, showNotice],
  );

  const loadStashes = useCallback(async () => {
    if (!projectId) return;
    try {
      const res = await gitService.listStashes(projectId);
      setStashes(res?.data || []);
    } catch (err) {
      appendLog(`stash list warning: ${err.message}`);
    }
  }, [projectId, appendLog]);

  const loadTags = useCallback(async () => {
    if (!projectId) return;
    try {
      const res = await gitService.listTags(projectId);
      setTags(res?.data || []);
    } catch (err) {
      appendLog(`tag list warning: ${err.message}`);
    }
  }, [projectId, appendLog]);

  const loadConflicts = useCallback(async () => {
    if (!projectId) return;
    try {
      const res = await gitService.getConflicts(projectId);
      setConflictsDetail(res?.data?.conflicts || []);
    } catch (err) {
      appendLog(`conflict inspection warning: ${err.message}`);
    }
  }, [projectId, appendLog]);

  useEffect(() => {
    if (!status?.hasGit || !projectId) return undefined;
    let active = true;
    gitService
      .getBranches(projectId)
      .then((res) => {
        if (active && res?.data) setBranchesData(res.data);
      })
      .catch((err) => {
        if (active) appendLog(`branch list skipped: ${err.message}`);
      });

    if (status.conflicts?.length > 0 || status.operationState !== "IDLE") {
      gitService
        .getConflicts(projectId)
        .then((res) => {
          if (active) setConflictsDetail(res?.data?.conflicts || []);
        })
        .catch((err) => {
          if (active) appendLog(`conflict inspection warning: ${err.message}`);
        });
    }
    return () => {
      active = false;
    };
  }, [
    projectId,
    status?.hasGit,
    status?.branch,
    status?.conflicts?.length,
    status?.operationState,
    appendLog,
  ]);

  useEffect(() => {
    if (!status?.hasGit || !projectId) return undefined;
    let active = true;
    if (subTab === "history") {
      gitService
        .getLog(projectId, {
          branch: logBranch || undefined,
          search: logSearch.trim() || undefined,
          skip: 0,
          limit: 30,
        })
        .then((res) => {
          if (!active) return;
          setCommits(res?.data || []);
          setHasMoreCommits(Boolean(res?.hasMore));
        })
        .catch((err) => {
          if (active) showNotice("error", err?.message || "Failed to load commit log");
        });
    } else if (subTab === "stashes") {
      gitService
        .listStashes(projectId)
        .then((res) => {
          if (active) setStashes(res?.data || []);
        })
        .catch((err) => {
          if (active) appendLog(`stash list warning: ${err.message}`);
        });
    } else if (subTab === "tags") {
      gitService
        .listTags(projectId)
        .then((res) => {
          if (active) setTags(res?.data || []);
        })
        .catch((err) => {
          if (active) appendLog(`tag list warning: ${err.message}`);
        });
    }
    return () => {
      active = false;
    };
  }, [projectId, status?.hasGit, subTab, logBranch, logSearch, appendLog, showNotice]);

  const loadDiffPair = useCallback(
    async (item, section) => {
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
        const res = await gitService.getDiffPair(projectId, {
          filePath: item.path,
          origPath: item.origPath,
          mode: section === "staged" ? "staged" : "working",
          signal: controller.signal,
        });
        if (reqId !== diffRequestSeqRef.current) return;
        setDiffData(res?.data || null);
      } catch (err) {
        if (err?.name === "AbortError" || reqId !== diffRequestSeqRef.current) return;
        setDiffError(err?.message || "Failed to load diff");
        setDiffData(null);
      } finally {
        if (reqId === diffRequestSeqRef.current) {
          setLoadingDiff(false);
        }
      }
    },
    [projectId],
  );

  const handleInspectCommit = async (commit) => {
    setSelectedCommit(commit);
    setLoadingCommitDetail(true);
    try {
      const res = await gitService.getCommitDetail(projectId, commit.hash);
      setCommitDetail(res?.data || null);
    } catch (err) {
      showNotice("error", err?.message || "Failed to load commit detail");
    } finally {
      setLoadingCommitDetail(false);
    }
  };

  const handleLoadCommitFileDiff = async (commitHash, file) => {
    diffAbortRef.current?.abort();
    const controller = new AbortController();
    diffAbortRef.current = controller;
    const reqId = ++diffRequestSeqRef.current;

    setSelectedFile({ path: file.path, origPath: file.origPath, section: "commit" });
    setSubTab("diff");
    setLoadingDiff(true);
    setDiffError("");
    try {
      const res = await gitService.getDiffPair(projectId, {
        filePath: file.path,
        origPath: file.origPath,
        mode: "commit",
        commitHash,
        signal: controller.signal,
      });
      if (reqId !== diffRequestSeqRef.current) return;
      setDiffData(res?.data || null);
    } catch (err) {
      if (err?.name === "AbortError" || reqId !== diffRequestSeqRef.current) return;
      setDiffError(err?.message || "Failed to load commit diff");
      setDiffData(null);
    } finally {
      if (reqId === diffRequestSeqRef.current) {
        setLoadingDiff(false);
      }
    }
  };

  const handleGrantRepoScope = async () => {
    if (reauthorizing) return;
    setReauthorizing(true);
    try {
      const url = await fetchGithubAuthorizeUrlApi("connect");
      sessionStorage.setItem("covai.githubOAuthMode", "connect");
      sessionStorage.setItem(
        "covai.githubConnectReturn",
        `${window.location.pathname}${window.location.search}`,
      );
      window.location.assign(url);
    } catch (err) {
      setReauthorizing(false);
      showNotice("error", err?.message || "GitHub OAuth redirect failed");
    }
  };

  const runAction = async (
    label,
    fn,
    { syncWorkspace = false, reason = "git_op", successText = "" } = {},
  ) => {
    setBusyAction(label);
    const endLocalMutation = vcsSummary.beginLocalMutation?.() || (() => {});
    try {
      const result = await fn();
      appendLog(`${label} -> OK`);
      const nextStatus = extractVcsStatusFromResponse(VC_MODES.GIT_GITHUB, result);
      if (nextStatus) {
        vcsSummary.applyStatusData(nextStatus);
      } else {
        vcsSummary.invalidateAll();
      }
      if (result?.data?.localBranches) {
        setBranchesData(result.data);
      }
      if (syncWorkspace) {
        await onSync?.({ reason, skipVcsRefetch: Boolean(nextStatus) });
      }
      if (successText) showNotice("success", successText);
      return result;
    } catch (err) {
      appendLog(`${label} -> ERROR: ${err?.message || err}`, { isError: true });
      showNotice("error", err?.message || `Failed to execute ${label}`, err?.code || null);
      throw err;
    } finally {
      endLocalMutation();
      setBusyAction("");
    }
  };

  const handleInitRepo = () =>
    runAction(
      "git init",
      () =>
        gitService.initRepo(projectId, {
          defaultBranch: project?.defaultBranch || "main",
          createInitialCommit: true,
          createGitignore: true,
        }),
      {
        syncWorkspace: true,
        reason: "git_init",
        successText: "Git repository initialized with main branch & .gitignore",
      },
    );

  const handlePublishGithub = async (payload) => {
    await runAction(
      `publish ${payload.name}`,
      () => gitService.publishToGitHub(projectId, payload),
      {
        syncWorkspace: true,
        reason: "git_publish",
        successText: `Published repository "${payload.name}" to GitHub!`,
      },
    );
    setShowPublishModal(false);
    await loadBranches();
  };

  const buildStageActionKeys = (prefix, files, folder) => {
    if (folder) return [`${prefix}Folder:${folder}`];
    if (files === "all" || !files) return [`${prefix}:all`];
    return (Array.isArray(files) ? files : [files]).map((f) => `${prefix}:${f}`);
  };

  const handleStage = async (files, folder) => {
    const keys = buildStageActionKeys("stage", files, folder);
    setPendingStageKeys((prev) => new Set([...prev, ...keys]));
    const rollback = await vcsSummary.updateStatusOptimistic((prev) =>
      applyOptimisticStage(VC_MODES.GIT_GITHUB, prev, { files, folder }),
    );
    try {
      const result = await gitService.stageFiles(projectId, files, folder);
      const nextStatus = extractVcsStatusFromResponse(VC_MODES.GIT_GITHUB, result);
      if (nextStatus) {
        vcsSummary.applyStatusData(nextStatus);
      } else {
        vcsSummary.invalidateAll();
      }
      appendLog(folder ? `git add ${folder} -> OK` : "git add -> OK");
      if (selectedFile && (!files || files === "all" || files.includes(selectedFile.path))) {
        void loadDiffPair(selectedFile, "staged");
      }
    } catch (err) {
      rollback();
      const msg = err?.message || "Failed to stage files";
      appendLog(`git add -> ERROR: ${msg}`, { isError: true });
      showNotice("error", msg, err?.code || null);
    } finally {
      setPendingStageKeys((prev) => {
        const next = new Set(prev);
        keys.forEach((k) => next.delete(k));
        return next;
      });
    }
  };

  const handleUnstage = async (files, folder) => {
    const keys = buildStageActionKeys("unstage", files, folder);
    setPendingStageKeys((prev) => new Set([...prev, ...keys]));
    const rollback = await vcsSummary.updateStatusOptimistic((prev) =>
      applyOptimisticUnstage(VC_MODES.GIT_GITHUB, prev, { files, folder }),
    );
    try {
      const result = await gitService.unstageFiles(projectId, files, folder);
      const nextStatus = extractVcsStatusFromResponse(VC_MODES.GIT_GITHUB, result);
      if (nextStatus) {
        vcsSummary.applyStatusData(nextStatus);
      } else {
        vcsSummary.invalidateAll();
      }
      appendLog(folder ? `git restore --staged ${folder} -> OK` : "git unstage -> OK");
      if (selectedFile && (!files || files === "all" || files.includes(selectedFile.path))) {
        void loadDiffPair(selectedFile, "unstaged");
      }
    } catch (err) {
      rollback();
      const msg = err?.message || "Failed to unstage files";
      appendLog(`git unstage -> ERROR: ${msg}`, { isError: true });
      showNotice("error", msg, err?.code || null);
    } finally {
      setPendingStageKeys((prev) => {
        const next = new Set(prev);
        keys.forEach((k) => next.delete(k));
        return next;
      });
    }
  };

  const executeDiscard = async () => {
    if (!pendingDiscard) return;
    const target = pendingDiscard;
    setPendingDiscard(null);
    if (target.all) {
      await runAction(
        "git discard all",
        () => gitService.discardChanges(projectId, "all", true),
        {
          syncWorkspace: true,
          reason: "git_discard",
          successText: "Discarded all working tree modifications",
        },
      );
      setSelectedFile(null);
      setDiffData(null);
    } else {
      await runAction(
        `git discard ${target.path}`,
        () =>
          gitService.discardChanges(
            projectId,
            target.path,
            Boolean(target.isUntracked || target.status === "U"),
          ),
        {
          syncWorkspace: true,
          reason: "git_discard",
          successText: `Discarded changes in ${target.path}`,
        },
      );
      if (selectedFile?.path === target.path) {
        setSelectedFile(null);
        setDiffData(null);
      }
    }
  };

  const handleCommit = async ({
    pushAfter = false,
    syncAfter = false,
    amend = false,
  } = {}) => {
    if (!commitMessage.trim() || busyAction) return;
    setShowSplitMenu(false);
    const totalCount =
      (status?.staged?.length || 0) +
      (status?.unstaged?.length || 0) +
      (status?.untracked?.length || 0);
    if (totalCount === 0 && !amend) {
      showNotice("error", "No changes detected to commit.");
      return;
    }

    const res = await runAction(
      pushAfter
        ? "git commit & push"
        : syncAfter
          ? "git commit & sync"
          : amend
            ? "git commit --amend"
            : "git commit",
      () =>
        gitService.commit(projectId, {
          message: commitMessage.trim(),
          description: commitDescription.trim() || undefined,
          amend,
          stageAll: (status?.staged?.length || 0) === 0,
          pushAfter,
          syncAfter,
        }),
      {
        syncWorkspace: true,
        reason: "git_commit",
        successText: pushAfter
          ? "Committed and pushed to GitHub"
          : syncAfter
            ? ""
            : "Changes committed",
      },
    );
    if (res) {
      setCommitMessage("");
      setCommitDescription("");
      setSelectedFile(null);
      setDiffData(null);
      if (syncAfter) {
        if (res?.data?.conflicted) {
          showNotice(
            "error",
            "Committed locally, but Sync hit merge conflicts — resolve them in Diff Editor",
          );
          await loadConflicts();
          setSubTab("diff");
        } else {
          showNotice("success", "Committed and synced with GitHub");
        }
      }
      if (subTab === "history") void loadHistory({ reset: true });
      void loadBranches();
    }
  };

  const handleUndoCommit = async (allowPushed = false) => {
    setConfirmUndoPushed(false);
    try {
      await runAction(
        "git reset --soft HEAD~1",
        () => gitService.undoCommit(projectId, { allowPushed }),
        {
          syncWorkspace: true,
          reason: "git_undo_commit",
          successText: "Last commit undone — changes returned to Staged",
        },
      );
      if (subTab === "history") void loadHistory({ reset: true });
      void loadBranches();
    } catch (err) {
      if (err?.code === "COMMIT_ALREADY_PUSHED") {
        setConfirmUndoPushed(true);
      }
    }
  };

  const handleAiCommitDraft = async () => {
    if (aiDrafting || !perms.canAi) return;
    setAiDrafting(true);
    try {
      const res = await gitService.generateAiCommitMessage(projectId);
      const data = res?.data;
      if (data) {
        const subjectLine = formatAiCommitSubject(data);
        setCommitMessage(subjectLine);
        if (data.body) {
          setCommitDescription(data.body);
          setShowDescription(true);
        }
        appendLog(`AI drafted commit: ${subjectLine}`);
      }
    } catch (err) {
      showNotice("error", err?.message || "Failed to generate commit message");
    } finally {
      setAiDrafting(false);
    }
  };

  const handleMergeBranch = async (sourceBranch) => {
    const res = await runAction(
      `git merge ${sourceBranch}`,
      () => gitService.merge(projectId, sourceBranch, { mode: mergeMode }),
      { syncWorkspace: true, reason: "git_merge" },
    );
    if (res?.data?.conflicted) {
      showNotice(
        "error",
        `Merge conflict in ${res.data.conflicts?.length || 1} file(s). Resolve conflicts in Diff Editor.`,
      );
      await loadConflicts();
      setSubTab("diff");
    } else {
      showNotice("success", `Merged '${sourceBranch}' cleanly`);
    }
  };

  const handleRebaseBranch = async (targetBranch) => {
    const res = await runAction(
      `git rebase ${targetBranch}`,
      () => gitService.rebase(projectId, targetBranch),
      { syncWorkspace: true, reason: "git_rebase" },
    );
    if (res?.data?.conflicted) {
      showNotice(
        "error",
        `Rebase conflict in ${res.data.conflicts?.length || 1} file(s). Resolve before continuing.`,
      );
      await loadConflicts();
      setSubTab("diff");
    } else {
      showNotice("success", `Rebased onto '${targetBranch}'`);
    }
  };

  const handleRunConsoleCommand = async (rawInput) => {
    const trimmed = String(rawInput || "").trim();
    if (!trimmed) return;
    setRunningConsole(true);
    try {
      const res = await gitService.runCommand(projectId, trimmed);
      const data = res?.data || {};
      const cmdLabel = data.command || trimmed;
      const outText = data.output ?? res?.result ?? "";
      appendLog(`$ ${cmdLabel}\n${outText || "(no output)"}`);

      if (data.mutated) {
        if (data.status) {
          vcsSummary.applyStatusData(data.status);
        } else {
          vcsSummary.invalidateAll();
        }
        if (data.branches) {
          setBranchesData(data.branches);
        } else if (/\b(pull|fetch|push|checkout|switch|branch)\b/i.test(cmdLabel)) {
          void loadBranches();
        }
        if (data.conflicted) {
          showNotice(
            "error",
            `Command hit merge conflicts (${data.conflicts?.length || 1} file(s)) — resolve them in Diff Editor`,
          );
          await loadConflicts();
          setSubTab("diff");
        }
        if (data.syncWorkspace) {
          await onSync?.({
            reason: "git_console",
            skipVcsRefetch: Boolean(data.status),
          });
        }
        if (subTab === "history") {
          void loadHistory({ reset: true });
        }
      }
    } catch (err) {
      const msg = err?.message || "Git command failed";
      const codeTag = err?.code ? ` [${err.code}]` : "";
      appendLog(`$ ${trimmed}\nERROR${codeTag}: ${msg}`, { isError: true });
      showNotice("error", msg, err?.code || null);
    } finally {
      setRunningConsole(false);
    }
  };

  const hasConflicts =
    (status?.conflicts?.length || 0) > 0 ||
    (status?.operationState && status.operationState !== "IDLE");
  const stagedCount = status?.staged?.length || 0;
  const totalChanges =
    stagedCount +
    (status?.unstaged?.length || 0) +
    (status?.untracked?.length || 0) +
    (status?.conflicts?.length || 0);

  // Capabilities check banner: visible when token revoked or missing repo scope
  const showScopeBanner =
    capabilities && (!capabilities.valid || !capabilities.hasRepoScope);

  return (
    <div className="flex flex-col gap-4">
      {/* Scope / Token Fallback Banner */}
      {showScopeBanner && (
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 rounded-lg border border-amber-500/30 bg-amber-500/10 text-xs">
          <div className="flex items-center gap-2.5 min-w-0">
            <ShieldAlert size={16} className="text-amber-400 shrink-0" />
            <div className="min-w-0">
              <p className="font-semibold text-[var(--color-text)]">
                {capabilities.valid
                  ? "GitHub 'repo' write scope required for Push, Publish & PRs"
                  : "GitHub OAuth session expired or revoked"}
              </p>
              <p className="text-[var(--color-text-secondary)]">
                Authorize GitHub repository permissions to sync branches and Pull Requests seamlessly.
              </p>
            </div>
          </div>
          <Button
            size="sm"
            variant="primary"
            icon={ExternalLink}
            loading={reauthorizing}
            onClick={handleGrantRepoScope}
          >
            Authorize Repo Access
          </Button>
        </div>
      )}

      {/* Real-time BullMQ Operation Indicator */}
      {vcsSummary.activeOperation && (
        <div className="flex items-center justify-between gap-3 px-4 py-2 rounded-lg border border-sky-500/25 bg-sky-500/10 text-xs font-mono text-sky-400">
          <span className="flex items-center gap-2">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-sky-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-sky-500" />
            </span>
            <span>{vcsSummary.activeOperation.message}</span>
          </span>
          <span className="uppercase text-[10px]">
            {vcsSummary.activeOperation.phase}
          </span>
        </div>
      )}

      {/* Transient Notice */}
      {notice && (
        <div
          className={`flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 rounded-lg border text-xs font-medium ${
            notice.type === "error"
              ? "bg-[var(--color-danger)]/10 text-[var(--color-danger)] border-[var(--color-danger)]/30"
              : "bg-[var(--color-success)]/10 text-[var(--color-success)] border-[var(--color-success)]/30"
          }`}
        >
          <div className="flex items-center gap-2 min-w-0 flex-1">
            {notice.type === "error" ? (
              <AlertCircle size={14} className="shrink-0" />
            ) : (
              <CheckCircle2 size={14} className="shrink-0" />
            )}
            <span>{notice.text}</span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {notice.code === "GIT_PUSH_REJECTED" && (
              <>
                <Button
                  size="sm"
                  variant="secondary"
                  loading={busyAction === "git sync"}
                  disabled={!perms.canRemoteWrite || Boolean(busyAction)}
                  onClick={async () => {
                    const res = await runAction(
                      "git sync",
                      () => gitService.sync(projectId),
                      { syncWorkspace: true, reason: "git_sync" },
                    );
                    if (res?.data?.conflicted) {
                      showNotice(
                        "error",
                        "Sync resulted in merge conflicts — resolve them in Diff Editor",
                      );
                      await loadConflicts();
                      setSubTab("diff");
                    } else {
                      showNotice("success", "Synchronized with GitHub");
                    }
                    void loadBranches();
                  }}
                >
                  Sync (Pull &amp; Push)
                </Button>
                {(() => {
                  const curBranch = status?.branch || branchesData.current || "";
                  const defaultBr = project?.defaultBranch || status?.defaultBranch || "main";
                  const isProtectedBranch =
                    curBranch === defaultBr ||
                    curBranch === "main" ||
                    curBranch === "master";
                  return (
                    <Button
                      size="sm"
                      variant="danger"
                      disabled={!perms.canRemoteWrite || isProtectedBranch || Boolean(busyAction)}
                      title={
                        isProtectedBranch
                          ? `Force push is disabled on protected/default branch '${curBranch}'`
                          : "Force push rewritten local history safely (--force-with-lease)"
                      }
                      onClick={() => setConfirmForcePush(true)}
                    >
                      Force Push (--force-with-lease)
                    </Button>
                  );
                })()}
              </>
            )}
            {notice.code === "GIT_AUTH_FAILED" && (
              <Button
                size="sm"
                variant="primary"
                loading={reauthorizing}
                onClick={handleGrantRepoScope}
              >
                Reconnect GitHub
              </Button>
            )}
            <button
              type="button"
              onClick={() => setNotice(null)}
              className="opacity-75 hover:opacity-100 cursor-pointer px-1"
              aria-label="Dismiss notification"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* Uninitialized Repository Empty State */}
      {!vcsSummary.isLoading && status && !status.hasGit ? (
        <div className="flex flex-col items-center justify-center p-10 text-center border border-dashed border-[var(--color-border-strong)] rounded-lg bg-[var(--color-surface)] max-w-2xl mx-auto my-6">
          <div className="w-12 h-12 rounded-lg bg-[var(--color-primary)]/10 border border-[var(--color-primary)]/25 flex items-center justify-center text-[var(--color-primary)] mb-4">
            <FolderGit2 size={24} />
          </div>
          <h3 className="text-base font-semibold text-[var(--color-text)]">
            {status.repoUrl
              ? "Reconnect Git Workspace"
              : "Initialize Git & Publish to GitHub"}
          </h3>
          <p className="text-xs text-[var(--color-text-secondary)] mt-1.5 max-w-md leading-relaxed">
            {status.repoUrl
              ? `This workspace is linked to ${status.repoUrl}. Initialize local Git metadata to resume commits, diffs, and syncing.`
              : "This project was uploaded as an archive. Initialize a local Git repository in one click or publish directly to a new GitHub repository."}
          </p>

          <div className="flex flex-wrap items-center justify-center gap-2.5 mt-5">
            <Button
              variant="primary"
              size="md"
              icon={GitBranch}
              loading={busyAction === "git init"}
              disabled={!perms.canRemoteWrite || Boolean(busyAction)}
              title={!perms.canRemoteWrite ? perms.disabledReason("remote") : ""}
              onClick={handleInitRepo}
            >
              Initialize Git Repository
            </Button>
            {!status.repoUrl && (
              <Button
                variant="secondary"
                size="md"
                icon={UploadCloud}
                disabled={!perms.canRemoteWrite || Boolean(busyAction)}
                title={!perms.canRemoteWrite ? perms.disabledReason("remote") : ""}
                onClick={() => setShowPublishModal(true)}
              >
                Publish to GitHub
              </Button>
            )}
          </div>
        </div>
      ) : (
        <>
          {/* Top Command Bar */}
          <div className="flex flex-wrap items-center justify-between gap-2.5 p-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]">
            <div className="flex flex-wrap items-center gap-2">
              {/* Branch Dropdown */}
              <div className="relative" ref={branchDropdownRef}>
                <button
                  type="button"
                  onClick={() => setShowBranchMenu((o) => !o)}
                  className="inline-flex items-center gap-2 h-8 px-3 rounded-md bg-[var(--color-surface-secondary)] hover:bg-[var(--color-border)]/40 border border-[var(--color-border)] text-xs font-mono text-[var(--color-text)] cursor-pointer transition-colors duration-150"
                >
                  <GitBranch size={13} className="text-[var(--color-primary)]" />
                  <span className="font-semibold">
                    {status?.branch || branchesData.current || "main"}
                  </span>
                  {status?.tracking && (
                    <span className="text-[10px] tabular-nums text-[var(--color-text-muted)]">
                      ↓{status.behind || 0} ↑{status.ahead || 0}
                    </span>
                  )}
                  <ChevronDown size={12} className="text-[var(--color-text-muted)]" />
                </button>

                {showBranchMenu && (
                  <div className="absolute left-0 top-full mt-1.5 z-40 w-64 rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface)] shadow-xl p-2 text-xs">
                    <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--color-text-muted)] px-1 pb-1.5 mb-1.5 border-b border-[var(--color-border)]">
                      Switch Branch
                    </div>
                    <div className="max-h-48 overflow-y-auto space-y-0.5 custom-scrollbar">
                      {(branchesData.local || []).map((b) => (
                        <button
                          key={b}
                          type="button"
                          disabled={
                            b === branchesData.current ||
                            !perms.canRemoteWrite ||
                            Boolean(busyAction)
                          }
                          title={
                            !perms.canRemoteWrite
                              ? perms.disabledReason("remote")
                              : b
                          }
                          onClick={() => {
                            setShowBranchMenu(false);
                            void runAction(
                              `git checkout ${b}`,
                              () =>
                                gitService.checkout(projectId, {
                                  branch: b,
                                  stashDirty: stashBeforeCheckout,
                                }),
                              {
                                syncWorkspace: true,
                                reason: "git_checkout",
                                successText: `Switched to branch '${b}'`,
                              },
                            );
                          }}
                          className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded text-left font-mono cursor-pointer disabled:opacity-50 ${
                            b === branchesData.current
                              ? "bg-[var(--color-primary)]/12 text-[var(--color-primary)] font-semibold"
                              : "hover:bg-[var(--color-surface-secondary)] text-[var(--color-text)]"
                          }`}
                        >
                          <span className="truncate">{b}</span>
                          {b === branchesData.current && <Check size={12} />}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Remote badge or Publish/Link buttons */}
              {status?.repoUrl ? (
                <a
                  href={status.repoUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-md bg-[var(--color-surface-secondary)] border border-[var(--color-border)] hover:border-[var(--color-primary)] text-xs font-mono text-[var(--color-text-secondary)] hover:text-[var(--color-text)] transition-colors duration-150"
                >
                  <span className="truncate max-w-[180px]">
                    {status.repoUrl.replace("https://github.com/", "")}
                  </span>
                  <ExternalLink size={11} />
                </a>
              ) : (
                <>
                  <Button
                    size="sm"
                    variant="secondary"
                    icon={UploadCloud}
                    disabled={!perms.canRemoteWrite}
                    title={
                      !perms.canRemoteWrite
                        ? perms.disabledReason("remote")
                        : "Create GitHub repo and push"
                    }
                    onClick={() => setShowPublishModal(true)}
                  >
                    Publish to GitHub
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    icon={Link2}
                    disabled={!perms.canRemoteWrite}
                    title={
                      !perms.canRemoteWrite
                        ? perms.disabledReason("remote")
                        : "Set existing origin remote URL"
                    }
                    onClick={() => setShowRemoteModal(true)}
                  >
                    Link Remote
                  </Button>
                </>
              )}
            </div>

            {/* Remote Sync Toolbar */}
            <div className="flex flex-wrap items-center gap-1.5">
              <Button
                size="sm"
                variant="secondary"
                icon={RefreshCw}
                loading={busyAction === "git fetch"}
                disabled={!perms.canRemoteWrite || !status?.repoUrl || Boolean(busyAction)}
                title={
                  !perms.canRemoteWrite
                    ? perms.disabledReason("remote")
                    : !status?.repoUrl
                      ? "Link or publish a remote repository first"
                      : "Fetch remote updates"
                }
                onClick={() =>
                  runAction("git fetch", () => gitService.fetch(projectId), {
                    successText: "Fetched remote references",
                  }).then(() => loadBranches())
                }
              >
                Fetch
              </Button>
              <Button
                size="sm"
                variant="secondary"
                icon={ArrowDown}
                loading={busyAction === "git pull"}
                disabled={!perms.canRemoteWrite || !status?.repoUrl || Boolean(busyAction)}
                title={
                  !perms.canRemoteWrite
                    ? perms.disabledReason("remote")
                    : "Pull remote changes"
                }
                onClick={async () => {
                  const res = await runAction(
                    "git pull",
                    () => gitService.pull(projectId),
                    { syncWorkspace: true, reason: "git_pull" },
                  );
                  if (res?.data?.conflicted) {
                    showNotice("error", "Pull resulted in merge conflicts");
                    await loadConflicts();
                  } else {
                    showNotice("success", "Pulled latest commits from origin");
                  }
                  void loadBranches();
                }}
              >
                Pull
              </Button>
              <Button
                size="sm"
                variant="secondary"
                icon={ArrowUp}
                loading={busyAction === "git push"}
                disabled={!perms.canRemoteWrite || !status?.repoUrl || Boolean(busyAction)}
                title={
                  !perms.canRemoteWrite
                    ? perms.disabledReason("remote")
                    : "Push local commits to origin"
                }
                onClick={() =>
                  runAction("git push", () => gitService.push(projectId), {
                    successText: "Pushed commits to GitHub",
                  }).then(() => loadBranches())
                }
              >
                Push
              </Button>
              <Button
                size="sm"
                variant="primary"
                icon={RefreshCw}
                loading={busyAction === "git sync"}
                disabled={!perms.canRemoteWrite || !status?.repoUrl || Boolean(busyAction)}
                title={
                  !perms.canRemoteWrite
                    ? perms.disabledReason("remote")
                    : "Fetch, Pull, and Push in one click"
                }
                onClick={async () => {
                  const res = await runAction(
                    "git sync",
                    () => gitService.sync(projectId),
                    {
                      syncWorkspace: true,
                      reason: "git_sync",
                    },
                  );
                  if (res?.data?.conflicted) {
                    showNotice(
                      "error",
                      "Sync resulted in merge conflicts — resolve them in Diff Editor",
                    );
                    await loadConflicts();
                    setSubTab("diff");
                  } else {
                    showNotice("success", "Synchronized with GitHub");
                  }
                  void loadBranches();
                }}
              >
                <span className="font-mono tabular-nums">
                  Sync ↓{status?.behind || 0} ↑{status?.ahead || 0}
                </span>
              </Button>
              <Button
                size="sm"
                variant={showConsole ? "primary" : "outline"}
                icon={Terminal}
                onClick={() => setShowConsole((c) => !c)}
                title="Toggle Git Output Console"
              >
                Console
              </Button>
              <Button
                size="sm"
                variant="outline"
                icon={RefreshCw}
                onClick={() => {
                  vcsSummary.refetch();
                  void loadBranches();
                }}
                title="Refresh Git status"
              />
            </div>
          </div>

          {/* Conflict State Banner */}
          {hasConflicts && (
            <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 rounded-lg border border-rose-500/30 bg-rose-500/10 text-xs">
              <div className="flex items-center gap-2">
                <AlertTriangle size={15} className="text-rose-400 shrink-0" />
                <span className="font-semibold text-[var(--color-text)]">
                  Repository state: {status?.operationState} —{" "}
                  {status?.conflicts?.length || 0} conflicted file(s)
                </span>
              </div>
              <Button
                size="sm"
                variant="danger"
                onClick={() => {
                  void loadConflicts();
                  setSubTab("diff");
                }}
              >
                Open Conflict Resolver
              </Button>
            </div>
          )}

          {/* Main 2-Zone Workbench */}
          <div className="grid grid-cols-1 xl:grid-cols-12 gap-4 items-start">
            {/* LEFT PANE: Commit Box & Changes Tree */}
            <div className="xl:col-span-4 flex flex-col gap-3">
              {/* Commit Card */}
              <div className="p-3.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-text-muted)] flex items-center gap-1.5">
                    <GitCommit size={13} className="text-[var(--color-primary)]" />
                    Commit Changes
                  </span>
                  <button
                    type="button"
                    disabled={!perms.canAi || totalChanges === 0 || aiDrafting}
                    title={
                      !perms.canAi
                        ? perms.disabledReason("ai")
                        : "Draft Conventional Commit with Gemini AI"
                    }
                    onClick={handleAiCommitDraft}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium bg-[var(--color-surface-secondary)] hover:border-[var(--color-primary)] border border-[var(--color-border)] text-[var(--color-text)] disabled:opacity-45 disabled:cursor-not-allowed cursor-pointer transition-colors duration-150"
                  >
                    {aiDrafting ? (
                      <Loader2 size={11} className="animate-spin" />
                    ) : (
                      <Sparkles size={11} className="text-[var(--color-primary)]" />
                    )}
                    <span>AI Draft</span>
                  </button>
                </div>

                {/* Conventional Prefix Chips */}
                <div className="flex flex-wrap gap-1">
                  {CONVENTIONAL_PREFIXES.map((prefix) => (
                    <button
                      key={prefix}
                      type="button"
                      disabled={!perms.canLocalWrite}
                      onClick={() =>
                        setCommitMessage((prev) =>
                          prev.startsWith(prefix) ? prev : `${prefix} ${prev.trimStart()}`,
                        )
                      }
                      className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-[var(--color-surface-secondary)] hover:bg-[var(--color-border)]/50 border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:text-[var(--color-text)] cursor-pointer disabled:opacity-40"
                    >
                      {prefix}
                    </button>
                  ))}
                </div>

                <textarea
                  value={commitMessage}
                  onChange={(e) => setCommitMessage(e.target.value)}
                  onKeyDown={(e) => {
                    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
                      e.preventDefault();
                      void handleCommit();
                    }
                  }}
                  disabled={!perms.canLocalWrite}
                  placeholder={
                    perms.canLocalWrite
                      ? `Message (Ctrl+Enter to commit on '${status?.branch || "main"}')`
                      : perms.disabledReason("local")
                  }
                  rows={2}
                  className="w-full p-2.5 rounded-md bg-[var(--color-surface-secondary)] border border-[var(--color-border)] focus:border-[var(--color-primary)] outline-none text-xs font-mono text-[var(--color-text)] placeholder:text-[var(--color-text-muted)] resize-y disabled:opacity-50"
                />

                {showDescription && (
                  <textarea
                    value={commitDescription}
                    onChange={(e) => setCommitDescription(e.target.value)}
                    disabled={!perms.canLocalWrite}
                    placeholder="Extended commit description (optional)"
                    rows={2}
                    className="w-full p-2 rounded-md bg-[var(--color-surface-secondary)] border border-[var(--color-border)] focus:border-[var(--color-primary)] outline-none text-xs text-[var(--color-text)] placeholder:text-[var(--color-text-muted)] resize-y"
                  />
                )}

                <div className="flex items-center justify-between text-[11px]">
                  <button
                    type="button"
                    onClick={() => setShowDescription((v) => !v)}
                    className="text-[var(--color-text-muted)] hover:text-[var(--color-text)] cursor-pointer"
                  >
                    {showDescription ? "Hide description" : "+ Description"}
                  </button>
                  <span className="font-mono tabular-nums text-[var(--color-text-muted)]">
                    {stagedCount > 0
                      ? `${stagedCount} staged`
                      : `${totalChanges} unstaged`}
                  </span>
                </div>

                {/* Split Action Button */}
                <div className="relative flex items-stretch gap-1" ref={splitMenuRef}>
                  <button
                    type="button"
                    disabled={
                      !perms.canLocalWrite ||
                      !commitMessage.trim() ||
                      totalChanges === 0 ||
                      Boolean(busyAction)
                    }
                    title={
                      !perms.canLocalWrite
                        ? perms.disabledReason("local")
                        : "Commit changes (Ctrl+Enter)"
                    }
                    onClick={() => handleCommit()}
                    className="flex-1 h-9 px-3 rounded-l-md bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white text-xs font-semibold flex items-center justify-center gap-1.5 disabled:opacity-45 disabled:cursor-not-allowed cursor-pointer transition-colors duration-150"
                  >
                    {busyAction.startsWith("git commit") ? (
                      <Loader2 size={13} className="animate-spin" />
                    ) : (
                      <Check size={13} />
                    )}
                    <span>
                      {stagedCount > 0
                        ? `Commit (${stagedCount} Staged)`
                        : "Stage All & Commit"}
                    </span>
                  </button>

                  <button
                    type="button"
                    disabled={!perms.canLocalWrite || Boolean(busyAction)}
                    onClick={() => setShowSplitMenu((s) => !s)}
                    aria-label="More commit actions"
                    className="w-9 h-9 rounded-r-md bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white flex items-center justify-center disabled:opacity-45 cursor-pointer transition-colors duration-150"
                  >
                    <ChevronDown size={14} />
                  </button>

                  {showSplitMenu && (
                    <div className="absolute right-0 top-full mt-1 z-40 w-56 rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface)] shadow-xl p-1 text-xs">
                      <button
                        type="button"
                        disabled={!perms.canRemoteWrite || !commitMessage.trim() || totalChanges === 0}
                        title={
                          !perms.canRemoteWrite
                            ? perms.disabledReason("remote")
                            : "Commit and Push immediately"
                        }
                        onClick={() => handleCommit({ pushAfter: true })}
                        className="w-full text-left px-2.5 py-1.5 rounded hover:bg-[var(--color-surface-secondary)] text-[var(--color-text)] disabled:opacity-45 cursor-pointer"
                      >
                        Commit &amp; Push
                      </button>
                      <button
                        type="button"
                        disabled={!perms.canRemoteWrite || !commitMessage.trim() || totalChanges === 0}
                        title={
                          !perms.canRemoteWrite
                            ? perms.disabledReason("remote")
                            : "Commit and Sync with GitHub"
                        }
                        onClick={() => handleCommit({ syncAfter: true })}
                        className="w-full text-left px-2.5 py-1.5 rounded hover:bg-[var(--color-surface-secondary)] text-[var(--color-text)] disabled:opacity-45 cursor-pointer"
                      >
                        Commit &amp; Sync
                      </button>
                      <button
                        type="button"
                        disabled={!commitMessage.trim()}
                        onClick={() => handleCommit({ amend: true })}
                        className="w-full text-left px-2.5 py-1.5 rounded hover:bg-[var(--color-surface-secondary)] text-[var(--color-text)] disabled:opacity-45 cursor-pointer"
                      >
                        Amend Last Commit
                      </button>
                      <div className="my-1 h-px bg-[var(--color-border)]" />
                      <button
                        type="button"
                        onClick={() => {
                          setShowSplitMenu(false);
                          void handleUndoCommit(false);
                        }}
                        className="w-full text-left px-2.5 py-1.5 rounded hover:bg-rose-500/10 text-rose-400 cursor-pointer"
                      >
                        Undo Last Commit (Soft)
                      </button>
                    </div>
                  )}
                </div>

                {totalChanges > 0 && !commitMessage.trim() && perms.canLocalWrite && (
                  <p className="text-[11px] text-[var(--color-text-muted)]">
                    Enter a commit message above (or click AI Draft) to commit.
                  </p>
                )}

                {status?.repoUrl && perms.canRemoteWrite && totalChanges > 0 && (
                  <Button
                    size="sm"
                    variant="secondary"
                    icon={ArrowUp}
                    loading={busyAction === "git commit & push"}
                    disabled={!commitMessage.trim() || Boolean(busyAction)}
                    onClick={() => handleCommit({ pushAfter: true })}
                    className="w-full"
                  >
                    Commit &amp; Push to {status?.branch || "main"}
                  </Button>
                )}

                {status?.repoUrl && perms.canRemoteWrite && totalChanges === 0 && (status?.ahead || 0) > 0 && (
                  <Button
                    size="sm"
                    variant="primary"
                    icon={ArrowUp}
                    loading={busyAction === "git push"}
                    disabled={Boolean(busyAction)}
                    onClick={() =>
                      runAction("git push", () => gitService.push(projectId), {
                        successText: "Pushed commits to GitHub",
                      }).then(() => loadBranches())
                    }
                    className="w-full"
                  >
                    Push {status.ahead} Commit(s) to origin
                  </Button>
                )}
              </div>

              {/* Changes Tree */}
              <VcsChangesTree
                mode="git"
                conflicts={status?.conflicts || []}
                staged={status?.staged || []}
                unstaged={status?.unstaged || []}
                untracked={status?.untracked || []}
                selectedFile={selectedFile}
                onSelectFile={loadDiffPair}
                onStage={(files) => handleStage(files)}
                onUnstage={(files) => handleUnstage(files)}
                onStageAll={() => handleStage("all")}
                onUnstageAll={() => handleUnstage("all")}
                onStageFolder={(folder) => handleStage(undefined, folder)}
                onUnstageFolder={(folder) => handleUnstage(undefined, folder)}
                onDiscard={(item) => setPendingDiscard(item)}
                onDiscardAll={() => setPendingDiscard({ all: true })}
                onAddToGitignore={(pattern) =>
                  runAction(
                    `gitignore ${pattern}`,
                    () => gitService.addGitignore(projectId, pattern),
                    { successText: `Added '${pattern}' to .gitignore` },
                  )
                }
                onOpenInEditor={onOpenFile}
                canLocalWrite={perms.canLocalWrite}
                disabledReason={perms.disabledReason("local")}
                pendingActions={pendingStageKeys}
              />
            </div>

            {/* RIGHT PANE: Sub-Tabs Workbench */}
            <div className="xl:col-span-8 flex flex-col gap-3 min-w-0">
              {/* Sub-tab Strip */}
              <div className="flex items-center gap-1 p-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] overflow-x-auto custom-scrollbar">
                {[
                  { id: "diff", label: "Diff Editor", icon: FolderGit2 },
                  { id: "history", label: "History & Graph", icon: History },
                  { id: "branches", label: "Branches", icon: GitBranch },
                  {
                    id: "stashes",
                    label: `Stashes (${status?.stashCount || stashes.length || 0})`,
                    icon: Archive,
                  },
                  { id: "tags", label: "Tags", icon: Tag },
                  { id: "pulls", label: "Pull Requests", icon: GitMerge },
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
                      <Icon size={13} className={active ? "text-[var(--color-primary)]" : ""} />
                      <span>{tab.label}</span>
                    </button>
                  );
                })}
              </div>

              {/* SUB-TAB 1: DIFF & CONFLICT RESOLVER */}
              {subTab === "diff" && (
                <div className="flex flex-col gap-3">
                  {(conflictsDetail.length > 0 ||
                    (status?.operationState && status.operationState !== "IDLE")) && (
                    <VcsConflictResolver
                      mode="git"
                      operationLabel={`Git ${status?.operationState || "Merge"} Conflicts`}
                      conflicts={conflictsDetail}
                      canResolve={perms.canLocalWrite}
                      disabledReason={perms.disabledReason("local")}
                      resolving={resolvingConflict}
                      onResolveFile={async ({ filePath, resolution, manualContent }) => {
                        setResolvingConflict(true);
                        try {
                          await runAction(
                            `resolve ${filePath}`,
                            () =>
                              gitService.resolveConflict(projectId, {
                                filePath,
                                resolution,
                                manualContent,
                              }),
                            { syncWorkspace: true, reason: "git_conflict_resolve" },
                          );
                          await loadConflicts();
                        } finally {
                          setResolvingConflict(false);
                        }
                      }}
                      onAbort={async () => {
                        setResolvingConflict(true);
                        try {
                          await runAction(
                            "git abort",
                            () => gitService.abortOperation(projectId),
                            {
                              syncWorkspace: true,
                              reason: "git_abort",
                              successText: "Operation aborted cleanly",
                            },
                          );
                          setConflictsDetail([]);
                        } finally {
                          setResolvingConflict(false);
                        }
                      }}
                      onContinue={async () => {
                        const prevOpState = status?.operationState;
                        setResolvingConflict(true);
                        try {
                          const res = await runAction(
                            "git continue",
                            () => gitService.continueOperation(projectId),
                            {
                              syncWorkspace: true,
                              reason: "git_continue",
                            },
                          );
                          if (res?.data?.conflicted) {
                            await loadConflicts();
                            showNotice(
                              "error",
                              `Next commit has ${res.data.conflicts?.length || 1} conflict(s). Resolve to continue.`,
                            );
                          } else {
                            setConflictsDetail([]);
                            const doneText =
                              prevOpState === "CHERRY_PICKING"
                                ? "Cherry-pick completed successfully"
                                : prevOpState === "REVERTING"
                                  ? "Revert completed successfully"
                                  : "Merge / Rebase completed successfully";
                            showNotice("success", doneText);
                          }
                        } finally {
                          setResolvingConflict(false);
                        }
                      }}
                    />
                  )}

                  <div className="h-[520px]">
                    <VcsMonacoDiffEditor
                      diffData={diffData}
                      loading={loadingDiff}
                      error={diffError}
                      canLocalWrite={perms.canLocalWrite}
                      disabledReason={perms.disabledReason("local")}
                      showHunkActions={
                        selectedFile?.section === "unstaged" ||
                        selectedFile?.section === "staged"
                      }
                      hunkMode={
                        selectedFile?.section === "staged" ? "staged" : "working"
                      }
                      onStageHunk={async (filePath, idx) => {
                        await runAction(`stage hunk #${idx + 1}`, () =>
                          gitService.stageHunk(projectId, filePath, idx),
                        );
                        await loadDiffPair(selectedFile, selectedFile.section);
                      }}
                      onUnstageHunk={async (filePath, idx) => {
                        await runAction(`unstage hunk #${idx + 1}`, () =>
                          gitService.unstageHunk(projectId, filePath, idx),
                        );
                        await loadDiffPair(selectedFile, selectedFile.section);
                      }}
                      onRevertHunk={async (filePath, idx) => {
                        await runAction(
                          `revert hunk #${idx + 1}`,
                          () => gitService.revertHunk(projectId, filePath, idx),
                          { syncWorkspace: true, reason: "git_revert_hunk" },
                        );
                        await loadDiffPair(selectedFile, selectedFile.section);
                      }}
                      onOpenInEditor={onOpenFile}
                    />
                  </div>
                </div>
              )}

              {/* SUB-TAB 2: HISTORY & COMMIT GRAPH */}
              {subTab === "history" && (
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center gap-2 p-2.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]">
                    <div className="flex-1 min-w-[180px] flex items-center gap-1.5 h-8 px-2.5 rounded-md bg-[var(--color-surface-secondary)] border border-[var(--color-border)]">
                      <Search size={12} className="text-[var(--color-text-muted)]" />
                      <input
                        type="text"
                        value={logSearch}
                        onChange={(e) => setLogSearch(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && void loadHistory({ reset: true })}
                        placeholder="Search commit messages..."
                        className="w-full bg-transparent outline-none text-xs text-[var(--color-text)]"
                      />
                    </div>
                    <select
                      value={logBranch}
                      onChange={(e) => setLogBranch(e.target.value)}
                      className="h-8 px-2.5 rounded-md bg-[var(--color-surface-secondary)] border border-[var(--color-border)] font-mono text-xs text-[var(--color-text)]"
                    >
                      <option value="">Current HEAD</option>
                      {(branchesData.local || []).map((b) => (
                        <option key={b} value={b}>
                          {b}
                        </option>
                      ))}
                    </select>
                    <Button
                      size="sm"
                      variant="secondary"
                      loading={loadingHistory}
                      onClick={() => loadHistory({ reset: true })}
                    >
                      Filter
                    </Button>
                  </div>

                  {loadingHistory && commits.length === 0 ? (
                    <SnapshotsListSkeleton count={4} />
                  ) : (
                    <VcsCommitGraph
                      items={commits}
                      selectedId={selectedCommit?.hash}
                      onSelect={handleInspectCommit}
                      hasMore={hasMoreCommits}
                      onLoadMore={() => loadHistory({ reset: false })}
                      loading={loadingHistory}
                      renderItemMeta={(commit) =>
                        commit.refs?.length > 0 ? (
                          <div className="hidden sm:flex items-center gap-1 shrink-0">
                            {commit.refs.slice(0, 2).map((refName) => (
                              <span
                                key={refName}
                                className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-indigo-500/10 text-indigo-400 border border-indigo-500/20"
                              >
                                {refName}
                              </span>
                            ))}
                          </div>
                        ) : null
                      }
                    />
                  )}

                  {selectedCommit && (
                    <div className="p-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] space-y-3">
                      <div className="flex flex-wrap items-start justify-between gap-2 pb-2.5 border-b border-[var(--color-border)]">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-xs font-semibold text-[var(--color-primary)]">
                              {selectedCommit.shortHash}
                            </span>
                            <h4 className="text-sm font-semibold text-[var(--color-text)]">
                              {selectedCommit.subject}
                            </h4>
                          </div>
                          <p className="text-[11px] text-[var(--color-text-muted)] font-mono mt-0.5">
                            {selectedCommit.author} &lt;{selectedCommit.email}&gt; ·{" "}
                            {formatRelativeTime(selectedCommit.dateIso)}
                          </p>
                        </div>

                        <div className="flex flex-wrap items-center gap-1.5">
                          <Button
                            size="sm"
                            variant="secondary"
                            icon={RotateCcw}
                            disabled={!perms.canRemoteWrite || Boolean(busyAction)}
                            title={
                              !perms.canRemoteWrite
                                ? perms.disabledReason("remote")
                                : "Revert this commit"
                            }
                            onClick={async () => {
                              const res = await runAction(
                                `git revert ${selectedCommit.shortHash}`,
                                () =>
                                  gitService.revertCommit(
                                    projectId,
                                    selectedCommit.hash,
                                  ),
                                { syncWorkspace: true, reason: "git_revert" },
                              );
                              if (res?.data?.conflicted) {
                                await loadConflicts();
                                setSubTab("diff");
                              } else {
                                void loadHistory({ reset: true });
                              }
                            }}
                          >
                            Revert
                          </Button>
                          <Button
                            size="sm"
                            variant="secondary"
                            disabled={!perms.canRemoteWrite || Boolean(busyAction)}
                            title={
                              !perms.canRemoteWrite
                                ? perms.disabledReason("remote")
                                : "Cherry-pick into current branch"
                            }
                            onClick={async () => {
                              const res = await runAction(
                                `git cherry-pick ${selectedCommit.shortHash}`,
                                () =>
                                  gitService.cherryPickCommit(
                                    projectId,
                                    selectedCommit.hash,
                                  ),
                                { syncWorkspace: true, reason: "git_cherry_pick" },
                              );
                              if (res?.data?.conflicted) {
                                await loadConflicts();
                                setSubTab("diff");
                              } else {
                                void loadHistory({ reset: true });
                              }
                            }}
                          >
                            Cherry-Pick
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={!perms.canRemoteWrite || Boolean(busyAction)}
                            title={
                              !perms.canRemoteWrite
                                ? perms.disabledReason("remote")
                                : "Reset branch to this commit"
                            }
                            onClick={() =>
                              setPendingReset({
                                hash: selectedCommit.hash,
                                shortHash: selectedCommit.shortHash,
                                mode: "mixed",
                              })
                            }
                          >
                            Reset Here
                          </Button>
                        </div>
                      </div>

                      {loadingCommitDetail ? (
                        <div className="text-xs text-[var(--color-text-muted)] py-2">
                          Loading changed files...
                        </div>
                      ) : (
                        <div className="space-y-1 max-h-52 overflow-y-auto custom-scrollbar">
                          {(commitDetail?.files || []).map((f) => (
                            <button
                              key={f.path}
                              type="button"
                              onClick={() =>
                                handleLoadCommitFileDiff(selectedCommit.hash, f)
                              }
                              className="w-full flex items-center justify-between gap-2 px-2.5 py-1.5 rounded hover:bg-[var(--color-surface-secondary)] text-left text-xs cursor-pointer transition-colors duration-150"
                            >
                              <div className="flex items-center gap-2 min-w-0">
                                <span className="font-mono text-[10px] font-bold text-[var(--color-primary)]">
                                  {f.status}
                                </span>
                                <span className="font-mono truncate text-[var(--color-text)]">
                                  {f.origPath ? `${f.origPath} → ${f.path}` : f.path}
                                </span>
                              </div>
                              <span className="font-mono tabular-nums text-[11px] shrink-0">
                                <span className="text-emerald-400">
                                  +{f.insertions}
                                </span>{" "}
                                <span className="text-rose-400">
                                  -{f.deletions}
                                </span>
                              </span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* SUB-TAB 3: BRANCHES */}
              {subTab === "branches" && (
                <div className="space-y-4">
                  {/* Create Branch Card */}
                  <div className="p-3.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] flex flex-wrap items-center gap-2">
                    <input
                      type="text"
                      value={newBranchName}
                      onChange={(e) => setNewBranchName(e.target.value)}
                      placeholder="feat/new-branch"
                      disabled={!perms.canRemoteWrite}
                      className="flex-1 min-w-[180px] h-8 px-2.5 rounded-md bg-[var(--color-surface-secondary)] border border-[var(--color-border)] font-mono text-xs text-[var(--color-text)] outline-none"
                    />
                    <input
                      type="text"
                      value={newBranchFrom}
                      onChange={(e) => setNewBranchFrom(e.target.value)}
                      placeholder="From ref (optional, default HEAD)"
                      disabled={!perms.canRemoteWrite}
                      className="w-48 h-8 px-2.5 rounded-md bg-[var(--color-surface-secondary)] border border-[var(--color-border)] font-mono text-xs text-[var(--color-text)] outline-none"
                    />
                    <label className="inline-flex items-center gap-1.5 text-xs text-[var(--color-text-secondary)]">
                      <input
                        type="checkbox"
                        checked={stashBeforeCheckout}
                        onChange={(e) => setStashBeforeCheckout(e.target.checked)}
                      />
                      <span>Auto-stash dirty</span>
                    </label>
                    <Button
                      size="sm"
                      variant="primary"
                      icon={Plus}
                      disabled={!perms.canRemoteWrite || !newBranchName.trim() || Boolean(busyAction)}
                      title={!perms.canRemoteWrite ? perms.disabledReason("remote") : ""}
                      onClick={async () => {
                        const name = newBranchName.trim();
                        await runAction(
                          `git checkout -b ${name}`,
                          () =>
                            gitService.checkout(projectId, {
                              branch: name,
                              createNew: true,
                              fromRef: newBranchFrom.trim() || undefined,
                              stashDirty: stashBeforeCheckout,
                            }),
                          {
                            syncWorkspace: true,
                            reason: "git_branch_create",
                            successText: `Created & switched to '${name}'`,
                          },
                        );
                        setNewBranchName("");
                        setNewBranchFrom("");
                        await loadBranches();
                      }}
                    >
                      Create Branch
                    </Button>
                  </div>

                  {/* Merge Mode Control */}
                  <div className="flex items-center justify-between px-3 py-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] text-xs">
                    <span className="text-[var(--color-text-secondary)]">
                      Active branch:{" "}
                      <strong className="font-mono text-[var(--color-text)]">
                        {branchesData.current}
                      </strong>
                    </span>
                    <div className="flex items-center gap-2">
                      <span className="text-[var(--color-text-muted)]">Merge mode:</span>
                      <select
                        value={mergeMode}
                        onChange={(e) => setMergeMode(e.target.value)}
                        className="h-7 px-2 rounded bg-[var(--color-surface-secondary)] border border-[var(--color-border)] font-mono text-xs text-[var(--color-text)]"
                      >
                        <option value="merge">Fast-forward / Merge</option>
                        <option value="no-ff">No Fast-Forward (--no-ff)</option>
                        <option value="squash">Squash (--squash)</option>
                      </select>
                    </div>
                  </div>

                  {/* Local Branches List */}
                  <div className="border border-[var(--color-border)] rounded-lg bg-[var(--color-surface)] divide-y divide-[var(--color-border)]">
                    {(branchesData.localBranches?.length
                      ? branchesData.localBranches
                      : (branchesData.local || []).map((name) => ({
                          name,
                          isCurrent: name === branchesData.current,
                        }))
                    ).map((b) => (
                      <div
                        key={b.name}
                        className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-xs"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <GitBranch
                              size={13}
                              className={
                                b.isCurrent
                                  ? "text-emerald-400"
                                  : "text-[var(--color-text-muted)]"
                              }
                            />
                            <span className="font-mono font-semibold text-[var(--color-text)]">
                              {b.name}
                            </span>
                            {b.isCurrent && (
                              <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                                CURRENT
                              </span>
                            )}
                            {b.oid && (
                              <span className="text-[10.5px] font-mono text-[var(--color-text-muted)]">
                                {b.oid}
                              </span>
                            )}
                          </div>
                          {b.lastCommitSubject && (
                            <p className="text-[11px] text-[var(--color-text-muted)] truncate mt-0.5 pl-5">
                              {b.lastCommitSubject}
                            </p>
                          )}
                        </div>

                        {renameTarget === b.name ? (
                          <div className="flex items-center gap-1.5">
                            <input
                              type="text"
                              value={renameValue}
                              onChange={(e) => setRenameValue(e.target.value)}
                              className="h-7 px-2 rounded bg-[var(--color-surface-secondary)] border border-[var(--color-border)] font-mono text-xs text-[var(--color-text)]"
                            />
                            <Button
                              size="sm"
                              variant="primary"
                              onClick={async () => {
                                await runAction(
                                  `rename ${b.name}`,
                                  () =>
                                    gitService.renameBranch(
                                      projectId,
                                      b.name,
                                      renameValue.trim(),
                                    ),
                                  { successText: `Renamed '${b.name}' to '${renameValue.trim()}'` },
                                );
                                setRenameTarget(null);
                                await loadBranches();
                              }}
                            >
                              Save
                            </Button>
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => setRenameTarget(null)}
                            >
                              Cancel
                            </Button>
                          </div>
                        ) : (
                          <div className="flex flex-wrap items-center gap-1.5">
                            {!b.isCurrent && (
                              <>
                                <Button
                                  size="sm"
                                  variant="secondary"
                                  disabled={!perms.canRemoteWrite || Boolean(busyAction)}
                                  title={!perms.canRemoteWrite ? perms.disabledReason("remote") : ""}
                                  onClick={() =>
                                    runAction(
                                      `git checkout ${b.name}`,
                                      () =>
                                        gitService.checkout(projectId, {
                                          branch: b.name,
                                          stashDirty: stashBeforeCheckout,
                                        }),
                                      { syncWorkspace: true, reason: "git_checkout" },
                                    ).then(loadBranches)
                                  }
                                >
                                  Checkout
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  disabled={!perms.canRemoteWrite || Boolean(busyAction)}
                                  title={!perms.canRemoteWrite ? perms.disabledReason("remote") : ""}
                                  onClick={() => handleMergeBranch(b.name)}
                                >
                                  Merge Into {branchesData.current}
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  disabled={!perms.canRemoteWrite || Boolean(busyAction)}
                                  title={!perms.canRemoteWrite ? perms.disabledReason("remote") : ""}
                                  onClick={() => handleRebaseBranch(b.name)}
                                >
                                  Rebase Onto
                                </Button>
                              </>
                            )}
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={!perms.canRemoteWrite}
                              onClick={() => {
                                setRenameTarget(b.name);
                                setRenameValue(b.name);
                              }}
                            >
                              Rename
                            </Button>
                            {!b.isCurrent && (
                              <Button
                                size="sm"
                                variant="outline"
                                icon={Trash2}
                                disabled={!perms.canRemoteWrite}
                                onClick={() => {
                                  setDeleteRemoteBranch(false);
                                  setPendingDeleteBranch(b.name);
                                }}
                              />
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* SUB-TAB 4: STASHES */}
              {subTab === "stashes" && (
                <div className="space-y-3">
                  <div className="p-3.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] flex flex-wrap items-center gap-2">
                    <input
                      type="text"
                      value={stashMessage}
                      onChange={(e) => setStashMessage(e.target.value)}
                      placeholder="Stash message (optional)"
                      disabled={!perms.canLocalWrite}
                      className="flex-1 min-w-[200px] h-8 px-2.5 rounded-md bg-[var(--color-surface-secondary)] border border-[var(--color-border)] text-xs text-[var(--color-text)] outline-none"
                    />
                    <label className="inline-flex items-center gap-1.5 text-xs text-[var(--color-text-secondary)]">
                      <input
                        type="checkbox"
                        checked={stashIncludeUntracked}
                        onChange={(e) => setStashIncludeUntracked(e.target.checked)}
                      />
                      <span>Include untracked</span>
                    </label>
                    <Button
                      size="sm"
                      variant="primary"
                      icon={Archive}
                      disabled={!perms.canLocalWrite || totalChanges === 0 || Boolean(busyAction)}
                      onClick={async () => {
                        await runAction(
                          "git stash push",
                          () =>
                            gitService.createStash(projectId, {
                              message: stashMessage.trim() || undefined,
                              includeUntracked: stashIncludeUntracked,
                            }),
                          {
                            syncWorkspace: true,
                            reason: "git_stash_push",
                            successText: "Working tree changes stashed",
                          },
                        );
                        setStashMessage("");
                        await loadStashes();
                      }}
                    >
                      Stash Changes
                    </Button>
                  </div>

                  {stashes.length === 0 ? (
                    <div className="p-8 text-center border border-dashed border-[var(--color-border)] rounded-lg bg-[var(--color-surface)] text-xs text-[var(--color-text-muted)]">
                      No stashes recorded in this repository.
                    </div>
                  ) : (
                    <div className="border border-[var(--color-border)] rounded-lg bg-[var(--color-surface)] divide-y divide-[var(--color-border)]">
                      {stashes.map((st) => (
                        <div
                          key={st.selector}
                          className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-xs"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="font-mono font-semibold text-[var(--color-primary)]">
                                {st.selector}
                              </span>
                              <span className="truncate text-[var(--color-text)] font-medium">
                                {st.message}
                              </span>
                            </div>
                            <span className="text-[11px] font-mono text-[var(--color-text-muted)]">
                              {st.hash?.slice(0, 7)} · {st.relativeDate}
                            </span>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={async () => {
                                const res = await gitService.getStashDiff(
                                  projectId,
                                  st.index,
                                );
                                setStashDiffPreview({
                                  selector: st.selector,
                                  diff: res?.data?.diff || "(Empty stash)",
                                });
                              }}
                            >
                              Inspect
                            </Button>
                            <Button
                              size="sm"
                              variant="secondary"
                              disabled={!perms.canLocalWrite}
                              onClick={() =>
                                runAction(
                                  `git stash apply ${st.selector}`,
                                  () => gitService.applyStash(projectId, st.index),
                                  { syncWorkspace: true, reason: "git_stash_apply" },
                                ).then(loadStashes)
                              }
                            >
                              Apply
                            </Button>
                            <Button
                              size="sm"
                              variant="primary"
                              disabled={!perms.canLocalWrite}
                              onClick={() =>
                                runAction(
                                  `git stash pop ${st.selector}`,
                                  () => gitService.popStash(projectId, st.index),
                                  { syncWorkspace: true, reason: "git_stash_pop" },
                                ).then(loadStashes)
                              }
                            >
                              Pop
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              icon={Trash2}
                              disabled={!perms.canLocalWrite}
                              onClick={() => setPendingDropStash(st)}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {stashDiffPreview && (
                    <div className="p-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)]">
                      <div className="flex items-center justify-between mb-2 text-xs font-mono">
                        <span>{stashDiffPreview.selector}</span>
                        <button
                          type="button"
                          onClick={() => setStashDiffPreview(null)}
                          className="text-[var(--color-text-muted)] hover:text-[var(--color-text)] cursor-pointer"
                        >
                          Close
                        </button>
                      </div>
                      <pre className="text-[11px] font-mono text-[var(--color-text-secondary)] overflow-auto max-h-64 m-0">
                        {stashDiffPreview.diff}
                      </pre>
                    </div>
                  )}
                </div>
              )}

              {/* SUB-TAB 5: TAGS */}
              {subTab === "tags" && (
                <div className="space-y-3">
                  <div className="p-3.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] flex flex-wrap items-center gap-2">
                    <input
                      type="text"
                      value={tagNameInput}
                      onChange={(e) => setTagNameInput(e.target.value)}
                      placeholder="v1.0.0"
                      disabled={!perms.canRemoteWrite}
                      className="w-36 h-8 px-2.5 rounded-md bg-[var(--color-surface-secondary)] border border-[var(--color-border)] font-mono text-xs text-[var(--color-text)] outline-none"
                    />
                    <input
                      type="text"
                      value={tagMessageInput}
                      onChange={(e) => setTagMessageInput(e.target.value)}
                      placeholder="Annotated tag message (optional)"
                      disabled={!perms.canRemoteWrite}
                      className="flex-1 min-w-[180px] h-8 px-2.5 rounded-md bg-[var(--color-surface-secondary)] border border-[var(--color-border)] text-xs text-[var(--color-text)] outline-none"
                    />
                    <label className="inline-flex items-center gap-1.5 text-xs text-[var(--color-text-secondary)]">
                      <input
                        type="checkbox"
                        checked={tagPushAfter}
                        onChange={(e) => setTagPushAfter(e.target.checked)}
                      />
                      <span>Push to origin</span>
                    </label>
                    <Button
                      size="sm"
                      variant="primary"
                      icon={Tag}
                      disabled={!perms.canRemoteWrite || !tagNameInput.trim() || Boolean(busyAction)}
                      title={!perms.canRemoteWrite ? perms.disabledReason("remote") : ""}
                      onClick={async () => {
                        const name = tagNameInput.trim();
                        await runAction(
                          `git tag ${name}`,
                          () =>
                            gitService.createTag(projectId, {
                              name,
                              message: tagMessageInput.trim() || undefined,
                              pushAfter: tagPushAfter,
                            }),
                          { successText: `Created tag '${name}'` },
                        );
                        setTagNameInput("");
                        setTagMessageInput("");
                        await loadTags();
                      }}
                    >
                      Create Tag
                    </Button>
                  </div>

                  {tags.length === 0 ? (
                    <div className="p-8 text-center border border-dashed border-[var(--color-border)] rounded-lg bg-[var(--color-surface)] text-xs text-[var(--color-text-muted)]">
                      No Git tags found in this repository.
                    </div>
                  ) : (
                    <div className="border border-[var(--color-border)] rounded-lg bg-[var(--color-surface)] divide-y divide-[var(--color-border)]">
                      {tags.map((tag) => (
                        <div
                          key={tag.name}
                          className="flex items-center justify-between gap-2 px-4 py-2.5 text-xs"
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <Tag size={13} className="text-[var(--color-primary)] shrink-0" />
                            <span className="font-mono font-semibold text-[var(--color-text)]">
                              {tag.name}
                            </span>
                            <span className="font-mono text-[11px] text-[var(--color-text-muted)]">
                              {tag.oid}
                            </span>
                            {tag.message && (
                              <span className="truncate text-[var(--color-text-secondary)]">
                                — {tag.message}
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0">
                            <Button
                              size="sm"
                              variant="secondary"
                              disabled={!perms.canRemoteWrite || !status?.repoUrl}
                              onClick={() =>
                                runAction(
                                  `git push origin ${tag.name}`,
                                  () => gitService.pushTag(projectId, tag.name),
                                  { successText: `Pushed tag '${tag.name}' to origin` },
                                )
                              }
                            >
                              Push
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              icon={Trash2}
                              disabled={!perms.canRemoteWrite}
                              onClick={() => {
                                setDeleteRemoteTag(false);
                                setPendingDeleteTag(tag.name);
                              }}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* SUB-TAB 6: PULL REQUESTS & CI CHECKS */}
              {subTab === "pulls" && (
                <GitPullRequestsPanel
                  projectId={projectId}
                  repoUrl={status?.repoUrl}
                  currentBranch={status?.branch || branchesData.current}
                  defaultBranch={status?.defaultBranch || branchesData.defaultBranch}
                  branches={branchesData.local || []}
                  canRemoteWrite={perms.canRemoteWrite}
                  disabledReason={perms.disabledReason("remote")}
                  onLog={appendLog}
                  onNotice={showNotice}
                />
              )}
            </div>
          </div>
        </>
      )}

      {/* Collapsible Git Output Console */}
      {showConsole && (
        <GitOutputConsole
          logs={logs}
          onClearLogs={() => setLogs([])}
          onRunCommand={handleRunConsoleCommand}
          running={runningConsole}
        />
      )}

      {/* Modals & Confirmation Dialogs */}
      <GitPublishModal
        isOpen={showPublishModal}
        defaultName={project?.name}
        defaultBranch={status?.defaultBranch || "main"}
        loading={busyAction.startsWith("publish")}
        onClose={() => setShowPublishModal(false)}
        onSubmit={handlePublishGithub}
      />

      {showRemoteModal && (
        <ConfirmDialog
          isOpen={showRemoteModal}
          onClose={() => setShowRemoteModal(false)}
          onConfirm={() => {
            void runAction(
              `git remote set-url ${remoteUrlInput.trim()}`,
              () => gitService.setRemoteUrl(projectId, remoteUrlInput.trim()),
              { successText: "Linked remote GitHub URL" },
            ).then(() => setShowRemoteModal(false));
          }}
          title="Link GitHub Repository Remote"
          message="Enter the HTTPS URL of your existing GitHub repository."
          confirmText="Link Origin"
          variant="primary"
          loading={busyAction.startsWith("git remote")}
        >
          <input
            type="url"
            value={remoteUrlInput}
            onChange={(e) => setRemoteUrlInput(e.target.value)}
            placeholder="https://github.com/owner/repository"
            className="w-full h-9 px-3 rounded-md bg-[var(--color-surface-secondary)] border border-[var(--color-border)] font-mono text-xs text-[var(--color-text)] outline-none"
          />
        </ConfirmDialog>
      )}

      <ConfirmDialog
        isOpen={Boolean(pendingDiscard)}
        onClose={() => setPendingDiscard(null)}
        onConfirm={executeDiscard}
        title={
          pendingDiscard?.all
            ? "Discard All Working Tree Changes?"
            : `Discard Changes in ${pendingDiscard?.path}?`
        }
        message={
          pendingDiscard?.all
            ? "All unstaged edits will be reverted and untracked files removed. This cannot be undone."
            : pendingDiscard?.isUntracked || pendingDiscard?.status === "U"
              ? "This untracked file will be permanently deleted from the workspace."
              : "Unstaged changes to this file will be overwritten with HEAD."
        }
        confirmText="Discard Changes"
        variant="danger"
        loading={busyAction.startsWith("git discard")}
      />

      <ConfirmDialog
        isOpen={confirmUndoPushed}
        onClose={() => setConfirmUndoPushed(false)}
        onConfirm={() => handleUndoCommit(true)}
        title="Commit Already Pushed to Origin"
        message="The latest commit has already been pushed. Soft-resetting it will rewrite local history and require a force-with-lease push later."
        confirmText="Undo Commit Anyway"
        variant="warning"
        loading={busyAction.startsWith("git reset")}
      />

      <ConfirmDialog
        isOpen={confirmForcePush}
        onClose={() => setConfirmForcePush(false)}
        onConfirm={async () => {
          setConfirmForcePush(false);
          await runAction(
            "git push --force-with-lease",
            () => gitService.push(projectId, { forceWithLease: true }),
            { successText: "Force-pushed branch with lease safely" },
          );
          await loadBranches();
        }}
        title={`Force Push Branch "${status?.branch || branchesData.current || ""}"?`}
        message="This will rewrite remote branch history using --force-with-lease (refusing if others pushed newer commits). Proceed?"
        confirmText="Confirm Force Push"
        variant="danger"
        loading={busyAction.startsWith("git push")}
      />

      <ConfirmDialog
        isOpen={Boolean(pendingReset)}
        onClose={() => setPendingReset(null)}
        onConfirm={async () => {
          const r = pendingReset;
          setPendingReset(null);
          await runAction(
            `git reset --${r.mode} ${r.shortHash}`,
            () => gitService.reset(projectId, { targetRef: r.hash, mode: r.mode }),
            {
              syncWorkspace: true,
              reason: "git_reset",
              successText: `Reset repository (${r.mode}) to ${r.shortHash}`,
            },
          );
          await loadHistory({ reset: true });
        }}
        title={`Reset Repository to ${pendingReset?.shortHash || ""}`}
        message="Choose reset mode before resetting HEAD to this commit."
        confirmText="Execute Reset"
        variant="danger"
      >
        {pendingReset && (
          <select
            value={pendingReset.mode}
            onChange={(e) =>
              setPendingReset((p) => (p ? { ...p, mode: e.target.value } : p))
            }
            className="w-full h-9 px-3 rounded-md bg-[var(--color-surface-secondary)] border border-[var(--color-border)] font-mono text-xs text-[var(--color-text)]"
          >
            <option value="soft">Soft (keep changes staged)</option>
            <option value="mixed">Mixed (keep changes unstaged)</option>
            <option value="hard">Hard (discard all changes after commit)</option>
          </select>
        )}
      </ConfirmDialog>

      <ConfirmDialog
        isOpen={Boolean(pendingDeleteBranch)}
        onClose={() => setPendingDeleteBranch(null)}
        onConfirm={async () => {
          const name = pendingDeleteBranch;
          setPendingDeleteBranch(null);
          await runAction(
            `delete branch ${name}`,
            () =>
              gitService.deleteBranch(projectId, name, {
                force: true,
                deleteRemote: deleteRemoteBranch,
              }),
            { successText: `Deleted branch '${name}'` },
          );
          await loadBranches();
        }}
        title={`Delete Branch "${pendingDeleteBranch || ""}"?`}
        message="Local commits exclusive to this branch may become unreachable."
        confirmText="Delete Branch"
        variant="danger"
      >
        <label className="inline-flex items-center gap-2 text-xs text-[var(--color-text-secondary)] cursor-pointer">
          <input
            type="checkbox"
            checked={deleteRemoteBranch}
            onChange={(e) => setDeleteRemoteBranch(e.target.checked)}
          />
          <span>Also delete remote branch on GitHub</span>
        </label>
      </ConfirmDialog>

      <ConfirmDialog
        isOpen={Boolean(pendingDropStash)}
        onClose={() => setPendingDropStash(null)}
        onConfirm={async () => {
          const st = pendingDropStash;
          setPendingDropStash(null);
          await runAction(`drop ${st.selector}`, () =>
            gitService.dropStash(projectId, st.index),
          );
          await loadStashes();
        }}
        title={`Drop ${pendingDropStash?.selector || "Stash"}?`}
        message="This stashed patch will be permanently removed."
        confirmText="Drop Stash"
        variant="danger"
      />

      <ConfirmDialog
        isOpen={Boolean(pendingDeleteTag)}
        onClose={() => setPendingDeleteTag(null)}
        onConfirm={async () => {
          const t = pendingDeleteTag;
          setPendingDeleteTag(null);
          await runAction(`delete tag ${t}`, () =>
            gitService.deleteTag(projectId, t, { deleteRemote: deleteRemoteTag }),
          );
          await loadTags();
        }}
        title={`Delete Tag "${pendingDeleteTag || ""}"?`}
        message="This will remove the tag from your repository."
        confirmText="Delete Tag"
        variant="danger"
      >
        <label className="inline-flex items-center gap-2 text-xs text-[var(--color-text-secondary)] cursor-pointer">
          <input
            type="checkbox"
            checked={deleteRemoteTag}
            onChange={(e) => setDeleteRemoteTag(e.target.checked)}
          />
          <span>Also delete remote tag on GitHub</span>
        </label>
      </ConfirmDialog>
    </div>
  );
}
