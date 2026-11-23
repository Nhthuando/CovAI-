import { motion } from "framer-motion";
import { Check, AlertCircle, AlertTriangle, Info, X } from "lucide-react";

const TOAST_CONFIG = {
  success: {
    icon: Check,
    iconColor: "text-[var(--color-text)]",
  },
  error: {
    icon: AlertCircle,
    iconColor: "text-rose-400/85",
  },
  warning: {
    icon: AlertTriangle,
    iconColor: "text-[var(--color-text-secondary)]",
  },
  info: {
    icon: Info,
    iconColor: "text-[var(--color-text-muted)]",
  },
};

export default function Toast({ toast, onClose }) {
  const cfg = TOAST_CONFIG[toast.type] || TOAST_CONFIG.info;
  const Icon = cfg.icon;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 10 }}
      transition={{ duration: 0.14, ease: "easeOut" }}
      role="status"
      className="pointer-events-auto relative flex items-start gap-2.5 px-3.5 py-3 rounded-lg bg-[var(--color-surface)] border border-[var(--color-border)] shadow-xl max-w-[380px] w-full overflow-hidden"
    >
      <div className="pt-0.5 shrink-0">
        <Icon size={15} className={cfg.iconColor} strokeWidth={1.8} />
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        {toast.title && (
          <div className="text-xs font-medium text-[var(--color-text)] leading-snug mb-0.5">
            {toast.title}
          </div>
        )}
        <div className="text-xs text-[var(--color-text-muted)] leading-relaxed break-words">
          {toast.message}
        </div>
      </div>

      {/* Close Button */}
      <button
        type="button"
        onClick={onClose}
        className="shrink-0 w-6 h-6 rounded flex items-center justify-center text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-secondary)] transition-colors duration-150 cursor-pointer"
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
          className="absolute bottom-0 left-0 right-0 h-[1px] origin-left bg-[var(--color-text-muted)]/35"
        />
      )}
    </motion.div>
  );
}
