import { useCallback, useEffect, useRef, useState } from "react";
import { GitCompare, RefreshCw } from "lucide-react";
import Button from "../../../common/Button";
import VcsMonacoDiffEditor from "../shared/VcsMonacoDiffEditor";
import { snapshotVcsService } from "../../../../services/snapshotVcs.service";
import { getVcsStatusMeta } from "../../../../services/vcsUiHelpers";

export default function SnapshotComparePanel({
  projectId,
  checkpoints = [],
  activeSnapshotId = null,
  onOpenInEditor,
}) {
  const [baseId, setBaseId] = useState(
    () => checkpoints[1]?.id || checkpoints[0]?.id || "",
  );
  const [targetId, setTargetId] = useState("WORKING_TREE");
  const [compareData, setCompareData] = useState(null);
  const [loadingCompare, setLoadingCompare] = useState(false);
  const [selectedPath, setSelectedPath] = useState(null);
  const [diffData, setDiffData] = useState(null);
  const [loadingDiff, setLoadingDiff] = useState(false);
  const [diffError, setDiffError] = useState("");
  const diffRequestSeqRef = useRef(0);
  const diffAbortRef = useRef(null);

  useEffect(() => {
    return () => {
      diffAbortRef.current?.abort();
    };
  }, []);

  const effectiveBaseId =
    baseId && checkpoints.some((c) => c.id === baseId)
      ? baseId
      : checkpoints[1]?.id || checkpoints[0]?.id || activeSnapshotId || "";

  const runCompare = useCallback(async () => {
    if (!projectId || !effectiveBaseId) return;
    setLoadingCompare(true);
    try {
      const res = await snapshotVcsService.compareCheckpoints(projectId, {
        baseSnapshotId: effectiveBaseId,
        targetSnapshotId: targetId || "WORKING_TREE",
      });
      setCompareData(res?.data || null);
      const firstChange = res?.data?.changes?.[0];
      if (firstChange) {
        setSelectedPath(firstChange.path);
        setLoadingDiff(true);
        const pairRes = await snapshotVcsService.getDiffPair(projectId, {
          filePath: firstChange.path,
          origPath: firstChange.origPath,
          baseSnapshotId: effectiveBaseId,
          targetSnapshotId: targetId || "WORKING_TREE",
        });
        setDiffData(pairRes?.data || null);
      } else {
        setSelectedPath(null);
        setDiffData(null);
      }
    } catch (err) {
      setDiffError(err?.message || "Failed to compare checkpoints");
    } finally {
      setLoadingCompare(false);
      setLoadingDiff(false);
    }
  }, [projectId, effectiveBaseId, targetId]);

  useEffect(() => {
    if (!projectId || !effectiveBaseId) return undefined;
    diffAbortRef.current?.abort();
    const controller = new AbortController();
    diffAbortRef.current = controller;
    const reqId = ++diffRequestSeqRef.current;

    snapshotVcsService
      .compareCheckpoints(projectId, {
        baseSnapshotId: effectiveBaseId,
        targetSnapshotId: targetId || "WORKING_TREE",
        signal: controller.signal,
      })
      .then(async (res) => {
        if (reqId !== diffRequestSeqRef.current) return;
        setCompareData(res?.data || null);
        const firstChange = res?.data?.changes?.[0];
        if (firstChange) {
          setSelectedPath(firstChange.path);
          const pairRes = await snapshotVcsService.getDiffPair(projectId, {
            filePath: firstChange.path,
            origPath: firstChange.origPath,
            baseSnapshotId: effectiveBaseId,
            targetSnapshotId: targetId || "WORKING_TREE",
            signal: controller.signal,
          });
          if (reqId === diffRequestSeqRef.current) {
            setDiffData(pairRes?.data || null);
          }
        } else {
          setSelectedPath(null);
          setDiffData(null);
        }
      })
      .catch((err) => {
        if (err?.name === "AbortError" || reqId !== diffRequestSeqRef.current) return;
        setDiffError(err?.message || "Failed to compare checkpoints");
      });
    return () => {
      controller.abort();
    };
  }, [projectId, effectiveBaseId, targetId]);

  const handleSelectChange = async (change) => {
    diffAbortRef.current?.abort();
    const controller = new AbortController();
    diffAbortRef.current = controller;
    const reqId = ++diffRequestSeqRef.current;

    setSelectedPath(change.path);
    setLoadingDiff(true);
    setDiffError("");
    try {
      const res = await snapshotVcsService.getDiffPair(projectId, {
        filePath: change.path,
        origPath: change.origPath,
        baseSnapshotId: effectiveBaseId,
        targetSnapshotId: targetId || "WORKING_TREE",
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
  };

  const checkpointLabel = (cp) =>
    `${cp.versionNumber ? `#v${cp.versionNumber}` : cp.id.slice(0, 7)} · ${cp.label}`;

  return (
    <div className="h-full min-h-0 flex flex-col gap-2.5">
      {/* Selectors */}
      <div className="shrink-0 p-2.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] flex flex-wrap items-center gap-2.5 text-xs">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
            Base:
          </span>
          <select
            value={effectiveBaseId}
            onChange={(e) => setBaseId(e.target.value)}
            className="h-8 px-2.5 rounded-md bg-[var(--color-surface-secondary)] border border-[var(--color-border)] font-mono text-xs text-[var(--color-text)] max-w-[240px]"
          >
            {checkpoints.map((cp) => (
              <option key={cp.id} value={cp.id}>
                {checkpointLabel(cp)}
              </option>
            ))}
          </select>
        </div>

        <GitCompare size={14} className="text-[var(--color-primary)] shrink-0" />

        <div className="flex items-center gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
            Target:
          </span>
          <select
            value={targetId}
            onChange={(e) => setTargetId(e.target.value)}
            className="h-8 px-2.5 rounded-md bg-[var(--color-surface-secondary)] border border-[var(--color-border)] font-mono text-xs text-[var(--color-text)] max-w-[240px]"
          >
            <option value="WORKING_TREE">Working Tree (Live)</option>
            {checkpoints.map((cp) => (
              <option key={cp.id} value={cp.id}>
                {checkpointLabel(cp)}
              </option>
            ))}
          </select>
        </div>

        <Button
          size="sm"
          variant="secondary"
          icon={RefreshCw}
          loading={loadingCompare}
          onClick={runCompare}
        >
          Compare
        </Button>

        {compareData?.stats && (
          <div className="ml-auto flex items-center gap-2 font-mono text-[11px] tabular-nums">
            <span className="text-[var(--color-success)]">+{compareData.stats.added}</span>
            <span className="text-[var(--color-warning)]">~{compareData.stats.modified}</span>
            <span className="text-[var(--color-secondary)]">R{compareData.stats.renamed}</span>
            <span className="text-[var(--color-danger)]">-{compareData.stats.deleted}</span>
          </div>
        )}
      </div>

      <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-12 gap-3">
        <div className="lg:col-span-4 min-h-0 border border-[var(--color-border)] rounded-lg bg-[var(--color-surface)] p-2 max-h-[320px] lg:max-h-none overflow-y-auto custom-scrollbar space-y-1">
          {!(compareData?.changes?.length > 0) ? (
            <div className="p-6 text-center text-xs text-[var(--color-text-muted)]">
              No file differences between the selected snapshots.
            </div>
          ) : (
            compareData.changes.map((ch) => {
              const meta = getVcsStatusMeta(ch.status);
              const isSel = selectedPath === ch.path;
              return (
                <button
                  key={`${ch.status}:${ch.path}`}
                  type="button"
                  onClick={() => handleSelectChange(ch)}
                  className={`w-full flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-md text-left text-xs cursor-pointer transition-colors duration-150 ${
                    isSel
                      ? "bg-[var(--color-primary)]/12 text-[var(--color-text)] border border-[var(--color-primary)]/30"
                      : "hover:bg-[var(--color-surface-secondary)] text-[var(--color-text-secondary)] border border-transparent"
                  }`}
                >
                  <span className="font-mono text-[11.5px] truncate">
                    {ch.origPath ? `${ch.origPath} → ${ch.path}` : ch.path}
                  </span>
                  <span
                    className={`w-4 h-4 rounded text-[10px] font-mono font-bold flex items-center justify-center shrink-0 ${meta.badgeClass}`}
                  >
                    {meta.char}
                  </span>
                </button>
              );
            })
          )}
        </div>

        <div className="lg:col-span-8 min-h-[280px] h-full">
          <VcsMonacoDiffEditor
            diffData={diffData}
            loading={loadingDiff}
            error={diffError}
            emptyTitle="Select a changed file"
            emptySubtitle="Pick any file from the comparison list to view its line-by-line diff."
            onOpenInEditor={onOpenInEditor}
          />
        </div>
      </div>
    </div>
  );
}
