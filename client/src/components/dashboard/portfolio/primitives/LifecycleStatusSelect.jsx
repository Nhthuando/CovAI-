import { useState, useRef, useEffect, memo } from "react";
import { ChevronDown, Check, Loader2 } from "lucide-react";
import { updateProjectLifecycleStatusApi } from "../../../../services/portfolio.service.js";

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
  disabled = false,
  className = "",
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [optimisticStatus, setOptimisticStatus] = useState(null);
  const [isUpdating, setIsUpdating] = useState(false);
  const dropdownRef = useRef(null);

  useEffect(() => {
    setOptimisticStatus(null);
  }, [currentStatus, projectId]);

  const selectedStatus = optimisticStatus || currentStatus;

  useEffect(() => {
    function handleClickOutside(e) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    }
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen]);

  const cfg = LIFECYCLE_CONFIG[selectedStatus] || LIFECYCLE_CONFIG.NOT_STARTED;

  const handleSelect = async (newStatus) => {
    if (newStatus === selectedStatus || isUpdating || disabled) {
      setIsOpen(false);
      return;
    }

    // Optimistic UI update
    setOptimisticStatus(newStatus);
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
      setOptimisticStatus(null);
    } catch (err) {
      console.error("Failed to update lifecycle status:", err);
      // Revert optimistic update
      setOptimisticStatus(null);
      onStatusChange?.(currentStatus);
      window.dispatchEvent(
        new CustomEvent("covai:project-status-updated", {
          detail: { projectId, lifecycleStatus: currentStatus },
        })
      );
    } finally {
      setIsUpdating(false);
    }
  };

  return (
    <div ref={dropdownRef} className={`relative inline-block ${className}`}>
      <button
        type="button"
        disabled={disabled || isUpdating}
        onClick={(e) => {
          e.stopPropagation();
          setIsOpen((prev) => !prev);
        }}
        className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] font-medium border transition-colors duration-150 ${cfg.bgBadge} ${cfg.borderColor} ${cfg.textColor} hover:border-[var(--ud-unit)]/50 disabled:opacity-50 cursor-pointer`}
        title={`Status: ${cfg.label}. Click to switch.`}
      >
        {isUpdating ? (
          <Loader2 className="w-2.5 h-2.5 animate-spin text-[var(--ud-text-muted)]" />
        ) : (
          <span className={`w-1.5 h-1.5 rounded-full ${cfg.dotColor}`} />
        )}
        <span>{cfg.label}</span>
        <ChevronDown className="w-3 h-3 opacity-60" />
      </button>

      {isOpen && (
        <div
          role="menu"
          className="absolute right-0 mt-1 w-56 bg-[var(--ud-surface)] border border-[var(--ud-border)] rounded-md shadow-xl z-50 py-1 overflow-hidden"
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
                onClick={(e) => {
                  e.stopPropagation();
                  handleSelect(opt.value);
                }}
                className={`w-full text-left px-2.5 py-1.5 text-xs flex items-start gap-2 hover:bg-[var(--ud-surface-2)] transition-colors cursor-pointer ${
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
      )}
    </div>
  );
}

export default memo(LifecycleStatusSelect);

