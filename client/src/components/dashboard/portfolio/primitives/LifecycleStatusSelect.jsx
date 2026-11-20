import { useState, useRef, useEffect, useCallback, memo } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Check, Loader2 } from "lucide-react";
import { updateProjectLifecycleStatusApi } from "../../../../services/portfolio.service.js";
import { useToast } from "../../ToastContext.jsx";
import {
  computeLifecycleMenuPosition,
  formatLifecycleUpdateToast,
} from "./lifecycleStatusSelect.utils.js";

const LIFECYCLE_CONFIG = {
  DOING: {
    label: "Doing",
    dotColor: "bg-[var(--ud-unit)]",
    textColor: "text-[var(--ud-unit)]",
    borderColor: "border-[var(--ud-unit)]/35",
    bgBadge: "bg-[var(--ud-unit)]/10",
  },
  NOT_STARTED: {
    label: "Not Started",
    dotColor: "bg-[var(--ud-neutral)]",
    textColor: "text-[var(--ud-text-muted)]",
    borderColor: "border-[var(--ud-border)]",
    bgBadge: "bg-[var(--ud-surface-2)]",
  },
  PAUSED: {
    label: "Paused",
    dotColor: "bg-[var(--ud-warn)]",
    textColor: "text-[var(--ud-warn)]",
    borderColor: "border-[var(--ud-warn)]/35",
    bgBadge: "bg-[var(--ud-warn)]/10",
  },
  COMPLETED: {
    label: "Completed",
    dotColor: "bg-[var(--ud-pass)]",
    textColor: "text-[var(--ud-pass)]",
    borderColor: "border-[var(--ud-pass)]/35",
    bgBadge: "bg-[var(--ud-pass)]/10",
  },
  CANCELLED: {
    label: "Cancelled",
    dotColor: "bg-[var(--ud-fail)]",
    textColor: "text-[var(--ud-text-muted)]",
    borderColor: "border-[var(--ud-border)]",
    bgBadge: "bg-[var(--ud-surface-2)]",
  },
};

const OPTIONS = [
  { value: "DOING", desc: "Active development (Included in KPIs)" },
  { value: "NOT_STARTED", desc: "New / Backlog (Auto-transitions to Doing on test activity)" },
  { value: "PAUSED", desc: "Temporarily on hold (Isolated from KPIs)" },
  { value: "COMPLETED", desc: "Delivered & verified (Isolated from KPIs)" },
  { value: "CANCELLED", desc: "Discarded / Archived (Isolated from KPIs)" },
];

