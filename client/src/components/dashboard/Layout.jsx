import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import ActivityBar from "./ActivityBar";
import Sidebar from "./Sidebar";
import Editor from "./Editor";
import AIPanel from "./AIPanel";
import { PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen } from "lucide-react";

const INITIAL_TABS = [
  { id: "dashboard-tsx", name: "Dashboard.tsx", unsaved: false },
  { id: "app-tsx", name: "App.tsx", unsaved: true },
  { id: "index-tsx", name: "index.tsx", unsaved: false },
];

export default function Layout() {
  const [activeActivity, setActiveActivity] = useState("explorer");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [aiPanelOpen, setAiPanelOpen] = useState(true);
  const [tabs, setTabs] = useState(INITIAL_TABS);
  const [activeTabId, setActiveTabId] = useState("dashboard-tsx");
  const [activeFileId, setActiveFileId] = useState("dashboard-tsx");

  /* ── Open file from explorer ─────────────────────────── */
  const handleOpenFile = (node) => {
    if (node.type === "folder") return;
    setActiveFileId(node.id);
    if (!tabs.find((t) => t.id === node.id)) {
      setTabs((prev) => [...prev, { id: node.id, name: node.name, unsaved: false }]);
    }
    setActiveTabId(node.id);
  };

  /* ── Close tab ───────────────────────────────────────── */
  const handleCloseTab = (tabId) => {
    const idx = tabs.findIndex((t) => t.id === tabId);
    const next = tabs.filter((t) => t.id !== tabId);
    setTabs(next);
    if (activeTabId === tabId && next.length > 0) {
      const newActive = next[Math.max(0, idx - 1)];
      setActiveTabId(newActive.id);
    }
  };

  return (
    <div
      className="ide-root flex flex-col"
      style={{ background: "var(--ide-bg)", color: "var(--text-primary)" }}
    >
      {/* ── Title bar ──────────────────────────────────── */}
      <div
        className="flex items-center justify-between px-4 flex-shrink-0"
        style={{
          height: 36,
          background: "#0d1117",
          borderBottom: "1px solid var(--ide-border)",
          zIndex: 10,
        }}
      >
        {/* Left: window dots */}
        <div className="flex items-center gap-1.5">
          {[
            { color: "#FF5F57" },
            { color: "#FEBC2E" },
            { color: "#28C840" },
          ].map((dot, i) => (
            <div
              key={i}
              style={{
                width: 12, height: 12, borderRadius: "50%",
                background: dot.color, opacity: 0.8,
              }}
            />
          ))}
        </div>

        {/* Center: app name */}
        <div className="flex items-center gap-2" style={{ fontSize: 12, color: "var(--text-muted)" }}>
          <span style={{ color: "var(--primary-light)", fontWeight: 600, fontSize: 13 }}>
            TestCovAI
          </span>
          <span>/</span>
          <span>Dashboard</span>
        </div>

        {/* Right: panel toggles */}
        <div className="flex items-center gap-1">
          <button
            title={sidebarOpen ? "Hide Explorer" : "Show Explorer"}
            onClick={() => setSidebarOpen((o) => !o)}
            className="p-1.5 rounded opacity-50 hover:opacity-100 transition-opacity"
            style={{ color: "var(--text-secondary)" }}
            id="toggle-sidebar-btn"
          >
            {sidebarOpen ? <PanelLeftClose size={14} /> : <PanelLeftOpen size={14} />}
          </button>
          <button
            title={aiPanelOpen ? "Hide AI Panel" : "Show AI Panel"}
            onClick={() => setAiPanelOpen((o) => !o)}
            className="p-1.5 rounded opacity-50 hover:opacity-100 transition-opacity"
            style={{ color: "var(--text-secondary)" }}
            id="toggle-ai-panel-btn"
          >
            {aiPanelOpen ? <PanelRightClose size={14} /> : <PanelRightOpen size={14} />}
          </button>
        </div>
      </div>

      {/* ── Main row ───────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">
        {/* Activity Bar */}
        <ActivityBar active={activeActivity} onSelect={setActiveActivity} />

        {/* Sidebar */}
        <AnimatePresence initial={false}>
          {sidebarOpen && (
            <motion.div
              key="sidebar"
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 256, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ duration: 0.22, ease: "easeInOut" }}
              style={{ overflow: "hidden", flexShrink: 0 }}
            >
              <Sidebar
                onOpenFile={handleOpenFile}
                activeFileId={activeFileId}
              />
            </motion.div>
          )}
        </AnimatePresence>

        {/* Editor */}
        <Editor
          tabs={tabs}
          activeTabId={activeTabId}
          onSelectTab={setActiveTabId}
          onCloseTab={handleCloseTab}
        />

        {/* AI Panel */}
        <AnimatePresence initial={false}>
          {aiPanelOpen && (
            <motion.div
              key="ai-panel"
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 360, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ duration: 0.22, ease: "easeInOut" }}
              style={{ overflow: "hidden", flexShrink: 0 }}
            >
              <AIPanel />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* ── Status bar ─────────────────────────────────── */}
      <div
        className="flex items-center justify-between px-4 flex-shrink-0"
        style={{
          height: 24,
          background: "var(--primary)",
          fontSize: 11,
          color: "rgba(255,255,255,0.85)",
          fontFamily: "var(--font-sans)",
        }}
      >
        <div className="flex items-center gap-4">
          <span>● main</span>
          <span>⚡ TypeScript</span>
        </div>
        <div className="flex items-center gap-4">
          <span>Coverage: 84%</span>
          <span>Ln 29, Col 1</span>
          <span>UTF-8</span>
          <span>Gemini AI ✓</span>
        </div>
      </div>
    </div>
  );
}
