import { useState, useRef, useEffect } from "react";
import { Info } from "lucide-react";

/**
 * ContextualMetricTooltip
 * Renders an accessible 3-part guidance popover:
 * 1. What it means (Meaning)
 * 2. Formula & Provenance (How it is computed & data origin)
 * 3. Actionable Tip (How to act upon it)
 */
export default function ContextualMetricTooltip({
  title,
  meaning,
  formula,
  provenance,
  tip,
  children,
  placement = "bottom",
  className = "",
}) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef(null);

  useEffect(() => {
    function handleClickOutside(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
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

  const placementClasses = {
    bottom: "top-full mt-2 left-1/2 -translate-x-1/2",
    "bottom-right": "top-full mt-2 right-0",
    "bottom-left": "top-full mt-2 left-0",
    top: "bottom-full mb-2 left-1/2 -translate-x-1/2",
    "top-right": "bottom-full mb-2 right-0",
  }[placement] || "top-full mt-2 left-1/2 -translate-x-1/2";

  return (
    <div
      ref={containerRef}
      className={`relative inline-flex items-center ${className}`}
      onMouseEnter={() => setIsOpen(true)}
      onMouseLeave={() => setIsOpen(false)}
    >
      {children || (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setIsOpen((prev) => !prev);
          }}
          className="text-[#8b949e] hover:text-[#58a6ff] transition-colors p-0.5 rounded focus:outline-none focus:ring-1 focus:ring-[#58a6ff]"
          aria-label={title || "Metric Details"}
        >
          <Info className="w-3.5 h-3.5" />
        </button>
      )}

      {isOpen && (
        <div
          role="tooltip"
          className={`absolute z-50 w-72 p-3 bg-[#161b22] border border-[#30363d] rounded-md shadow-2xl text-left pointer-events-none transition-opacity duration-150 ${placementClasses}`}
          style={{ backdropFilter: "blur(8px)" }}
        >
          {title && (
            <div className="font-semibold text-xs text-[#f0f6fc] border-b border-[#30363d] pb-1.5 mb-2 flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-[#58a6ff]" />
              {title}
            </div>
          )}

          {/* 1. What it means */}
          {meaning && (
            <div className="mb-2">
              <span className="text-[10px] uppercase font-bold text-[#8b949e] tracking-wider block">
                What it means
              </span>
              <p className="text-[11px] text-[#c9d1d9] leading-relaxed mt-0.5">{meaning}</p>
            </div>
          )}

          {/* 2. Formula & Provenance */}
          {(formula || provenance) && (
            <div className="mb-2 p-1.5 bg-[#0d1117] rounded border border-[#21262d]">
              {formula && (
                <div>
                  <span className="text-[10px] uppercase font-bold text-[#8b949e] tracking-wider block">
                    Formula
                  </span>
                  <code className="text-[10px] text-[#79c0ff] font-mono break-all block mt-0.5">
                    {formula}
                  </code>
                </div>
              )}
              {provenance && (
                <div className={formula ? "mt-1.5 pt-1 border-t border-[#21262d]" : ""}>
                  <span className="text-[10px] uppercase font-bold text-[#8b949e] tracking-wider block">
                    Provenance
                  </span>
                  <span className="text-[10px] text-[#8b949e] font-mono block mt-0.5">
                    {provenance}
                  </span>
                </div>
              )}
            </div>
          )}

          {/* 3. Actionable Tip */}
          {tip && (
            <div className="pt-1 border-t border-[#21262d] flex items-start gap-1.5 text-[11px] text-[#3fb950]">
              <span className="font-bold">Tip:</span>
              <span className="text-[#8b949e] leading-snug">{tip}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

