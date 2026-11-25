import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, AlertCircle, Info, X } from "lucide-react";
import Button from "./Button";

/**
 * ConfirmDialog component conforming to Rule 24 (Modals & Dialogs)
 *
 * @param {boolean} isOpen - Whether the dialog is displayed
 * @param {() => void} onClose - Callback when cancelled or closed
 * @param {() => void} onConfirm - Callback when confirmed
 * @param {string} title - Dialog header title
 * @param {string|React.ReactNode} message - Dialog description message
 * @param {string} [confirmText="Confirm"] - Text for confirm button
 * @param {string} [cancelText="Cancel"] - Text for cancel button
 * @param {'danger' | 'warning' | 'primary' | 'info'} [variant='danger'] - Visual style of dialog
 * @param {React.ComponentType} [icon] - Custom icon component
 * @param {boolean} [loading=false] - Whether confirm button is in loading state
 * @param {React.ReactNode} [children] - Optional custom body elements
 */
export default function ConfirmDialog({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  confirmText = "Confirm",
  cancelText = "Cancel",
  variant = "danger",
  icon: CustomIcon,
  loading = false,
  children,
}) {
  const dialog = useRef(null);
  const titleId = useId();
  useEffect(() => {
    if (!isOpen) return;
    const previous = document.activeElement;
    dialog.current?.focus();
    return () => { if (previous?.isConnected) previous.focus(); };
  }, [isOpen]);
  // Keyboard shortcut: Esc to close
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e) => {
      if (e.key === 'Tab') {
        const items = [...(dialog.current?.querySelectorAll('button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),summary,[tabindex="0"]') || [])].filter(item => item.getClientRects().length);
        const first = items[0], last = items.at(-1);
        if (!first) { e.preventDefault(); return; }
        if (e.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && (document.activeElement === last || document.activeElement === dialog.current)) { e.preventDefault(); first.focus(); }
      }
      if (e.key === "Escape" && !loading) {
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose, loading]);

  if (!isOpen) return null;

  const getVariantStyles = () => {
    switch (variant) {
      case "danger":
        return {
          icon: CustomIcon || AlertTriangle,
          iconBg: "bg-rose-500/10",
          iconBorder: "border-rose-500/25",
          iconColor: "text-rose-400",
          buttonVariant: "danger",
        };
      case "warning":
        return {
          icon: CustomIcon || AlertCircle,
          iconBg: "bg-[var(--color-surface-secondary)]",
          iconBorder: "border-[var(--color-border-strong)]",
          iconColor: "text-[var(--color-text-secondary)]",
          buttonVariant: "primary",
        };
      case "info":
      case "primary":
      default:
        return {
          icon: CustomIcon || Info,
          iconBg: "bg-[var(--color-surface-secondary)]",
          iconBorder: "border-[var(--color-border)]",
          iconColor: "text-[var(--color-text)]",
          buttonVariant: "primary",
        };
    }
  };

  const {
    icon: DialogIcon,
    iconBg,
    iconBorder,
    iconColor,
    buttonVariant,
  } = getVariantStyles();

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      className="fixed inset-0 z-[90] flex items-center justify-center p-4 bg-black/75 backdrop-blur-[2px] font-sans animate-in fade-in duration-150"
      onClick={!loading ? onClose : undefined}
    >
      <div
        ref={dialog}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[440px] max-h-[calc(100dvh-32px)] flex flex-col overflow-hidden bg-[var(--color-surface)] border border-[var(--color-border-strong)] ring-1 ring-white/[0.04] rounded-lg shadow-[0_24px_64px_-12px_rgba(0,0,0,0.9)] text-[var(--color-text)] relative animate-in zoom-in-95 duration-150"
      >
        {/* Close Button in corner */}
        <button
          type="button"
          onClick={onClose}
          disabled={loading}
          className="absolute top-3.5 right-3.5 w-7 h-7 rounded-md flex items-center justify-center text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-secondary)] transition-colors duration-150 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          aria-label="Close dialog"
        >
          <X size={14} />
        </button>

        {/* Body */}
        <div className="p-5 overflow-y-auto">
          <div className="flex items-start gap-3.5 pr-7">
            <div
              className={`w-9 h-9 rounded-md ${iconBg} border ${iconBorder} flex items-center justify-center ${iconColor} shrink-0`}
            >
              <DialogIcon size={18} strokeWidth={1.9} />
            </div>
            <div className="min-w-0 flex-1">
              <h3
                id={titleId}
                className="text-sm font-semibold text-[var(--color-text)] tracking-tight leading-snug"
              >
                {title}
              </h3>
              {message && (
                <p className="text-[13px] text-[var(--color-text-muted)] mt-1.5 leading-relaxed">
                  {message}
                </p>
              )}
            </div>
          </div>

          {/* Optional custom children (e.g. details, warning snippet) */}
          {children && <div className="mt-4">{children}</div>}
        </div>

        {/* Structured Footer */}
        <div className="px-5 py-3.5 bg-[var(--color-bg)] border-t border-[var(--color-border)] flex flex-wrap items-center justify-end gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={onClose}
            disabled={loading}
          >
            {cancelText}
          </Button>
          <Button
            type="button"
            variant={buttonVariant}
            size="sm"
            onClick={onConfirm}
            loading={loading}
          >
            {confirmText}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