function LifecycleStatusSelect({
  projectId,
  currentStatus = "NOT_STARTED",
  onStatusChange,
  onStatusCommitted = null,
  align = "right",
  showFeedbackToast = true,
  disabled = false,
  className = "",
}) {
  const { addToast } = useToast();
  const [isOpen, setIsOpen] = useState(false);
  const [optimisticEntry, setOptimisticEntry] = useState(null);
  const [isUpdating, setIsUpdating] = useState(false);
  const [menuPos, setMenuPos] = useState(null);
  const triggerRef = useRef(null);
  const menuRef = useRef(null);

  const selectedStatus =
    optimisticEntry &&
    optimisticEntry.projectId === projectId &&
    optimisticEntry.baseStatus === currentStatus
      ? optimisticEntry.status
      : currentStatus;

  const updateMenuPosition = useCallback(() => {
    if (typeof window === "undefined") return;
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setMenuPos(
      computeLifecycleMenuPosition(
        rect,
        { width: window.innerWidth, height: window.innerHeight },
        { align },
      ),
    );
  }, [align]);

  useEffect(() => {
    if (!isOpen) return undefined;

    function handleClickOutside(e) {
      const clickedTrigger = triggerRef.current?.contains(e.target);
      const clickedMenu = menuRef.current?.contains(e.target);
      if (!clickedTrigger && !clickedMenu) {
        setIsOpen(false);
      }
    }

    function handleKeyDown(e) {
      if (e.key === "Escape") {
        setIsOpen(false);
      }
    }

    function handleReposition() {
      updateMenuPosition();
    }

    document.addEventListener("mousedown", handleClickOutside);
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("resize", handleReposition);
    window.addEventListener("scroll", handleReposition, true);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", handleReposition);
      window.removeEventListener("scroll", handleReposition, true);
    };
  }, [isOpen, updateMenuPosition]);

  const cfg = LIFECYCLE_CONFIG[selectedStatus] || LIFECYCLE_CONFIG.NOT_STARTED;

  const handleToggleMenu = (e) => {
    e.stopPropagation();
    if (!isOpen) {
      updateMenuPosition();
      setIsOpen(true);
    } else {
      setIsOpen(false);
    }
  };

  const handleSelect = async (newStatus) => {
    if (newStatus === selectedStatus || isUpdating || disabled) {
      setIsOpen(false);
      return;
    }

    // Optimistic UI update
    setOptimisticEntry({ projectId, baseStatus: currentStatus, status: newStatus });
    setIsOpen(false);
    setIsUpdating(true);
    onStatusChange?.(newStatus);
    window.dispatchEvent(
      new CustomEvent("covai:project-status-updated", {
        detail: { projectId, lifecycleStatus: newStatus },
      })
    );

    try {
      await updateProjectLifecycleStatusApi(projectId, { lifecycleStatus: newStatus });
      setOptimisticEntry(null);
      onStatusCommitted?.(newStatus);
      if (showFeedbackToast) {
        addToast?.(formatLifecycleUpdateToast(newStatus));
      }
    } catch (err) {
      console.error("Failed to update lifecycle status:", err);
      // Revert optimistic update
      setOptimisticEntry(null);
      onStatusChange?.(currentStatus);
      window.dispatchEvent(
        new CustomEvent("covai:project-status-updated", {
          detail: { projectId, lifecycleStatus: currentStatus },
        })
      );
      addToast?.({
        type: "error",
        title: "Status Update Failed",
        message: err?.message || "Could not update project lifecycle status.",
      });
    } finally {
      setIsUpdating(false);
    }
  };

  return (
    <div ref={triggerRef} className={`relative inline-block ${className}`}>
      <button
        type="button"
        disabled={disabled || isUpdating}
        onClick={handleToggleMenu}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] font-medium border transition-colors duration-150 ${cfg.bgBadge} ${cfg.borderColor} ${cfg.textColor} hover:border-[var(--ud-unit)]/50 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer`}
        title={
          disabled
            ? `Status: ${cfg.label} (read-only)`
            : `Status: ${cfg.label}. Click to switch.`
        }
      >
        {isUpdating ? (
          <Loader2 className="w-2.5 h-2.5 animate-spin text-[var(--ud-text-muted)]" />
        ) : (
          <span className={`w-1.5 h-1.5 rounded-full ${cfg.dotColor}`} />
        )}
        <span>{cfg.label}</span>
        {!disabled && <ChevronDown className="w-3 h-3 opacity-60" />}
      </button>

      {isOpen && menuPos && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={menuRef}
              className="portfolio-studio fixed z-[9999]"
              style={{
                top: `${menuPos.top}px`,
                left: `${menuPos.left}px`,
                backgroundColor: "transparent",
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <div
                role="menu"
                className="w-56 bg-[var(--ud-surface)] border border-[var(--ud-border)] rounded-md shadow-xl py-1 overflow-hidden"
              >
                <div className="px-2.5 py-1 text-[10px] uppercase font-bold text-[var(--ud-text-muted)] border-b border-[var(--ud-border)] bg-[var(--ud-surface-2)]/50">
                  Lifecycle State
                </div>
                {OPTIONS.map((opt) => {
                  const optCfg = LIFECYCLE_CONFIG[opt.value];
                  const isCurrent = opt.value === selectedStatus;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      role="menuitem"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleSelect(opt.value);
                      }}
                      className={`w-full text-left px-2.5 py-1.5 text-xs flex items-start gap-2 hover:bg-[var(--ud-surface-2)] transition-colors duration-150 cursor-pointer ${
                        isCurrent
                          ? "bg-[var(--ud-unit)]/10 text-[var(--ud-text)]"
                          : "text-[var(--ud-text)]"
                      }`}
                    >
                      <span className={`w-2 h-2 rounded-full mt-1 shrink-0 ${optCfg.dotColor}`} />
                      <div className="flex-1 min-w-0">
                        <div className="font-medium flex items-center justify-between">
                          <span>{optCfg.label}</span>
                          {isCurrent && <Check className="w-3.5 h-3.5 text-[var(--ud-unit)]" />}
                        </div>
                        <div className="text-[10px] text-[var(--ud-text-muted)] leading-snug">{opt.desc}</div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

export default memo(LifecycleStatusSelect);

