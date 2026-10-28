import { motion } from "framer-motion";
import { CheckCircle2, XCircle, AlertTriangle, Info, X } from "lucide-react";

/* ── Toast type config ─────────────────────────────────────── */
const TOAST_CONFIG = {
  success: {
    icon: CheckCircle2,
    accent: "var(--color-success)",
    bg: "var(--color-surface)",
    border: "var(--color-border)",
    iconBg: "var(--color-success-light, rgba(34, 197, 94, 0.12))",
    iconColor: "var(--color-success)",
  },
  error: {
    icon: XCircle,
    accent: "var(--color-danger)",
    bg: "var(--color-surface)",
    border: "var(--color-border)",
    iconBg: "var(--color-danger-light, rgba(239, 68, 68, 0.12))",
    iconColor: "var(--color-danger)",
  },
  warning: {
    icon: AlertTriangle,
    accent: "var(--color-warning)",
    bg: "var(--color-surface)",
    border: "var(--color-border)",
    iconBg: "var(--color-warning-light, rgba(245, 158, 11, 0.12))",
    iconColor: "var(--color-warning)",
  },
  info: {
    icon: Info,
    accent: "var(--color-primary)",
    bg: "var(--color-surface)",
    border: "var(--color-border)",
    iconBg: "var(--color-primary-light, rgba(79, 70, 229, 0.12))",
    iconColor: "var(--color-primary)",
  },
};

export default function Toast({ toast, onClose }) {
  const cfg = TOAST_CONFIG[toast.type] || TOAST_CONFIG.info;
  const Icon = cfg.icon;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: 40, scale: 0.95 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={{ opacity: 0, x: 40, scale: 0.95 }}
      transition={{ duration: 0.2, ease: "easeOut" }}
      style={{
        pointerEvents: "auto",
        display: "flex",
        alignItems: "flex-start",
        gap: 12,
        padding: "14px 16px",
        borderRadius: "var(--radius-lg, 8px)",
        background: "var(--color-surface)",
        border: "1px solid var(--color-border)",
        borderLeft: `3px solid ${cfg.accent}`,
        boxShadow: "var(--shadow-lg, 0 10px 15px -3px rgba(0,0,0,0.1))",
        maxWidth: 400,
        width: "100%",
        cursor: "default",
        overflow: "hidden",
        position: "relative",
      }}
    >
      {/* Icon */}
      <div
        style={{
          flexShrink: 0,
          width: 28,
          height: 28,
          borderRadius: "var(--radius-md, 6px)",
          background: cfg.iconBg,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          marginTop: 1,
        }}
      >
        <Icon size={16} style={{ color: cfg.iconColor }} strokeWidth={2} />
      </div>

      {/* Content */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {toast.title && (
          <div
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: "var(--color-text)",
              fontFamily: "var(--font-sans)",
              lineHeight: 1.3,
              marginBottom: 3,
            }}
          >
            {toast.title}
          </div>
        )}
        <div
          style={{
            fontSize: 12,
            color: "var(--color-text-secondary)",
            fontFamily: "var(--font-sans)",
            lineHeight: 1.45,
            wordBreak: "break-word",
          }}
        >
          {toast.message}
        </div>
      </div>

      {/* Close button */}
      <button
        type="button"
        onClick={onClose}
        style={{
          flexShrink: 0,
          background: "transparent",
          border: "none",
          borderRadius: "var(--radius-sm, 4px)",
          width: 22,
          height: 22,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--color-text-muted)",
          cursor: "pointer",
          marginTop: 1,
          transition: "background-color 0.15s, color 0.15s",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.color = "var(--color-text)";
          e.currentTarget.style.backgroundColor =
            "var(--color-surface-secondary)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.color = "var(--color-text-muted)";
          e.currentTarget.style.backgroundColor = "transparent";
        }}
        aria-label="Dismiss notification"
      >
        <X size={13} />
      </button>

      {/* Auto-dismiss progress bar */}
      {toast.duration > 0 && (
        <motion.div
          initial={{ scaleX: 1 }}
          animate={{ scaleX: 0 }}
          transition={{ duration: toast.duration / 1000, ease: "linear" }}
          style={{
            position: "absolute",
            bottom: 0,
            left: 0,
            right: 0,
            height: 2,
            background: cfg.accent,
            opacity: 0.35,
            transformOrigin: "left center",
          }}
        />
      )}
    </motion.div>
  );
}
