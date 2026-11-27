import { useEffect, useState } from "react";
import "../../../../lib/monacoSetup.js";
import Editor from "@monaco-editor/react";
import { Download, FileCode2, History, RotateCcw, Search } from "lucide-react";
import Button from "../../../common/Button";
import ConfirmDialog from "../../../common/ConfirmDialog";
import VcsInlineBanner from "../shared/VcsInlineBanner";
import { snapshotVcsService } from "../../../../services/snapshotVcs.service";
import { useTheme } from "../../../../contexts/ThemeContext";

export default function SnapshotBrowsePanel({
  projectId,
  checkpoints = [],
  initialSnapshotId = "",
  canLocalWrite = false,
  canExport = false,
  disabledReason = "",
  onFileRestored,
}) {
  const { resolvedTheme } = useTheme();
  const [selectedSnapshotId, setSelectedSnapshotId] = useState(
    () => initialSnapshotId || checkpoints[0]?.id || "",
  );
  const [files, setFiles] = useState([]);
  const [filterText, setFilterText] = useState("");
  const [loadedSnapId, setLoadedSnapId] = useState("");
  const [selectedFilePath, setSelectedFilePath] = useState("");
  const [fileData, setFileData] = useState(null);
  const [loadingFile, setLoadingFile] = useState(false);
  const [confirmRestore, setConfirmRestore] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [msg, setMsg] = useState(null);

  const effectiveSnapId =
    selectedSnapshotId && checkpoints.some((c) => c.id === selectedSnapshotId)
      ? selectedSnapshotId
      : checkpoints[0]?.id || "";
  const loadingTree = Boolean(projectId && effectiveSnapId && loadedSnapId !== effectiveSnapId);

  useEffect(() => {
    if (!projectId || !effectiveSnapId) return undefined;
    let active = true;
    snapshotVcsService
      .getCheckpointTree(projectId, effectiveSnapId)
      .then(async (res) => {
        if (!active) return;
        const list = res?.data?.files || [];
        setFiles(list);
        setLoadedSnapId(effectiveSnapId);
        if (list.length > 0) {
          const first = list[0].relativePath;
          setSelectedFilePath(first);
          const fRes = await snapshotVcsService.getCheckpointFile(
            projectId,
            effectiveSnapId,
            first,
          );
          if (active) setFileData(fRes?.data || null);
        } else {
          setSelectedFilePath("");
          setFileData(null);
        }
      })
      .catch((err) => {
        if (active) {
          setLoadedSnapId(effectiveSnapId);
          setMsg({ type: "error", text: err?.message || "Failed to load tree" });
        }
      });
    return () => {
      active = false;
    };
  }, [projectId, effectiveSnapId]);

  const handleOpenFile = async (relPath) => {
    setSelectedFilePath(relPath);
    setLoadingFile(true);
    try {
      const res = await snapshotVcsService.getCheckpointFile(
        projectId,
        effectiveSnapId,
        relPath,
      );
      setFileData(res?.data || null);
    } catch (err) {
      setMsg({ type: "error", text: err?.message || "Failed to read file" });
    } finally {
      setLoadingFile(false);
    }
  };

  const handleRestoreSingleFile = async () => {
    if (!selectedFilePath || !effectiveSnapId) return;
    setRestoring(true);
    try {
      await snapshotVcsService.restoreSingleFile(
        projectId,
        effectiveSnapId,
        selectedFilePath,
      );
      setConfirmRestore(false);
      setMsg({
        type: "success",
        text: `Restored '${selectedFilePath}' into live working tree!`,
      });
      await onFileRestored?.(selectedFilePath);
    } catch (err) {
      setMsg({ type: "error", text: err?.message || "Restore failed" });
    } finally {
      setRestoring(false);
    }
  };

  const filteredFiles = filterText.trim()
    ? files.filter((f) =>
        f.relativePath.toLowerCase().includes(filterText.trim().toLowerCase()),
      )
    : files;

  return (
    <div className="h-full min-h-0 flex flex-col gap-2.5">
      <div className="shrink-0 p-2.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] flex flex-wrap items-center justify-between gap-2.5 text-xs">
        <div className="flex items-center gap-2">
          <History size={14} className="text-[var(--color-primary)]" />
          <span className="font-semibold uppercase text-[11px] tracking-wider text-[var(--color-text-muted)]">
            Inspect Snapshot:
          </span>
          <select
            value={effectiveSnapId}
            onChange={(e) => setSelectedSnapshotId(e.target.value)}
            className="h-8 px-2.5 rounded-md bg-[var(--color-surface-secondary)] border border-[var(--color-border)] font-mono text-xs text-[var(--color-text)] max-w-[280px]"
          >
            {checkpoints.map((cp) => (
              <option key={cp.id} value={cp.id}>
                {cp.versionNumber ? `#v${cp.versionNumber}` : cp.id.slice(0, 7)} · {cp.label}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="secondary"
            icon={Download}
            disabled={!canExport || !effectiveSnapId}
            onClick={() =>
              snapshotVcsService.exportCheckpointZip(projectId, effectiveSnapId)
            }
          >
            Export ZIP
          </Button>
          <Button
            size="sm"
            variant="primary"
            icon={RotateCcw}
            disabled={!canLocalWrite || !selectedFilePath}
            title={!canLocalWrite ? disabledReason : "Restore selected file into working tree"}
            onClick={() => setConfirmRestore(true)}
          >
            Restore This File
          </Button>
        </div>
      </div>

      {msg && (
        <VcsInlineBanner
          tone={msg.type === "error" ? "danger" : "success"}
          title={msg.text}
          onDismiss={() => setMsg(null)}
        />
      )}

      <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-12 gap-3">
        <div className="lg:col-span-4 min-h-0 border border-[var(--color-border)] rounded-lg bg-[var(--color-surface)] flex flex-col max-h-[320px] lg:max-h-none">
          <div className="p-2 border-b border-[var(--color-border)] shrink-0">
            <div className="flex items-center gap-1.5 h-8 px-2 rounded bg-[var(--color-surface-secondary)] border border-[var(--color-border)]">
              <Search size={12} className="text-[var(--color-text-muted)]" />
              <input
                type="text"
                value={filterText}
                onChange={(e) => setFilterText(e.target.value)}
                placeholder={`Filter ${files.length} files...`}
                className="w-full bg-transparent outline-none text-xs text-[var(--color-text)]"
              />
            </div>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto p-1.5 space-y-0.5 custom-scrollbar">
            {loadingTree ? (
              <div className="p-4 text-xs text-[var(--color-text-muted)]">
                Loading historical files...
              </div>
            ) : (
              filteredFiles.map((f) => (
                <button
                  key={f.relativePath}
                  type="button"
                  onClick={() => handleOpenFile(f.relativePath)}
                  className={`w-full flex items-center justify-between gap-2 px-2.5 py-1.5 rounded text-left text-xs cursor-pointer transition-colors duration-150 ${
                    selectedFilePath === f.relativePath
                      ? "bg-[var(--color-primary)]/12 text-[var(--color-text)] border border-[var(--color-primary)]/30"
                      : "hover:bg-[var(--color-surface-secondary)] text-[var(--color-text-secondary)] border border-transparent"
                  }`}
                >
                  <span className="flex items-center gap-1.5 min-w-0">
                    <FileCode2 size={12} className="shrink-0 text-[var(--color-text-muted)]" />
                    <span className="font-mono text-[11px] truncate">
                      {f.relativePath}
                    </span>
                  </span>
                  <span className="text-[10px] font-mono tabular-nums text-[var(--color-text-muted)] shrink-0">
                    {(f.byteSize / 1024).toFixed(1)}K
                  </span>
                </button>
              ))
            )}
          </div>
        </div>

        <div className="lg:col-span-8 border border-[var(--color-border)] rounded-lg bg-[var(--color-bg)] min-h-[280px] h-full flex flex-col overflow-hidden">
          <div className="px-3.5 py-2 border-b border-[var(--color-border)] bg-[var(--color-surface)] flex items-center justify-between text-xs font-mono">
            <span className="truncate text-[var(--color-text)]">
              {selectedFilePath || "Select a historical file"}
            </span>
            {fileData?.sha256 && (
              <span className="text-[10.5px] text-[var(--color-text-muted)]">
                sha256:{fileData.sha256.slice(0, 10)}
              </span>
            )}
          </div>
          <div className="flex-1 min-h-0">
            {loadingFile ? (
              <div className="p-6 text-xs text-[var(--color-text-muted)]">
                Decompressing object from CAS...
              </div>
            ) : fileData?.isBinary ? (
              <div className="p-8 text-center text-xs text-[var(--color-text-muted)]">
                Binary file ({fileData.byteSize} bytes)
              </div>
            ) : fileData?.isTooLarge ? (
              <div className="p-8 text-center text-xs text-[var(--color-text-muted)]">
                File exceeds 1 MiB preview limit
              </div>
            ) : (
              <Editor
                height="100%"
                theme={resolvedTheme === "light" ? "vs" : "vs-dark"}
                value={fileData?.content ?? ""}
                options={{
                  readOnly: true,
                  minimap: { enabled: false },
                  fontSize: 12.5,
                  fontFamily: "var(--font-mono), monospace",
                }}
              />
            )}
          </div>
        </div>
      </div>

      <ConfirmDialog
        isOpen={confirmRestore}
        onClose={() => setConfirmRestore(false)}
        onConfirm={handleRestoreSingleFile}
        title={`Restore "${selectedFilePath}"?`}
        message="This will overwrite the single file in your live working tree with the immutable version from this historical checkpoint. Other workspace files remain untouched."
        confirmText="Restore File"
        variant="warning"
        loading={restoring}
      />
    </div>
  );
}
