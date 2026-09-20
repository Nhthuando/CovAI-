import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

/**
 * Modern High-Tech Panel Resizer (Splitter)
 *
 * Features:
 * - Generous 14px hitbox with zero layout shift (-7px margin)
 * - 1px sleek hairline divider that illuminates with neon violet/cyan glow on hover & drag
 * - Centered tactile grip capsule with micro-dots indicating draggable affordance
 * - Real-time floating badge displaying current width & reset hint
 * - Smooth double-click reset capability
 */
export default function PanelResizer({
  onMouseDown,
  isDragging = false,
  onDoubleClick,
  currentWidth,
  side = "left", // "left" or "right"
  defaultWidth,
  label = "Panel",
}) {
  const [isHovered, setIsHovered] = useState(false);

  const showTooltip = isHovered || isDragging;

  return (
    <div
      onMouseDown={onMouseDown}
      onDoubleClick={onDoubleClick}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      title="Drag to resize · Double-click to reset"
      className="relative flex items-center justify-center flex-shrink-0 select-none group"
      style={{
        width: 14,
        marginLeft: -7,
        marginRight: -7,
        cursor: "col-resize",
        zIndex: 25,
        height: "100%",
        touchAction: "none",
      }}
    >
      {/* ── Central 1px Hairline Divider ── */}
      <div
        className="w-px h-full transition-all duration-200"
        style={{
          background: isDragging
            ? "linear-gradient(180deg, #7c3aed 0%, #a78bfa 30%, #22d3ee 70%, #7c3aed 100%)"
            : isHovered
              ? "linear-gradient(180deg, rgba(124, 58, 237, 0.2) 0%, #a78bfa 25%, #22d3ee 75%, rgba(124, 58, 237, 0.2) 100%)"
              : "rgba(255, 255, 255, 0.08)",
          boxShadow: isDragging
            ? "0 0 12px rgba(167, 139, 250, 0.8), 0 0 4px rgba(34, 211, 238, 0.8)"
            : isHovered
              ? "0 0 8px rgba(167, 139, 250, 0.5)"
              : "none",
          width: isDragging ? 2 : 1,
        }}
      />

      {/* ── Center Tactile Grip Capsule ── */}
      <motion.div
        animate={{
          scale: isDragging ? 1.15 : isHovered ? 1.08 : 1,
          opacity: isDragging ? 1 : isHovered ? 1 : 0.45,
        }}
        transition={{ duration: 0.15 }}
        className="absolute flex flex-col items-center justify-center gap-1 transition-all duration-200"
        style={{
          width: 6,
          height: 42,
          borderRadius: 9999,
          background: isDragging
            ? "#7c3aed"
            : isHovered
              ? "rgba(124, 58, 237, 0.45)"
              : "rgba(255, 255, 255, 0.12)",
          border: isDragging
            ? "1px solid #c4b5fd"
            : isHovered
              ? "1px solid rgba(167, 139, 250, 0.7)"
              : "1px solid rgba(255, 255, 255, 0.1)",
          boxShadow: isDragging
            ? "0 0 14px rgba(124, 58, 237, 0.9), 0 0 6px rgba(34, 211, 238, 0.7)"
            : isHovered
              ? "0 0 10px rgba(167, 139, 250, 0.5)"
              : "0 1px 4px rgba(0,0,0,0.4)",
          backdropFilter: "blur(4px)",
        }}
      >
        {/* 3 micro grip dots */}
        <span
          style={{
            width: 2,
            height: 2,
            borderRadius: "50%",
            background: isDragging
              ? "#fff"
              : isHovered
                ? "#e0e7ff"
                : "rgba(255, 255, 255, 0.5)",
          }}
        />
        <span
          style={{
            width: 2,
            height: 2,
            borderRadius: "50%",
            background: isDragging
              ? "#fff"
              : isHovered
                ? "#e0e7ff"
                : "rgba(255, 255, 255, 0.5)",
          }}
        />
        <span
          style={{
            width: 2,
            height: 2,
            borderRadius: "50%",
            background: isDragging
              ? "#fff"
              : isHovered
                ? "#e0e7ff"
                : "rgba(255, 255, 255, 0.5)",
          }}
        />
      </motion.div>

      {/* ── Floating Width Badge / Tooltip ── */}
      <AnimatePresence>
        {showTooltip && (
          <motion.div
            initial={{ opacity: 0, scale: 0.92, y: 4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.92, y: 4 }}
            transition={{ duration: 0.14 }}
            className="absolute pointer-events-none z-50 flex items-center gap-1.5 px-2.5 py-1 rounded-md"
            style={{
              top: "calc(50% + 32px)",
              [side === "left" ? "left" : "right"]: 12,
              background: "rgba(13, 17, 23, 0.95)",
              border: "1px solid rgba(124, 58, 237, 0.35)",
              boxShadow:
                "0 6px 20px rgba(0, 0, 0, 0.6), 0 0 10px rgba(124, 58, 237, 0.2)",
              backdropFilter: "blur(10px)",
              whiteSpace: "nowrap",
            }}
          >
            <span
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 11,
                fontWeight: 600,
                color: "#c4b5fd",
              }}
            >
              {Math.round(currentWidth)}px
            </span>
            {defaultWidth && (
              <span
                style={{
                  fontSize: 10,
                  color: "#8b949e",
                  fontFamily: "var(--font-sans)",
                }}
              >
                · Double-click to reset
              </span>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
