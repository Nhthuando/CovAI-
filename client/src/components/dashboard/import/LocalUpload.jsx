import { useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  CloudUpload,
  FileArchive,
  X,
  CheckCircle2,
  Loader2,
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
            throw new Error("Project already exists but could not be found.");
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
      <motion.div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        animate={{
          borderColor: isOver
            ? "rgba(168,85,247,0.7)"
            : isDropped
              ? "rgba(34,197,94,0.4)"
              : "rgba(255,255,255,0.1)",
          backgroundColor: isOver
            ? "rgba(124,58,237,0.06)"
            : isDropped
              ? "rgba(16,185,129,0.03)"
              : "rgba(255,255,255,0.02)",
        }}
        transition={{ duration: 0.2 }}
        className={`relative flex flex-col items-center justify-center flex-1 rounded-2xl border-2 border-dashed p-6 transition-all min-h-[300px] overflow-hidden ${
          !isDropped ? "cursor-pointer hover:border-violet-500/40" : ""
        }`}
        onClick={!isDropped ? handleFileSelect : undefined}
        id="dropzone-area"
      >
        {/* Background ambient pattern */}
        <div
          className="absolute inset-0 pointer-events-none opacity-40"
          style={{
            backgroundImage:
              "radial-gradient(circle at 1px 1px, rgba(255,255,255,0.06) 1px, transparent 0)",
            backgroundSize: "20px 20px",
          }}
        />

        <AnimatePresence mode="wait">
          {isDropped ? (
            /* ── File Dropped State ── */
            <motion.div
              key="dropped"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ duration: 0.25 }}
              className="flex flex-col items-center w-full max-w-sm relative z-10 gap-5"
            >
              {/* Status icon */}
              <div className="relative">
                <div
                  className="w-16 h-16 rounded-2xl flex items-center justify-center border shadow-xl"
                  style={{
                    background: isRar
                      ? "linear-gradient(135deg, rgba(245,158,11,0.15), rgba(245,158,11,0.05))"
                      : "linear-gradient(135deg, rgba(124,58,237,0.15), rgba(124,58,237,0.05))",
                    borderColor: isRar
                      ? "rgba(245,158,11,0.3)"
                      : "rgba(124,58,237,0.3)",
                  }}
                >
                  <FolderArchive
                    size={30}
                    className={isRar ? "text-amber-400" : "text-violet-400"}
                  />
                </div>
                <div className="absolute -bottom-1.5 -right-1.5 w-6 h-6 rounded-full bg-emerald-500 text-black flex items-center justify-center shadow-lg ring-2 ring-[#111827]">
                  <CheckCircle2 size={14} strokeWidth={3} />
                </div>
              </div>

              {/* File details card */}
              <div className="w-full rounded-xl bg-white/[0.04] border border-white/10 p-3.5 flex flex-col gap-2.5">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <FileArchive
                      size={18}
                      className={
                        isRar
                          ? "text-amber-400 flex-shrink-0"
                          : "text-violet-400 flex-shrink-0"
                      }
                    />
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-white truncate font-mono">
                        {fileName}
                      </p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-[11px] text-neutral-400 font-mono">
                          {formatBytes(fileObj?.size)}
                        </span>
                        <span className="text-neutral-600">•</span>
                        <span
                          className={`text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border ${
                            isRar
                              ? "bg-amber-500/10 text-amber-300 border-amber-500/30"
                              : "bg-violet-500/10 text-violet-300 border-violet-500/30"
                          }`}
                        >
                          {isRar ? "RAR Archive" : "ZIP Archive"}
                        </span>
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
                    className="p-1 rounded-lg hover:bg-white/10 text-neutral-400 hover:text-white transition-colors"
                  >
                    <X size={14} />
                  </button>
                </div>
              </div>

              {/* Import button */}
              <motion.button
                whileHover={!uploading ? { scale: 1.02 } : {}}
                whileTap={!uploading ? { scale: 0.98 } : {}}
                onClick={handleUpload}
                disabled={uploading}
                className="w-full h-11 rounded-xl flex items-center justify-center gap-2 font-semibold text-xs tracking-wide uppercase text-white shadow-xl transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                style={{
                  background:
                    "linear-gradient(135deg, #7c3aed 0%, #6d28d9 50%, #4f46e5 100%)",
                  boxShadow: "0 4px 20px rgba(124,58,237,0.35)",
                }}
                id="upload-import-btn"
              >
                {uploading ? (
                  <>
                    <Loader2 size={16} className="animate-spin text-white" />
                    <span>Extracting & Ingesting...</span>
                  </>
                ) : (
                  <>
                    <span>Import Project</span>
                    <ArrowUpRight size={15} />
                  </>
                )}
              </motion.button>

              {/* Error message card */}
              {errorMsg && (
                <motion.div
                  initial={{ opacity: 0, y: 5 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="w-full rounded-xl bg-red-500/10 border border-red-500/25 p-3 flex items-start gap-2.5 text-red-300 text-xs"
                >
                  <AlertCircle
                    size={16}
                    className="text-red-400 flex-shrink-0 mt-0.5"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-red-200">Import Failed</p>
                    <p className="mt-0.5 text-[11px] leading-relaxed opacity-90">
                      {errorMsg}
                    </p>
                  </div>
                </motion.div>
              )}
            </motion.div>
          ) : (
            /* ── Idle / Drag-over State ── */
            <motion.div
              key="idle"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.25 }}
              className="flex flex-col items-center text-center relative z-10 gap-4 max-w-xs"
            >
              {/* Icon */}
              <motion.div
                animate={{
                  y: isOver ? -4 : 0,
                  scale: isOver ? 1.08 : 1,
                }}
                className="w-16 h-16 rounded-2xl flex items-center justify-center transition-all shadow-lg"
                style={{
                  background: isOver
                    ? "linear-gradient(135deg, rgba(124,58,237,0.25), rgba(79,70,229,0.15))"
                    : "rgba(255,255,255,0.03)",
                  border: isOver
                    ? "1px solid rgba(168,85,247,0.4)"
                    : "1px solid rgba(255,255,255,0.08)",
                }}
              >
                <CloudUpload
                  size={28}
                  strokeWidth={1.75}
                  className={isOver ? "text-violet-300" : "text-neutral-400"}
                />
              </motion.div>

              {/* Title & Description */}
              <div>
                <h3 className="text-sm font-semibold text-white tracking-tight">
                  Upload Project Archive
                </h3>
                <p className="text-xs text-neutral-400 mt-1 leading-relaxed">
                  Drag & drop your codebase archive here to parse & generate
                  test suites
                </p>
              </div>

              {/* Supported formats */}
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-bold font-mono px-2 py-0.5 rounded-md bg-cyan-500/10 text-cyan-300 border border-cyan-500/20">
                  .ZIP
                </span>
                <span className="text-[10px] font-bold font-mono px-2 py-0.5 rounded-md bg-amber-500/10 text-amber-300 border border-amber-500/20">
                  .RAR
                </span>
                <span className="text-[11px] text-neutral-500">Max 200MB</span>
              </div>

              {/* Browse Button */}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  handleFileSelect();
                }}
                className="mt-1 px-4 py-2 rounded-xl text-xs font-semibold text-white bg-white/[0.08] hover:bg-white/[0.14] border border-white/10 hover:border-violet-500/30 transition-all flex items-center gap-2 cursor-pointer shadow-sm"
                id="browse-files-btn"
              >
                <HardDrive size={13} className="text-violet-400" />
                Browse Local Files
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}
