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
      title={`Resize ${label} · Double-click to reset`}
      aria-label={`Resize ${label}`}
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
          background:
            isDragging || isHovered
              ? "var(--color-primary)"
              : "var(--color-border)",
          boxShadow: "none",
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
            ? "var(--color-primary)"
            : isHovered
              ? "var(--color-primary)"
              : "var(--color-surface)",
          border: "1px solid var(--color-border)",
          boxShadow: "none",
        }}
      >
        {/* 3 micro grip dots */}
        <span
          style={{
            width: 2,
            height: 2,
            borderRadius: "50%",
            background:
              isDragging || isHovered ? "#fff" : "var(--color-text-secondary)",
          }}
        />
        <span
          style={{
            width: 2,
            height: 2,
            borderRadius: "50%",
            background:
              isDragging || isHovered ? "#fff" : "var(--color-text-secondary)",
          }}
        />
        <span
          style={{
            width: 2,
            height: 2,
            borderRadius: "50%",
            background:
              isDragging || isHovered ? "#fff" : "var(--color-text-secondary)",
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
              background: "var(--color-surface)",
              border: "1px solid var(--color-border)",
              boxShadow: "0 4px 12px rgba(0, 0, 0, 0.2)",
              whiteSpace: "nowrap",
            }}
          >
            <span
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 11,
                fontWeight: 600,
                color: "var(--color-primary)",
              }}
            >
              {Math.round(currentWidth)}px
            </span>
            {defaultWidth && (
              <span
                style={{
                  fontSize: 10,
                  color: "var(--color-text-secondary)",
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
