import { useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { CloudUpload, FileArchive, X, CheckCircle2, Loader2 } from "lucide-react";
import { createProjectApi, uploadZipApi, getProjectsApi } from "../../../services/project.service";
import { useToast } from "../ToastContext";

/* ── Drag states ─────────────────────────────────────────── */
const DRAG_STATES = {
  idle: "idle",
  over: "over",
  dropped: "dropped",
};

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
    input.accept = ".zip,.tar.gz,.rar";
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
        // Handle 409 — project already exists
        if (createErr.message?.includes("already exists") || createErr.message?.includes("Duplicate")) {
          const { projects } = await getProjectsApi();
          const existing = projects?.find((p) => p.name === projectName);
          if (existing) {
            projectId = existing.id;
            showToast({
              type: "info",
              title: "Using existing project",
              message: `Project "${projectName}" already exists. Uploading new snapshot into it.`,
            });
          } else {
            throw new Error("Project already exists but could not be found.");
          }
        } else {
          throw createErr;
        }
      }
      
      await uploadZipApi(projectId, fileObj);

      showToast({
        type: "success",
        title: "Upload successful",
        message: `Project "${projectName}" has been uploaded.`,
      });
      
      if (onSuccess) onSuccess();
      else if (onClose) onClose();
    } catch (error) {
      setErrorMsg(error.message);
      showToast({
        type: "error",
        title: "Upload failed",
        message: error.message || "An unexpected error occurred.",
      });
    } finally {
      setUploading(false);
    }
  };

  const isOver = dragState === DRAG_STATES.over;
  const isDropped = dragState === DRAG_STATES.dropped;

  return (
    <motion.div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      animate={{
        borderColor: isOver
          ? "rgba(124,58,237,0.5)"
          : isDropped
          ? "rgba(63,185,80,0.3)"
          : "rgba(255,255,255,0.1)",
        boxShadow: isOver
          ? "0 0 30px rgba(124,58,237,0.15), inset 0 0 30px rgba(124,58,237,0.05)"
          : "none",
      }}
      transition={{ duration: 0.3 }}
      className="flex flex-col items-center justify-center flex-1 rounded-2xl cursor-pointer relative overflow-hidden"
      style={{
        border: "2px dashed",
        borderColor: "rgba(255,255,255,0.1)",
        background: isOver
          ? "rgba(124,58,237,0.04)"
          : "rgba(255,255,255,0.015)",
        minHeight: 220,
        transition: "background 0.3s ease",
      }}
      onClick={!isDropped ? handleFileSelect : undefined}
      id="dropzone-area"
    >
      {/* Background grid pattern */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          backgroundImage:
            "radial-gradient(circle at 1px 1px, rgba(255,255,255,0.03) 1px, transparent 0)",
          backgroundSize: "24px 24px",
          opacity: isOver ? 0.8 : 0.4,
          transition: "opacity 0.3s ease",
        }}
      />

      <AnimatePresence mode="wait">
        {isDropped ? (
          /* ── File Dropped State ── */
          <motion.div
            key="dropped"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            transition={{ duration: 0.35, ease: "easeOut" }}
            className="flex flex-col items-center relative z-10"
            style={{ gap: 16, padding: "24px 0" }}
          >
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{
                type: "spring",
                stiffness: 260,
                damping: 20,
                delay: 0.1,
              }}
              className="flex items-center justify-center rounded-2xl"
              style={{
                width: 56,
                height: 56,
                background:
                  "linear-gradient(135deg, rgba(63,185,80,0.15), rgba(63,185,80,0.05))",
                border: "1px solid rgba(63,185,80,0.2)",
              }}
            >
              <CheckCircle2 size={26} style={{ color: "#3fb950" }} />
            </motion.div>

            <div className="flex flex-col items-center" style={{ gap: 8 }}>
              <span
                style={{
                  fontSize: 14,
                  fontWeight: 600,
                  color: "#e6edf3",
                  fontFamily: "var(--font-sans)",
                }}
              >
                File Ready
              </span>
              <div
                className="flex items-center rounded-lg"
                style={{
                  gap: 8,
                  padding: "6px 14px",
                  background: "rgba(255,255,255,0.04)",
                  border: "1px solid rgba(255,255,255,0.08)",
                }}
              >
                <FileArchive
                  size={14}
                  style={{ color: "#a78bfa", flexShrink: 0 }}
                />
                <span
                  style={{
                    fontSize: 12,
                    color: "#8b949e",
                    fontFamily: "var(--font-mono)",
                  }}
                >
                  {fileName}
                </span>
                <motion.button
                  whileHover={{ scale: 1.15 }}
                  whileTap={{ scale: 0.9 }}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleClear();
                  }}
                  className="rounded-full cursor-pointer"
                  style={{
                    padding: 3,
                    background: "rgba(255,255,255,0.06)",
                    color: "#6e7681",
                    border: "none",
                    lineHeight: 0,
                  }}
                >
                  <X size={10} />
                </motion.button>
              </div>
            </div>

            <motion.button
              whileHover={!uploading ? { scale: 1.02, y: -1 } : {}}
              whileTap={!uploading ? { scale: 0.98 } : {}}
              onClick={handleUpload}
              disabled={uploading}
              className="rounded-xl flex items-center justify-center cursor-pointer"
              style={{
                padding: "10px 28px",
                gap: 8,
                background: uploading
                  ? "rgba(124,58,237,0.5)"
                  : "linear-gradient(135deg, #7c3aed 0%, #6d28d9 100%)",
                color: "#fff",
                fontSize: 13,
                fontWeight: 600,
                border: "none",
                fontFamily: "var(--font-sans)",
                boxShadow: uploading
                  ? "none"
                  : "0 0 20px rgba(124,58,237,0.3), 0 4px 12px rgba(0,0,0,0.3)",
                opacity: uploading ? 0.7 : 1,
                cursor: uploading ? "not-allowed" : "pointer",
              }}
              id="upload-import-btn"
            >
              {uploading ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  Uploading...
                </>
              ) : (
                "Import Project"
              )}
            </motion.button>
            {errorMsg && (
              <div style={{ color: "#f85149", fontSize: 13, marginTop: 4 }}>
                {errorMsg}
              </div>
            )}
          </motion.div>
        ) : (
          /* ── Idle / Drag-over State ── */
          <motion.div
            key="idle"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.3 }}
            className="flex flex-col items-center relative z-10"
            style={{ gap: 16, padding: "24px 0" }}
          >
            <motion.div
              animate={{
                y: isOver ? -6 : 0,
                scale: isOver ? 1.08 : 1,
              }}
              transition={{ type: "spring", stiffness: 300, damping: 20 }}
              className="flex items-center justify-center rounded-2xl"
              style={{
                width: 64,
                height: 64,
                background: isOver
                  ? "linear-gradient(135deg, rgba(124,58,237,0.2), rgba(124,58,237,0.08))"
                  : "linear-gradient(135deg, rgba(255,255,255,0.05), rgba(255,255,255,0.02))",
                border: `1px solid ${
                  isOver
                    ? "rgba(124,58,237,0.3)"
                    : "rgba(255,255,255,0.08)"
                }`,
                transition: "background 0.3s, border 0.3s",
              }}
            >
              <CloudUpload
                size={28}
                strokeWidth={1.5}
                style={{
                  color: isOver ? "#a78bfa" : "#6e7681",
                  transition: "color 0.3s ease",
                }}
              />
            </motion.div>

            <div className="flex flex-col items-center" style={{ gap: 6 }}>
              <span
                style={{
                  fontSize: 15,
                  fontWeight: 600,
                  color: isOver ? "#c4b5fd" : "#e6edf3",
                  fontFamily: "var(--font-sans)",
                  transition: "color 0.2s ease",
                }}
              >
                Local Upload
              </span>
              <span
                className="text-center"
                style={{
                  fontSize: 13,
                  color: "#484f58",
                  fontFamily: "var(--font-sans)",
                  lineHeight: 1.5,
                }}
              >
                Drag & drop .zip or .rar project here
              </span>
            </div>

            <motion.button
              whileHover={{ scale: 1.03, y: -1 }}
              whileTap={{ scale: 0.97 }}
              onClick={(e) => {
                e.stopPropagation();
                handleFileSelect();
              }}
              className="flex items-center rounded-xl cursor-pointer"
              style={{
                gap: 8,
                padding: "10px 24px",
                background:
                  "linear-gradient(135deg, #7c3aed 0%, #6d28d9 100%)",
                border: "none",
                color: "#fff",
                fontSize: 13,
                fontWeight: 600,
                fontFamily: "var(--font-sans)",
                boxShadow:
                  "0 0 16px rgba(124,58,237,0.25), 0 2px 8px rgba(0,0,0,0.3)",
              }}
              id="browse-files-btn"
            >
              Browse Files
            </motion.button>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
