import React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Zap } from "lucide-react";

const MissingTestFilesModal = ({
  isOpen,
  onClose,
  projectName,
  onGenerate,
}) => {
  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 1000,
          background: "rgba(0,0,0,0.6)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          backdropFilter: "blur(4px)",
        }}
      >
        <motion.div
          initial={{ scale: 0.95, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.95, opacity: 0 }}
          onClick={(e) => e.stopPropagation()}
          style={{
            background: "var(--color-surface)",
            border: "1px solid var(--color-border)",
            borderRadius: "20px",
            padding: "32px",
            width: "480px",
            display: "flex",
            flexDirection: "column",
            gap: "20px",
            boxShadow: "var(--shadow-xl)",
          }}
        >
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: "16px",
              textAlign: "center",
            }}
          >
            <div
              style={{
                width: 64,
                height: 64,
                borderRadius: "50%",
                background: "rgba(109,93,251,0.15)",
                border: "1px solid var(--color-primary)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "var(--color-primary)",
              }}
            >
              <Zap size={32} />
            </div>
            <h2
              style={{
                margin: 0,
                fontSize: "24px",
                fontWeight: 700,
                color: "var(--color-text)",
              }}
            >
              Missing Test Files
            </h2>
          </div>

          <div
            style={{
              color: "var(--color-text-secondary)",
              fontSize: "14px",
              lineHeight: 1.6,
              textAlign: "center",
              padding: "0 16px",
            }}
          >
            <p style={{ margin: "0 0 16px 0" }}>
              Project{" "}
              <strong style={{ color: "var(--color-text)" }}>
                {projectName}
              </strong>{" "}
              has no test files (Jest).
            </p>
            <p style={{ margin: 0 }}>
              Code coverage analysis requires test files to execute successfully.
              Would you like AI to automatically generate test code for project{" "}
              <strong style={{ color: "var(--color-text)" }}>
                {projectName}
              </strong>
              ?
            </p>
          </div>

          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "12px",
              marginTop: "16px",
            }}
          >
            <button
              onClick={() => onGenerate("SKELETON")}
              style={{
                padding: "14px",
                background: "var(--color-primary)",
                border: "none",
                borderRadius: "8px",
                color: "#fff",
                cursor: "pointer",
                fontSize: "15px",
                fontWeight: 600,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "8px",
                transition: "opacity 0.2s",
              }}
              onMouseOver={(e) => (e.currentTarget.style.opacity = "0.9")}
              onMouseOut={(e) => (e.currentTarget.style.opacity = "1")}
            >
              <Zap size={18} /> Generate Skeleton Tests
            </button>
            <button
              onClick={() => onGenerate("FULL")}
              style={{
                padding: "14px",
                background: "transparent",
                border: "1px solid var(--color-border)",
                borderRadius: "8px",
                color: "var(--color-text)",
                cursor: "pointer",
                fontSize: "15px",
                fontWeight: 600,
                transition: "all 0.2s",
              }}
              onMouseOver={(e) => {
                e.currentTarget.style.background = "var(--color-bg)";
                e.currentTarget.style.borderColor = "var(--color-primary)";
              }}
              onMouseOut={(e) => {
                e.currentTarget.style.background = "transparent";
                e.currentTarget.style.borderColor = "var(--color-border)";
              }}
            >
              Generate Full Tests
            </button>
            <button
              onClick={onClose}
              style={{
                background: "transparent",
                border: "none",
                color: "var(--color-text-muted)",
                cursor: "pointer",
                fontSize: "14px",
                padding: "8px",
                textDecoration: "underline",
                marginTop: "8px",
              }}
            >
              Skip for now
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
};

export default MissingTestFilesModal;
