import { motion } from "framer-motion";
import {
  Files,
  LayoutDashboard,
  Search,
  GitBranch,
  Settings,
  User,
  FlaskConical,
} from "lucide-react";
import { useState } from "react";

const TOP_ITEMS = [
  { id: "explorer", icon: Files, label: "Explorer" },
  { id: "dashboard", icon: LayoutDashboard, label: "Dashboard" },
  { id: "search", icon: Search, label: "Search" },
  { id: "git", icon: GitBranch, label: "Source Control" },
  { id: "tests", icon: FlaskConical, label: "Tests" },
];

const BOTTOM_ITEMS = [
  { id: "settings", icon: Settings, label: "Settings" },
  { id: "account", icon: User, label: "Account" },
];

function ActivityItem({ item, isActive, onClick }) {
  const Icon = item.icon;
  return (
    <div className="relative group" onClick={() => onClick(item.id)}>
      {/* Active bar */}
      {isActive && (
        <motion.div
          layoutId="activity-indicator"
          className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-8 rounded-r"
          style={{ background: "var(--primary)" }}
          transition={{ type: "spring", stiffness: 400, damping: 30 }}
        />
      )}
      <motion.button
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        className="relative flex items-center justify-center w-14 h-14 cursor-pointer transition-colors"
        style={{
          color: isActive ? "var(--text-primary)" : "var(--text-secondary)",
        }}
        title={item.label}
        id={`activity-${item.id}`}
      >
        <Icon size={22} strokeWidth={isActive ? 2 : 1.5} />
      </motion.button>
      {/* Tooltip */}
      <div
        className="pointer-events-none absolute left-14 top-1/2 -translate-y-1/2 z-50 ml-1 px-2 py-1 rounded text-xs whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity"
        style={{
          background: "#1f2937",
          border: "1px solid var(--ide-border)",
          color: "var(--text-primary)",
          fontFamily: "var(--font-sans)",
        }}
      >
        {item.label}
      </div>
    </div>
  );
}

export default function ActivityBar({ active, onSelect }) {
  return (
    <div
      className="flex flex-col items-center justify-between h-full py-3 select-none"
      style={{
        width: 56,
        background: "var(--ide-activitybar)",
        borderRight: "1px solid var(--ide-border)",
        flexShrink: 0,
      }}
    >
      {/* Top icons */}
      <div className="flex flex-col gap-0.5">
        {TOP_ITEMS.map((item) => (
          <ActivityItem
            key={item.id}
            item={item}
            isActive={active === item.id}
            onClick={onSelect}
          />
        ))}
      </div>

      {/* Bottom icons */}
      <div className="flex flex-col gap-0.5">
        {BOTTOM_ITEMS.map((item) => (
          <ActivityItem
            key={item.id}
            item={item}
            isActive={active === item.id}
            onClick={onSelect}
          />
        ))}
      </div>
    </div>
  );
}
