import { useState, useCallback } from "react";
import {
  CloudUpload,
  FileArchive,
  X,
  CheckCircle2,
  AlertCircle,
  FolderArchive,
  ArrowUpRight,
  HardDrive,
} from "lucide-react";
import {
  createProjectApi,
  uploadZipApi,
  getProjectsApi,
} from "../../../services/project.service";
import { useToast } from "../ToastContext";
import Button from "../../common/Button";
import Badge from "../../common/Badge";

/* ── Drag states ─────────────────────────────────────────── */
const DRAG_STATES = {
  idle: "idle",
  over: "over",
  dropped: "dropped",
};

function formatBytes(bytes, decimals = 1) {
  if (!bytes || bytes === 0) return "0 B";
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + " " + sizes[i];
}

export default function LocalUpload({ onClose, onSuccess }) {
  const [dragState, setDragState] = useState(DRAG_STATES.idle);
  const [fileName, setFileName] = useState(null);
  const [fileObj, setFileObj] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const { showToast } = useToast();

  const handleDragOver = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragState(DRAG_STATES.over);
  }, []);

  const handleDragLeave = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragState(DRAG_STATES.idle);
  }, []);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    const file = e.dataTransfer.files?.[0];
    if (file) {
      setFileObj(file);
      setFileName(file.name);
      setDragState(DRAG_STATES.dropped);
      setErrorMsg("");
    }
  }, []);

  const handleFileSelect = useCallback(() => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".zip,.rar,.tar.gz";
    input.onchange = (e) => {
      const file = e.target.files?.[0];
      if (file) {
        setFileObj(file);
        setFileName(file.name);
        setDragState(DRAG_STATES.dropped);
        setErrorMsg("");
      }
    };
    input.click();
  }, []);

  const handleClear = useCallback(() => {
    setFileObj(null);
    setFileName(null);
    setDragState(DRAG_STATES.idle);
    setErrorMsg("");
  }, []);

  const handleUpload = async () => {
    if (!fileObj) return;
    setUploading(true);
    setErrorMsg("");
    try {
      const projectName = fileName.replace(/\.[^/.]+$/, "");
      let projectId;

      try {
        const projRes = await createProjectApi({ name: projectName });
        projectId = projRes.data.id;
      } catch (createErr) {
        if (
          createErr.message?.includes("already exists") ||
          createErr.message?.includes("Duplicate")
        ) {
          const { projects } = await getProjectsApi();
          const existing = projects?.find((p) => p.name === projectName);
          if (existing) {
            projectId = existing.id;
          } else {
            throw new Error("Project already exists but could not be found.", {
              cause: createErr,
            });
          }
        } else {
          throw createErr;
        }
      }

      await uploadZipApi(projectId, fileObj);

      showToast({
        type: "info",
        title: "Processing started",
        message: `"${projectName}" is being processed. Track progress in Job Queue.`,
      });

      if (onSuccess) onSuccess();
      else if (onClose) onClose();
    } catch (error) {
      const msg =
        error.message === "Failed to fetch"
          ? "Network error or server unreachable. Please verify the backend service is active."
          : error.message || "An unexpected error occurred during upload.";
      setErrorMsg(msg);
      showToast({
        type: "error",
        title: "Upload failed",
        message: msg,
      });
    } finally {
      setUploading(false);
    }
  };

  const isOver = dragState === DRAG_STATES.over;
  const isDropped = dragState === DRAG_STATES.dropped;
  const isRar = fileName?.toLowerCase().endsWith(".rar");

  return (
    <div className="flex flex-col flex-1">
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`relative flex flex-col items-center justify-center flex-1 rounded-[var(--radius-lg)] border-2 border-dashed p-6 transition-colors min-h-[300px] ${
          isOver
            ? "border-[var(--color-primary)] bg-[var(--color-primary-light)]"
            : isDropped
              ? "border-[var(--color-success)] bg-[var(--color-success-light)]"
              : "border-[var(--color-border)] bg-[var(--color-bg)] hover:border-[var(--color-border-subtle)] cursor-pointer"
        }`}
        onClick={!isDropped ? handleFileSelect : undefined}
        id="dropzone-area"
      >
        {isDropped ? (
          /* ── File Dropped State ── */
          <div className="flex flex-col items-center w-full max-w-sm relative z-10 gap-4">
            {/* Status icon */}
            <div className="relative">
              <div className="w-14 h-14 rounded-[var(--radius-lg)] flex items-center justify-center border border-[var(--color-border)] bg-[var(--color-surface)]">
                <FolderArchive
                  size={26}
                  className={
                    isRar ? "text-amber-500" : "text-[var(--color-primary)]"
                  }
                />
              </div>
              <div className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-[var(--color-success)] text-white flex items-center justify-center shadow-xs">
                <CheckCircle2 size={12} strokeWidth={3} />
              </div>
            </div>

            {/* File details card */}
            <div className="w-full rounded-[var(--radius-md)] bg-[var(--color-surface)] border border-[var(--color-border)] p-3 flex flex-col gap-2">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2.5 min-w-0">
                  <FileArchive
                    size={16}
                    className="text-[var(--color-primary)] shrink-0"
                  />
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-[var(--color-text)] truncate font-mono">
                      {fileName}
                    </p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-[11px] text-[var(--color-text-muted)] font-mono">
                        {formatBytes(fileObj?.size)}
                      </span>
                      <span className="text-[var(--color-border)]">•</span>
                      <Badge variant={isRar ? "warning" : "primary"} size="sm">
                        {isRar ? "RAR Archive" : "ZIP Archive"}
                      </Badge>
                    </div>
                  </div>
                </div>

                {/* Remove button */}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleClear();
                  }}
                  title="Remove file"
                  aria-label="Remove file"
                  className="p-1 rounded-[var(--radius-sm)] hover:bg-[var(--color-surface-secondary)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors cursor-pointer"
                >
                  <X size={14} />
                </button>
              </div>
            </div>

            {/* Import button */}
            <Button
              type="button"
              variant="primary"
              size="md"
              onClick={handleUpload}
              disabled={uploading}
              loading={uploading}
              icon={ArrowUpRight}
              className="w-full"
              id="upload-import-btn"
            >
              {uploading ? "Extracting & Ingesting..." : "Import Project"}
            </Button>

            {/* Error message card */}
            {errorMsg && (
              <div className="w-full rounded-[var(--radius-md)] bg-[var(--color-danger)]/10 border border-[var(--color-danger)]/25 p-3 flex items-start gap-2.5 text-[var(--color-danger)] text-xs">
                <AlertCircle size={15} className="shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <p className="font-semibold">Import Failed</p>
                  <p className="mt-0.5 text-[11px] leading-relaxed opacity-90">
                    {errorMsg}
                  </p>
                </div>
              </div>
            )}
          </div>
        ) : (
          /* ── Idle / Drag-over State ── */
          <div className="flex flex-col items-center text-center relative z-10 gap-3 max-w-xs">
            {/* Icon */}
            <div className="w-12 h-12 rounded-[var(--radius-lg)] flex items-center justify-center bg-[var(--color-surface-secondary)] border border-[var(--color-border)] text-[var(--color-primary)]">
              <CloudUpload size={24} strokeWidth={2} />
            </div>

            {/* Title & Description */}
            <div>
              <h3 className="text-sm font-semibold text-[var(--color-text)] tracking-tight">
                Upload Project Archive
              </h3>
              <p className="text-xs text-[var(--color-text-secondary)] mt-1 leading-relaxed">
                Drag and drop your codebase archive here to parse and synthesize
                tests
              </p>
            </div>

            {/* Supported formats */}
            <div className="flex items-center gap-2">
              <Badge variant="neutral" size="sm">
                .ZIP
              </Badge>
              <Badge variant="neutral" size="sm">
                .RAR
              </Badge>
              <span className="text-[11px] text-[var(--color-text-muted)] font-mono">
                Max 200MB
              </span>
            </div>

            {/* Browse Button */}
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                handleFileSelect();
              }}
              icon={HardDrive}
              className="mt-1"
              id="browse-files-btn"
            >
              Browse Local Files
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
