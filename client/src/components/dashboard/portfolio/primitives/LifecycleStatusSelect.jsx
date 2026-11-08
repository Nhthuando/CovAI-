import { useState, useRef, useEffect, memo } from "react";
import { ChevronDown, Check, Loader2 } from "lucide-react";
import { updateProjectLifecycleStatusApi } from "../../../../services/portfolio.service.js";

const LIFECYCLE_CONFIG = {
  DOING: {
    label: "Doing",
    dotColor: "bg-[#58a6ff]",
    textColor: "text-[#58a6ff]",
    borderColor: "border-[#1f6feb]/40",
    bgBadge: "bg-[#388bfd]/10",
  },
  NOT_STARTED: {
    label: "Not Started",
    dotColor: "bg-[#8b949e]",
    textColor: "text-[#8b949e]",
    borderColor: "border-[#30363d]",
    bgBadge: "bg-[#21262d]",
  },
  PAUSED: {
    label: "Paused",
    dotColor: "bg-[#d29922]",
    textColor: "text-[#d29922]",
    borderColor: "border-[#bb8009]/40",
    bgBadge: "bg-[#bb8009]/10",
  },
  COMPLETED: {
    label: "Completed",
    dotColor: "bg-[#3fb950]",
    textColor: "text-[#3fb950]",
    borderColor: "border-[#238636]/40",
    bgBadge: "bg-[#238636]/10",
  },
  CANCELLED: {
    label: "Cancelled",
    dotColor: "bg-[#f85149]",
    textColor: "text-[#8b949e]",
    borderColor: "border-[#30363d]",
    bgBadge: "bg-[#21262d]",
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

    try {
      await updateProjectLifecycleStatusApi(projectId, { lifecycleStatus: newStatus });
      setOptimisticStatus(null);
    } catch (err) {
      console.error("Failed to update lifecycle status:", err);
      // Revert optimistic update
      setOptimisticStatus(null);
      onStatusChange?.(currentStatus);
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
        className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-medium border transition-colors ${cfg.bgBadge} ${cfg.borderColor} ${cfg.textColor} hover:border-[#58a6ff]/50 disabled:opacity-50`}
        title={`Status: ${cfg.label}. Click to switch.`}
      >
        {isUpdating ? (
          <Loader2 className="w-2.5 h-2.5 animate-spin text-[#8b949e]" />
        ) : (
          <span className={`w-1.5 h-1.5 rounded-full ${cfg.dotColor}`} />
        )}
        <span>{cfg.label}</span>
        <ChevronDown className="w-3 h-3 opacity-60" />
      </button>

      {isOpen && (
        <div
          role="menu"
          className="absolute right-0 mt-1 w-56 bg-[#161b22] border border-[#30363d] rounded-md shadow-2xl z-50 py-1 overflow-hidden"
          style={{ backdropFilter: "blur(12px)" }}
        >
          <div className="px-2.5 py-1 text-[10px] uppercase font-bold text-[#8b949e] border-b border-[#21262d]">
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
                className={`w-full text-left px-2.5 py-1.5 text-xs flex items-start gap-2 hover:bg-[#21262d] transition-colors ${
                  isCurrent ? "bg-[#388bfd]/10 text-[#f0f6fc]" : "text-[#c9d1d9]"
                }`}
              >
                <span className={`w-2 h-2 rounded-full mt-1 shrink-0 ${optCfg.dotColor}`} />
                <div className="flex-1 min-w-0">
                  <div className="font-medium flex items-center justify-between">
                    <span>{optCfg.label}</span>
                    {isCurrent && <Check className="w-3.5 h-3.5 text-[#58a6ff]" />}
                  </div>
                  <div className="text-[10px] text-[#8b949e] leading-snug">{opt.desc}</div>
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

