import { motion } from "framer-motion";
import { Check, AlertCircle, AlertTriangle, Info, X } from "lucide-react";

const TOAST_CONFIG = {
  success: {
    icon: Check,
    badgeClass: "bg-[var(--color-surface-secondary)] border-[var(--color-border-strong)] text-[var(--color-text)]",
    progressClass: "bg-[var(--color-text)]/45",
  },
  error: {
    icon: AlertCircle,
    badgeClass: "bg-rose-500/10 border-rose-500/25 text-rose-400",
    progressClass: "bg-rose-400/55",
  },
  warning: {
    icon: AlertTriangle,
    badgeClass: "bg-amber-500/10 border-amber-500/25 text-amber-300/90",
    progressClass: "bg-amber-400/45",
  },
  info: {
    icon: Info,
    badgeClass: "bg-[var(--color-surface-secondary)] border-[var(--color-border)] text-[var(--color-text-secondary)]",
    progressClass: "bg-[var(--color-text-muted)]/40",
  },
};

export default function Toast({ toast, onClose }) {
  const cfg = TOAST_CONFIG[toast.type] || TOAST_CONFIG.info;
  const Icon = cfg.icon;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: 14, y: -6, scale: 0.98 }}
      animate={{ opacity: 1, x: 0, y: 0, scale: 1 }}
      exit={{ opacity: 0, x: 14, scale: 0.97 }}
      transition={{ duration: 0.16, ease: "easeOut" }}
      role="status"
      className="pointer-events-auto relative flex items-start gap-3 px-3.5 py-3 rounded-lg bg-[var(--color-surface)] border border-[var(--color-border-strong)] ring-1 ring-white/[0.04] shadow-[0_16px_40px_-10px_rgba(0,0,0,0.85)] max-w-[380px] w-full overflow-hidden"
    >
      <div className={`w-7 h-7 rounded-md border flex items-center justify-center shrink-0 mt-0.5 ${cfg.badgeClass}`}>
        <Icon size={14} strokeWidth={2} />
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0 pt-0.5">
        {toast.title && (
          <div className="text-[13px] font-medium text-[var(--color-text)] leading-snug">
            {toast.title}
          </div>
        )}
        {toast.message && (
          <div className={`text-xs text-[var(--color-text-muted)] leading-relaxed break-words ${toast.title ? "mt-0.5" : ""}`}>
            {toast.message}
          </div>
        )}
      </div>

      {/* Close Button */}
      <button
        type="button"
        onClick={onClose}
        className="shrink-0 w-6 h-6 rounded-md flex items-center justify-center text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-secondary)] transition-colors duration-150 cursor-pointer"
        aria-label="Dismiss notification"
      >
        <X size={13} />
      </button>

      {/* Auto-dismiss Progress Bar */}
      {toast.duration > 0 && (
        <motion.div
          initial={{ scaleX: 1 }}
          animate={{ scaleX: 0 }}
          transition={{ duration: toast.duration / 1000, ease: "linear" }}
          className={`absolute bottom-0 left-0 right-0 h-[1.5px] origin-left ${cfg.progressClass}`}
        />
      )}
    </motion.div>
  );
}
