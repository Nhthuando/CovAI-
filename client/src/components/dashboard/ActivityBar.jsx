import { motion, AnimatePresence } from "framer-motion";
import {
  Files,
  LayoutDashboard,
  Search,
  GitBranch,
  FlaskConical,
  Settings,
  User,
  Zap,
} from "lucide-react";
import { useState } from "react";

const TOP_ITEMS = [
  { id: "explorer",  icon: Files,           label: "Explorer" },
  { id: "dashboard", icon: LayoutDashboard, label: "Dashboard" },
  { id: "search",    icon: Search,          label: "Search" },
  { id: "git",       icon: GitBranch,       label: "Source Control" },
  { id: "tests",     icon: FlaskConical,    label: "Tests" },
];

const BOTTOM_ITEMS = [
  { id: "settings", icon: Settings, label: "Settings" },
  { id: "account",  icon: User,     label: "Account" },
];

function ActivityItem({ item, isActive, onClick, delay = 0 }) {
  const [hovered, setHovered] = useState(false);
  const Icon = item.icon;

  return (
    <motion.div
      className="relative"
      initial={{ opacity: 0, x: -12 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay, duration: 0.3, ease: "easeOut" }}
    >
      {/* Active vertical bar */}
      <AnimatePresence>
        {isActive && (
          <motion.div
            layoutId="activity-indicator"
            className="absolute left-0 top-1/2 -translate-y-1/2 rounded-r-full"
            style={{
              width: 2.5,
              height: 28,
              background: "linear-gradient(180deg, #a78bfa 0%, #7c3aed 100%)",
              boxShadow: "2px 0 12px rgba(124, 58, 237, 0.8), 0 0 6px rgba(124, 58, 237, 0.5)",
            }}
            initial={{ scaleY: 0, opacity: 0 }}
            animate={{ scaleY: 1, opacity: 1 }}
            exit={{ scaleY: 0, opacity: 0 }}
            transition={{ type: "spring", stiffness: 500, damping: 30 }}
          />
        )}
      </AnimatePresence>

      {/* Icon Button */}
      <motion.button
        onClick={() => onClick(item.id)}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        whileHover={{ scale: 1.08 }}
        whileTap={{ scale: 0.92 }}
        className="relative flex items-center justify-center cursor-pointer select-none"
        style={{
          width: 56,
          height: 52,
          background: isActive
            ? "rgba(124, 58, 237, 0.1)"
            : hovered
            ? "rgba(255, 255, 255, 0.04)"
            : "transparent",
          borderRadius: 8,
          margin: "0 4px",
          transition: "background 0.15s ease",
        }}
        id={`activity-${item.id}`}
        title={item.label}
      >
        <Icon
          size={20}
          strokeWidth={isActive ? 2 : 1.6}
          style={{
            color: isActive ? "#a78bfa" : hovered ? "#8b949e" : "#484f58",
            filter: isActive ? "drop-shadow(0 0 6px rgba(167, 139, 250, 0.5))" : "none",
            transition: "all 0.2s ease",
          }}
        />
      </motion.button>

      {/* Tooltip */}
      <AnimatePresence>
        {hovered && (
          <motion.div
            initial={{ opacity: 0, x: -4, scale: 0.9 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: -4, scale: 0.9 }}
            transition={{ duration: 0.15 }}
            className="pointer-events-none absolute left-16 top-1/2 -translate-y-1/2 z-50 whitespace-nowrap"
            style={{
              background: "#21262d",
              border: "1px solid rgba(255,255,255,0.1)",
              borderRadius: 6,
              padding: "4px 10px",
              fontSize: 12,
              color: "#e6edf3",
              fontFamily: "var(--font-sans)",
              boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
            }}
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
      className="flex flex-col items-center justify-between py-2 select-none flex-shrink-0"
      style={{
        width: 64,
        background: "var(--ide-activitybar)",
        borderRight: "1px solid var(--ide-border)",
      }}
    >
      {/* Logo / Brand */}
      <div className="flex flex-col items-center gap-1">
        <motion.div
          initial={{ opacity: 0, scale: 0.6 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.4, ease: "easeOut" }}
          className="flex items-center justify-center mb-3"
          style={{
            width: 36,
            height: 36,
            borderRadius: 10,
            background: "linear-gradient(135deg, #7c3aed 0%, #4f46e5 100%)",
            boxShadow: "0 0 16px rgba(124, 58, 237, 0.5), 0 2px 8px rgba(0,0,0,0.4)",
            marginTop: 4,
          }}
        >
          <Zap size={16} style={{ color: "#fff" }} strokeWidth={2.5} />
        </motion.div>

        {/* Divider */}
        <div
          style={{
            width: 24,
            height: 1,
            background: "rgba(255,255,255,0.06)",
            marginBottom: 8,
          }}
        />

        {/* Top nav icons */}
        {TOP_ITEMS.map((item, i) => (
          <ActivityItem
            key={item.id}
            item={item}
            isActive={active === item.id}
            onClick={onSelect}
            delay={0.05 + i * 0.05}
          />
        ))}
      </div>

      {/* Bottom icons */}
      <div className="flex flex-col items-center gap-0.5 pb-2">
        {BOTTOM_ITEMS.map((item, i) => (
          <ActivityItem
            key={item.id}
            item={item}
            isActive={active === item.id}
            onClick={onSelect}
            delay={0.3 + i * 0.05}
          />
        ))}
      </div>
    </div>
  );
}
