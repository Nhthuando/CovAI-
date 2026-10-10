import { useEffect } from "react";
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
  confirmDisabled = false,
  children,
}) {
  // Keyboard shortcut: Esc to close
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e) => {
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
          iconBg: "bg-[var(--color-danger)]/10",
          iconBorder: "border-[var(--color-danger)]/25",
          iconColor: "text-[var(--color-danger)]",
          buttonVariant: "danger",
        };
      case "warning":
        return {
          icon: CustomIcon || AlertCircle,
          iconBg: "bg-[var(--color-warning)]/10",
          iconBorder: "border-[var(--color-warning)]/25",
          iconColor: "text-[var(--color-warning)]",
          buttonVariant: "primary",
        };
      case "info":
      case "primary":
      default:
        return {
          icon: CustomIcon || Info,
          iconBg: "bg-[var(--color-primary)]/10",
          iconBorder: "border-[var(--color-primary)]/25",
          iconColor: "text-[var(--color-primary)]",
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
      aria-labelledby="confirm-dialog-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs font-sans animate-in fade-in duration-150"
      onClick={!loading ? onClose : undefined}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-xl)] p-6 shadow-xl text-[var(--color-text)] relative animate-in zoom-in-95 duration-150"
      >
        {/* Close Button in corner */}
        <button
          type="button"
          onClick={onClose}
          disabled={loading}
          className="absolute top-4 right-4 p-1 rounded-[var(--radius-sm)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-secondary)] transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          aria-label="Close dialog"
        >
          <X size={15} />
        </button>

        {/* Header with Icon and Title */}
        <div className="flex items-start gap-3.5 mb-3 pr-6">
          <div
            className={`w-10 h-10 rounded-[var(--radius-md)] ${iconBg} border ${iconBorder} flex items-center justify-center ${iconColor} shrink-0`}
          >
            <DialogIcon size={20} strokeWidth={2} />
          </div>
          <div>
            <h3
              id="confirm-dialog-title"
              className="text-base font-bold text-[var(--color-text)] tracking-tight"
            >
              {title}
            </h3>
            {message && (
              <p className="text-xs text-[var(--color-text-secondary)] mt-1 leading-relaxed">
                {message}
              </p>
            )}
          </div>
        </div>

        {/* Optional custom children (e.g. details, warning snippet) */}
        {children && <div className="mt-3 mb-2">{children}</div>}

        {/* Footer Actions */}
        <div className="flex items-center justify-end gap-2.5 mt-5">
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
            disabled={confirmDisabled || loading}
          >
            {confirmText}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
