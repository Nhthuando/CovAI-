import React, { useState, useEffect } from "react";
import { AlertTriangle, X, ShieldAlert, Loader2 } from "lucide-react";

/**
 * DangerousActionModal — 2-Step Type-to-Confirm Security Gate
 * Prevents accidental bulk-deletion, hard-reset, queue purging or user ban.
 */
export function DangerousActionModal({
  isOpen,
  onClose,
  onConfirm,
  title = "Dangerous Action Verification",
  description = "This operation is irreversible and will permanently modify or delete records.",
  confirmTargetName = "DELETE",
  itemCount = null,
  isProcessing = false,
}) {
  const [typedValue, setTypedValue] = useState("");

  useEffect(() => {
    if (isOpen) {
      setTypedValue("");
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const isMatched = typedValue.trim() === confirmTargetName.trim();

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && isMatched && !isProcessing) {
      onConfirm();
    } else if (e.key === "Escape" && !isProcessing) {
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-xs animate-in fade-in duration-150">
      <div
        className="w-full max-w-md rounded-lg bg-[var(--admin-surface-raised)] border border-[var(--admin-status-danger)]/50 shadow-2xl overflow-hidden"
        onKeyDown={handleKeyDown}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--admin-border-subtle)] bg-[var(--admin-surface-overlay)]">
          <div className="flex items-center gap-2.5 text-[var(--admin-status-danger)]">
            <ShieldAlert size={18} />
            <h3 className="text-sm font-semibold tracking-wide uppercase">
              {title}
            </h3>
          </div>
          <button
            onClick={onClose}
            disabled={isProcessing}
            className="p-1 rounded text-[var(--admin-text-medium)] hover:text-[var(--admin-text-high)] hover:bg-[var(--admin-surface-base)] transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-5 space-y-4">
          <div className="flex items-start gap-3 p-3 rounded-md bg-[var(--admin-status-danger-muted)] border border-[var(--admin-status-danger)]/30 text-[var(--admin-status-danger)]">
            <AlertTriangle size={18} className="flex-shrink-0 mt-0.5" />
            <div className="text-xs leading-relaxed">
              <span className="font-semibold block mb-0.5">Destructive Operation:</span>
              {description}
              {itemCount !== null && (
                <div className="mt-1 font-mono font-bold">
                  Affected records: {itemCount}
                </div>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-xs text-[var(--admin-text-medium)] block">
              To proceed, please type <span className="font-mono font-bold text-[var(--admin-text-high)] bg-[var(--admin-surface-base)] px-1.5 py-0.5 rounded border border-[var(--admin-border-subtle)]">{confirmTargetName}</span> below:
            </label>
            <input
              type="text"
              autoFocus
              value={typedValue}
              onChange={(e) => setTypedValue(e.target.value)}
              placeholder={`Type "${confirmTargetName}" to confirm`}
              disabled={isProcessing}
              className="w-full px-3 py-2 text-sm font-mono rounded-md bg-[var(--admin-surface-base)] border border-[var(--admin-border-strong)] focus:border-[var(--admin-status-danger)] focus:outline-none text-[var(--admin-text-high)] transition-colors"
            />
          </div>
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-end gap-3 px-5 py-3 border-t border-[var(--admin-border-subtle)] bg-[var(--admin-surface-base)]">
          <button
            type="button"
            onClick={onClose}
            disabled={isProcessing}
            className="px-3.5 py-1.5 text-xs font-medium rounded-md text-[var(--admin-text-medium)] hover:text-[var(--admin-text-high)] hover:bg-[var(--admin-surface-raised)] border border-[var(--admin-border-subtle)] transition-colors admin-tactile-btn"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={!isMatched || isProcessing}
            className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold rounded-md bg-[var(--admin-status-danger)] hover:bg-[#DC2626] disabled:opacity-40 disabled:hover:bg-[var(--admin-status-danger)] text-white transition-all admin-tactile-btn cursor-pointer disabled:cursor-not-allowed shadow-[0_0_12px_rgba(239,68,68,0.3)]"
          >
            {isProcessing && <Loader2 size={13} className="animate-spin" />}
            <span>Execute Permanent Action</span>
          </button>
        </div>
      </div>
    </div>
  );
}
