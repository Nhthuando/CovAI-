import { motion, AnimatePresence } from "framer-motion";
import {
  Files,
  Settings,
  BarChart3,
  GitGraph,
  GitBranch,
  Layers,
  Network,
  Terminal,
} from "lucide-react";
import { useState } from "react";

const TOP_ITEMS = [
  { id: "explorer", icon: Files, label: "Explorer" },
  { id: "git", icon: GitGraph, label: "Git Control" },
  { id: "coverage", icon: BarChart3, label: "Coverage" },
  { id: "jobs", icon: Layers, label: "Snapshots & Jobs" },
  { id: "architecture", icon: Network, label: "Architecture" },
  { id: "logic-analysis", icon: GitBranch, label: "Logic Analysis" },
];

const BOTTOM_ITEMS = [{ id: "settings", icon: Settings, label: "Settings" }];

function ActivityItem({ item, isActive, onClick, delay = 0 }) {
  const [hovered, setHovered] = useState(false);
  const Icon = item.icon;

  return (
    <motion.div
      className="relative"
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay, duration: 0.2, ease: "easeOut" }}
    >
      {/* Active vertical bar (solid accent, no gradient, no glow) */}
      <AnimatePresence>
        {isActive && (
          <motion.div
            layoutId="activity-indicator"
            className="absolute left-0 top-1/2 -translate-y-1/2 rounded-r-[var(--radius-sm)]"
            style={{
              width: 3,
              height: 24,
              backgroundColor: "var(--color-primary)",
            }}
            initial={{ scaleY: 0, opacity: 0 }}
            animate={{ scaleY: 1, opacity: 1 }}
            exit={{ scaleY: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
          />
        )}
      </AnimatePresence>

      {/* Icon Button */}
      <button
        type="button"
        onClick={() => onClick(item.id)}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        className={`relative flex items-center justify-center cursor-pointer select-none rounded-[var(--radius-md)] transition-colors my-1 mx-2 ${
          isActive
            ? "bg-[var(--color-primary)]/10 text-[var(--color-primary)]"
            : hovered
              ? "bg-[var(--color-surface)] text-[var(--color-text)]"
              : "text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
        }`}
        style={{
          width: 44,
          height: 44,
        }}
        id={`activity-${item.id}`}
        title={item.label}
        aria-label={item.label}
      >
        <Icon size={19} strokeWidth={isActive ? 2 : 1.75} />
      </button>

      {/* Tooltip */}
      <AnimatePresence>
        {hovered && (
          <motion.div
            initial={{ opacity: 0, x: -4, scale: 0.95 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: -4, scale: 0.95 }}
            transition={{ duration: 0.12 }}
            className="absolute left-full top-1/2 -translate-y-1/2 ml-2 px-2.5 py-1 rounded-[var(--radius-md)] bg-[var(--color-surface)] border border-[var(--color-border)] shadow-md text-xs font-medium text-[var(--color-text)] whitespace-nowrap z-50 pointer-events-none"
          >
            {item.label}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

export default function ActivityBar({ active, onSelect }) {
  return (
    <div
      className="flex flex-col items-center justify-between py-2.5 select-none shrink-0 bg-[var(--color-surface-secondary)] border-r border-[var(--color-border)] font-sans"
      style={{ width: 60 }}
    >
      {/* Brand Icon */}
      <div className="flex flex-col items-center gap-1">
        <div
          className="w-8 h-8 rounded-[var(--radius-md)] bg-[var(--color-primary)] text-white flex items-center justify-center mb-2.5 shrink-0"
          title="CovAI Platform"
        >
          <Terminal size={16} strokeWidth={2.5} />
        </div>

        {/* Divider */}
        <div className="w-6 h-px bg-[var(--color-border)] mb-1" />

        {/* Top nav icons */}
        {TOP_ITEMS.map((item, i) => (
          <ActivityItem
            key={item.id}
            item={item}
            isActive={active === item.id}
            onClick={onSelect}
            delay={0.02 + i * 0.03}
          />
        ))}
      </div>

      {/* Bottom icons */}
      <div className="flex flex-col items-center gap-0.5 pb-1">
        {BOTTOM_ITEMS.map((item, i) => (
          <ActivityItem
            key={item.id}
            item={item}
            isActive={active === item.id}
            onClick={onSelect}
            delay={0.2 + i * 0.03}
          />
        ))}
      </div>
    </div>
  );
}
