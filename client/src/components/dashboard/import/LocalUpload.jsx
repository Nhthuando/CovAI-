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
  Loader2,
} from "lucide-react";
import {
  createProjectApi,
  uploadZipApi,
  getProjectsApi,
  deleteProjectApi,
  validateArchiveApi,
} from "../../../services/project.service";
import { useToast } from "../ToastContext";

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
  const [validating, setValidating] = useState(false);
  const [validationInfo, setValidationInfo] = useState(null);
  const [errorMsg, setErrorMsg] = useState("");
  const { showToast } = useToast();

  const checkArchive = useCallback(
    async (file) => {
      setValidating(true);
      setErrorMsg("");
      setValidationInfo(null);
      try {
        const res = await validateArchiveApi(file);
        setValidationInfo({
          isSupported: true,
          language: res.primaryLanguage,
          reason: res.reason,
        });
      } catch (err) {
        const msg =
          err.message || "Invalid archive file or unsupported project language.";
        setValidationInfo({
          isSupported: false,
          reason: msg,
        });
        setErrorMsg(msg);
        showToast({
          type: "error",
          title: "Unsupported archive",
          message: msg,
        });
      } finally {
        setValidating(false);
      }
    },
    [showToast],
  );

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

  const handleDrop = useCallback(
    (e) => {
      e.preventDefault();
      e.stopPropagation();
      const file = e.dataTransfer.files?.[0];
      if (file) {
        setFileObj(file);
        setFileName(file.name);
        setDragState(DRAG_STATES.dropped);
        setErrorMsg("");
        checkArchive(file);
      }
    },
    [checkArchive],
  );

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
        checkArchive(file);
      }
    };
    input.click();
  }, [checkArchive]);

  const handleClear = useCallback(() => {
    setFileObj(null);
    setFileName(null);
    setDragState(DRAG_STATES.idle);
    setErrorMsg("");
    setValidationInfo(null);
    setValidating(false);
  }, []);

  const handleUpload = async () => {
    if (
      !fileObj ||
      validating ||
      (validationInfo && !validationInfo.isSupported)
    )
      return;
    setUploading(true);
    setErrorMsg("");
    let projectId = null;
    let createdNewProject = false;

    try {
      const projectName = fileName.replace(/\.[^/.]+$/, "");

      try {
        const projRes = await createProjectApi({ name: projectName });
        projectId = projRes.data.id;
        createdNewProject = true;
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
        message: `"${projectName}" is being indexed. Track progress in Job Queue.`,
      });

      if (onSuccess) onSuccess();
      else if (onClose) onClose();
    } catch (error) {
      if (createdNewProject && projectId) {
        deleteProjectApi(projectId).catch(() => {});
      }
      const msg =
        error.message === "Failed to fetch"
          ? "Network error or server unreachable. Verify the backend service is active."
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
  const isUnsupported = validationInfo && !validationInfo.isSupported;

  return (
    <div className="flex flex-col flex-1">
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`relative flex flex-col items-center justify-center flex-1 rounded-[10px] border border-dashed p-5 transition-colors duration-150 min-h-[290px] ${
          isOver
            ? "border-[var(--ps-cobalt)] bg-[var(--ps-surface)]"
            : isDropped
              ? isUnsupported
                ? "border-[var(--ps-rose)] bg-[var(--ps-surface)]"
                : "border-[var(--ps-emerald)] bg-[var(--ps-surface)]"
              : "border-[var(--ps-line-strong)] bg-[var(--ps-surface)]/75 hover:bg-[var(--ps-surface)] hover:border-[var(--ps-ink-muted)] cursor-pointer"
        }`}
        onClick={!isDropped ? handleFileSelect : undefined}
        id="dropzone-area"
      >
        {isDropped ? (
          <div className="flex flex-col items-center w-full max-w-xs gap-3.5">
            {/* Status Glyph */}
            <div className="relative">
              <div
                className="w-12 h-12 rounded-lg flex items-center justify-center border bg-[var(--ps-surface-2)]"
                style={{
                  borderColor: isUnsupported
                    ? "var(--ps-rose)"
                    : validating
                      ? "var(--ps-line-strong)"
                      : "var(--ps-emerald)",
                }}
              >
                <FolderArchive
                  size={22}
                  style={{
                    color: isUnsupported
                      ? "var(--ps-rose)"
                      : isRar
                        ? "var(--ps-amber)"
                        : "var(--ps-cobalt)",
                  }}
                />
              </div>
              <div
                className="absolute -bottom-1.5 -right-1.5 w-5 h-5 rounded-full flex items-center justify-center border border-[var(--ps-surface)]"
                style={{
                  backgroundColor: validating
                    ? "var(--ps-cobalt)"
                    : isUnsupported
                      ? "var(--ps-rose)"
                      : "var(--ps-emerald)",
                  color: "#ffffff",
                }}
              >
                {validating ? (
                  <Loader2 size={11} className="animate-spin" strokeWidth={2.5} />
                ) : isUnsupported ? (
                  <AlertCircle size={11} strokeWidth={2.5} />
                ) : (
                  <CheckCircle2 size={11} strokeWidth={2.5} />
                )}
              </div>
            </div>

            {/* File Metadata Card */}
            <div className="w-full rounded-lg bg-[var(--ps-inset)] border border-[var(--ps-line)] p-3 flex flex-col gap-2">
              <div className="flex items-start justify-between gap-2.5">
                <div className="flex items-center gap-2.5 min-w-0">
                  <FileArchive
                    size={15}
                    style={{ color: "var(--ps-cobalt)" }}
                    className="shrink-0"
                  />
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-[var(--ps-ink)] truncate ps-mono">
                      {fileName}
                    </p>
                    <div className="flex items-center gap-2 mt-0.5 text-[11px] text-[var(--ps-ink-muted)] ps-mono">
                      <span>{formatBytes(fileObj?.size)}</span>
                      <span>·</span>
                      <span>{isRar ? "RAR" : "ZIP"}</span>
                    </div>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleClear();
                  }}
                  title="Remove file"
                  aria-label="Remove file"
                  className="p-1 rounded hover:bg-[var(--ps-surface-2)] text-[var(--ps-ink-muted)] hover:text-[var(--ps-ink)] transition-colors cursor-pointer"
                >
                  <X size={13} />
                </button>
              </div>

              {validating && (
                <div className="flex items-center gap-2 pt-2 border-t border-[var(--ps-line)] text-[11px] text-[var(--ps-ink-secondary)]">
                  <Loader2
                    size={12}
                    className="animate-spin shrink-0"
                    style={{ color: "var(--ps-cobalt)" }}
                  />
                  <span>Inspecting project structure...</span>
                </div>
              )}

              {validationInfo?.isSupported && (
                <div className="flex items-center justify-between pt-2 border-t border-[var(--ps-line)] text-[11px]">
                  <span className="text-[var(--ps-ink-muted)]">Detected runtime</span>
                  <span
                    className="px-2 py-0.5 rounded text-[10.5px] font-medium ps-mono border"
                    style={{
                      backgroundColor: "color-mix(in srgb, var(--ps-emerald) 10%, transparent)",
                      borderColor: "color-mix(in srgb, var(--ps-emerald) 25%, transparent)",
                      color: "var(--ps-emerald)",
                    }}
                  >
                    {validationInfo.language}
                  </span>
                </div>
              )}

              {isUnsupported && (
                <div className="flex items-center justify-between pt-2 border-t border-[var(--ps-line)] text-[11px]">
                  <span className="text-[var(--ps-ink-muted)]">Detected runtime</span>
                  <span
                    className="px-2 py-0.5 rounded text-[10.5px] font-medium ps-mono border"
                    style={{
                      backgroundColor: "color-mix(in srgb, var(--ps-rose) 10%, transparent)",
                      borderColor: "color-mix(in srgb, var(--ps-rose) 25%, transparent)",
                      color: "var(--ps-rose)",
                    }}
                  >
                    Unsupported
                  </span>
                </div>
              )}
            </div>

            {(errorMsg || isUnsupported) && (
              <div
                className="w-full rounded-lg p-2.5 flex items-start gap-2 text-xs border"
                style={{
                  backgroundColor: "color-mix(in srgb, var(--ps-rose) 8%, transparent)",
                  borderColor: "color-mix(in srgb, var(--ps-rose) 25%, transparent)",
                  color: "var(--ps-rose)",
                }}
              >
                <AlertCircle size={14} className="shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0 text-[11px] leading-relaxed">
                  {errorMsg || validationInfo?.reason}
                </div>
              </div>
            )}

            <button
              type="button"
              onClick={handleUpload}
              disabled={uploading || validating || isUnsupported}
              id="upload-import-btn"
              className="w-full h-9 px-4 rounded-lg inline-flex items-center justify-center gap-1.5 text-xs font-semibold ps-btn-contrast cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed"
            >
              {uploading ? (
                <>
                  <Loader2 size={13} className="animate-spin" />
                  <span>Extracting &amp; ingesting...</span>
                </>
              ) : validating ? (
                <span>Checking language...</span>
              ) : isUnsupported ? (
                <span>Unsupported archive</span>
              ) : (
                <>
                  <ArrowUpRight size={14} />
                  <span>Import archive</span>
                </>
              )}
            </button>
          </div>
        ) : (
          <div className="flex flex-col items-center text-center gap-3 max-w-[230px]">
            <div className="w-11 h-11 rounded-lg flex items-center justify-center bg-[var(--ps-surface-2)] border border-[var(--ps-line)] text-[var(--ps-ink)]">
              <CloudUpload size={20} strokeWidth={1.75} />
            </div>

            <div>
              <p className="text-xs font-semibold text-[var(--ps-ink)]">
                Drop codebase archive
              </p>
              <p className="text-[11px] text-[var(--ps-ink-muted)] mt-1 leading-relaxed">
                Supports <span className="ps-mono">.zip</span>, <span className="ps-mono">.rar</span>, <span className="ps-mono">.tar.gz</span> up to <span className="ps-mono">200 MB</span>
              </p>
            </div>

            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                handleFileSelect();
              }}
              id="browse-files-btn"
              className="mt-1 h-8 px-3 rounded-md border border-[var(--ps-line-strong)] bg-[var(--ps-surface-2)] hover:bg-[var(--ps-line)]/60 text-xs font-medium text-[var(--ps-ink)] inline-flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              <HardDrive size={13} className="text-[var(--ps-ink-secondary)]" />
              <span>Choose local file</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
