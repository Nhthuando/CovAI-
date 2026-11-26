import { motion, AnimatePresence } from "framer-motion";
import {
  LayoutDashboard,
  Files,
  Settings,
  GitGraph,
  GitBranch,
  Layers,
  Network,
  ShieldCheck,
  History,
} from "lucide-react";
import CovaiLogo from "../common/CovaiLogo";
import { useState } from "react";

const TOP_ITEMS = [
  { id: "explorer", icon: Files, label: "Explorer" },
  { id: "overview", icon: LayoutDashboard, label: "Overview" },
  { id: "version-control", icon: GitBranch, label: "Version Control" },
  { id: "trustworthiness", icon: ShieldCheck, label: "Chatbot Evaluation" },
  { id: "jobs", icon: History, label: "Activity Log" },
  { id: "architecture", icon: Network, label: "Architecture" },
  { id: "logic-analysis", icon: GitGraph, label: "Logic Analysis" },
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
      {/* Active vertical bar (crisp flat accent) */}
      <AnimatePresence>
        {isActive && (
          <motion.div
            layoutId="activity-indicator"
            className="absolute left-0 top-1/2 -translate-y-1/2 rounded-r-sm"
            style={{
              width: 2,
              height: 20,
              backgroundColor: "var(--ps-cobalt)",
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
        className={`relative flex items-center justify-center cursor-pointer select-none rounded-md border transition-colors duration-150 my-0.5 mx-1.5 ${
          isActive
            ? "bg-[var(--ps-surface-2)] border-[var(--ps-line-strong)] text-[var(--ps-ink)]"
            : hovered
              ? "bg-[var(--ps-surface-2)]/60 border-transparent text-[var(--ps-ink)]"
              : "border-transparent text-[var(--ps-ink-muted)] hover:text-[var(--ps-ink)]"
        }`}
        style={{
          width: 40,
          height: 40,
        }}
        id={`activity-${item.id}`}
        title={item.label}
        aria-label={item.label}
      >
        <Icon size={18} strokeWidth={isActive ? 1.9 : 1.65} />
      </button>

      {/* Tooltip */}
      <AnimatePresence>
        {hovered && (
          <motion.div
            initial={{ opacity: 0, x: -4, scale: 0.96 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: -4, scale: 0.96 }}
            transition={{ duration: 0.12 }}
            className="absolute left-full top-1/2 -translate-y-1/2 ml-2 px-2.5 py-1 rounded-md bg-[var(--ps-surface-2)] border border-[var(--ps-line-strong)] text-xs font-medium text-[var(--ps-ink)] whitespace-nowrap z-50 pointer-events-none"
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
      data-guide="activity-bar"
      className="h-full flex flex-col items-center justify-between py-2.5 select-none shrink-0 bg-[var(--ps-surface)] border-r border-[var(--ps-line)] font-sans"
      style={{ width: 54 }}
    >
      {/* Brand Icon (Click to return to Projects Portfolio) & Top nav items */}
      <div className="flex flex-col items-center gap-1 w-full">
        <button
          type="button"
          onClick={() => onSelect?.("portfolio")}
          className="hover:opacity-90 flex items-center justify-center mb-2 shrink-0 cursor-pointer transition-opacity"
          title="Back to All Projects Portfolio (/projects)"
          aria-label="Back to All Projects Portfolio"
        >
          <CovaiLogo size={26} />
        </button>

        {/* Divider */}
        <div className="w-6 h-px bg-[var(--ps-line)] mb-1" />

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

      {/* Bottom icons (Settings pinned at bottom with separate divider) */}
      <div className="flex flex-col items-center gap-1 pb-1 w-full mt-auto shrink-0">
        <div className="w-6 h-px bg-[var(--color-border)] mb-1" />
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
