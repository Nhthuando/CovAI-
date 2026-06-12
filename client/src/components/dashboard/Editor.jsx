import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  X,
  Circle,
  BarChart3,
  GitBranch,
  Zap,
  ChevronRight,
  Dot,
} from "lucide-react";

/* ── App.tsx file code ────────────────────────────────────── */
const FILES_CODE = {
  "dashboard-tsx": {
    name: "Dashboard.tsx",
    breadcrumb: ["src", "pages", "Dashboard.tsx"],
    lines: [
      { n: 1,  cov: "covered",   tokens: [{ t: "keyword", v: "import" }, { t: "plain", v: " { useState, useEffect } " }, { t: "keyword", v: "from" }, { t: "string", v: " 'react'" }, { t: "plain", v: ";" }] },
      { n: 2,  cov: "covered",   tokens: [{ t: "keyword", v: "import" }, { t: "plain", v: " { motion } " }, { t: "keyword", v: "from" }, { t: "string", v: " 'framer-motion'" }, { t: "plain", v: ";" }] },
      { n: 3,  cov: null,        tokens: [] },
      { n: 4,  cov: null,        tokens: [{ t: "comment", v: "// 🤖 TestCovAI — AI-powered Test Coverage Platform" }] },
      { n: 5,  cov: null,        tokens: [{ t: "keyword", v: "interface" }, { t: "type", v: " CoverageSummary" }, { t: "plain", v: " {" }] },
      { n: 6,  cov: null,        tokens: [{ t: "plain", v: "  lines" }, { t: "plain", v: ": " }, { t: "type", v: "number" }, { t: "plain", v: ";" }] },
      { n: 7,  cov: null,        tokens: [{ t: "plain", v: "  branches" }, { t: "plain", v: ": " }, { t: "type", v: "number" }, { t: "plain", v: ";" }] },
      { n: 8,  cov: null,        tokens: [{ t: "plain", v: "  functions" }, { t: "plain", v: ": " }, { t: "type", v: "number" }, { t: "plain", v: ";" }] },
      { n: 9,  cov: null,        tokens: [{ t: "plain", v: "}" }] },
      { n: 10, cov: null,        tokens: [] },
      { n: 11, cov: "covered",   tokens: [{ t: "keyword", v: "const" }, { t: "fn", v: " Dashboard" }, { t: "plain", v: " = () => {" }] },
      { n: 12, cov: "covered",   tokens: [{ t: "keyword", v: "  const" }, { t: "plain", v: " [coverage, setCoverage] = " }, { t: "fn", v: "useState" }, { t: "plain", v: "<" }, { t: "type", v: "CoverageSummary" }, { t: "plain", v: ">({" }] },
      { n: 13, cov: "covered",   tokens: [{ t: "plain", v: "    lines: " }, { t: "number", v: "84" }, { t: "plain", v: "," }] },
      { n: 14, cov: "covered",   tokens: [{ t: "plain", v: "    branches: " }, { t: "number", v: "71" }, { t: "plain", v: "," }] },
      { n: 15, cov: "covered",   tokens: [{ t: "plain", v: "    functions: " }, { t: "number", v: "89" }, { t: "plain", v: "," }] },
      { n: 16, cov: "covered",   tokens: [{ t: "plain", v: "    statements: " }, { t: "number", v: "82" }, { t: "plain", v: "," }] },
      { n: 17, cov: "covered",   tokens: [{ t: "plain", v: "  });" }] },
      { n: 18, cov: null,        tokens: [] },
      { n: 19, cov: "covered",   tokens: [{ t: "fn", v: "  useEffect" }, { t: "plain", v: "(() => {" }] },
      { n: 20, cov: "covered",   tokens: [{ t: "fn", v: "    fetchCoverage" }, { t: "plain", v: "();" }] },
      { n: 21, cov: "covered",   tokens: [{ t: "plain", v: "  }, []);" }] },
      { n: 22, cov: null,        tokens: [] },
      { n: 23, cov: "uncovered", tokens: [{ t: "keyword", v: "  const" }, { t: "fn", v: " handleError" }, { t: "plain", v: " = (err) => {" }] },
      { n: 24, cov: "uncovered", tokens: [{ t: "fn", v: "    console" }, { t: "plain", v: ".error(" }, { t: "string", v: "'Coverage fetch failed'" }, { t: "plain", v: ", err);" }] },
      { n: 25, cov: "uncovered", tokens: [{ t: "plain", v: "  };" }] },
      { n: 26, cov: null,        tokens: [] },
      { n: 27, cov: "covered",   tokens: [{ t: "keyword", v: "  return" }, { t: "plain", v: " (" }] },
      { n: 28, cov: "covered",   tokens: [{ t: "tag", v: "    <motion.div" }] },
      { n: 29, cov: "covered",   tokens: [{ t: "attr", v: "      initial" }, { t: "plain", v: "={{ opacity: " }, { t: "number", v: "0" }, { t: "plain", v: " }}" }] },
      { n: 30, cov: "covered",   tokens: [{ t: "attr", v: "      animate" }, { t: "plain", v: "={{ opacity: " }, { t: "number", v: "1" }, { t: "plain", v: " }}" }] },
      { n: 31, cov: "covered",   tokens: [{ t: "tag", v: "    >" }] },
      { n: 32, cov: "partial",   tokens: [{ t: "tag", v: "      <CoverageCard" }, { t: "attr", v: " data" }, { t: "plain", v: "={coverage} " }, { t: "tag", v: "/>" }] },
      { n: 33, cov: "covered",   tokens: [{ t: "tag", v: "    </motion.div>" }] },
      { n: 34, cov: "covered",   tokens: [{ t: "plain", v: "  );" }] },
      { n: 35, cov: "covered",   tokens: [{ t: "plain", v: "};" }] },
      { n: 36, cov: null,        tokens: [] },
      { n: 37, cov: "covered",   tokens: [{ t: "keyword", v: "export default" }, { t: "plain", v: " Dashboard;" }] },
    ],
  },
  "app-tsx": {
    name: "App.tsx",
    breadcrumb: ["src", "App.tsx"],
    lines: [
      { n: 1,  cov: "covered", tokens: [{ t: "keyword", v: "import" }, { t: "plain", v: " { Routes, Route } " }, { t: "keyword", v: "from" }, { t: "string", v: " 'react-router-dom'" }, { t: "plain", v: ";" }] },
      { n: 2,  cov: "covered", tokens: [{ t: "keyword", v: "import" }, { t: "plain", v: " " }, { t: "string", v: "'./index.css'" }, { t: "plain", v: ";" }] },
      { n: 3,  cov: null,      tokens: [] },
      { n: 4,  cov: "covered", tokens: [{ t: "keyword", v: "function" }, { t: "fn", v: " App" }, { t: "plain", v: "() {" }] },
      { n: 5,  cov: "covered", tokens: [{ t: "keyword", v: "  return" }, { t: "plain", v: " (" }] },
      { n: 6,  cov: "covered", tokens: [{ t: "tag", v: "    <Routes>" }] },
      { n: 7,  cov: "covered", tokens: [{ t: "tag", v: "      <Route" }, { t: "attr", v: " path" }, { t: "plain", v: '="/"' }, { t: "tag", v: " />" }] },
      { n: 8,  cov: "covered", tokens: [{ t: "tag", v: "    </Routes>" }] },
      { n: 9,  cov: "covered", tokens: [{ t: "plain", v: "  );" }] },
      { n: 10, cov: "covered", tokens: [{ t: "plain", v: "}" }] },
    ],
  },
  "index-tsx": {
    name: "index.tsx",
    breadcrumb: ["src", "index.tsx"],
    lines: [
      { n: 1,  cov: "covered", tokens: [{ t: "keyword", v: "import" }, { t: "plain", v: " React " }, { t: "keyword", v: "from" }, { t: "string", v: " 'react'" }, { t: "plain", v: ";" }] },
      { n: 2,  cov: "covered", tokens: [{ t: "keyword", v: "import" }, { t: "plain", v: " ReactDOM " }, { t: "keyword", v: "from" }, { t: "string", v: " 'react-dom/client'" }, { t: "plain", v: ";" }] },
      { n: 3,  cov: null,      tokens: [] },
      { n: 4,  cov: "covered", tokens: [{ t: "plain", v: "ReactDOM." }, { t: "fn", v: "createRoot" }, { t: "plain", v: "(" }, { t: "fn", v: "document" }, { t: "plain", v: "." }, { t: "fn", v: "getElementById" }, { t: "plain", v: "(" }, { t: "string", v: "'root'" }, { t: "plain", v: ")!)." }, { t: "fn", v: "render" }, { t: "plain", v: "(<App />);" }] },
    ],
  },
};

/* ── Token color map ─────────────────────────────────────── */
const TOKEN_COLOR = {
  keyword: "#c084fc",
  type:    "#67e8f9",
  fn:      "#93c5fd",
  string:  "#86efac",
  number:  "#fca5a5",
  comment: "#4b5563",
  tag:     "#f9a8d4",
  attr:    "#fde68a",
  plain:   "#e2e8f0",
};

/* ── Coverage colors ─────────────────────────────────────── */
const COV_GUTTER = {
  covered:   "#3fb950",
  uncovered: "#f85149",
  partial:   "#d29922",
};

const COV_BG = {
  covered:   "rgba(63,185,80,0.05)",
  uncovered: "rgba(248,81,73,0.06)",
  partial:   "rgba(210,153,34,0.05)",
};

/* ── File Tab ────────────────────────────────────────────── */
function Tab({ tab, isActive, onSelect, onClose }) {
  const [hovered, setHovered] = useState(false);

  // File icon color by extension
  const getTabColor = (name) => {
    if (name.endsWith(".tsx") || name.endsWith(".jsx")) return "#61dafb";
    if (name.endsWith(".ts"))  return "#3b82f6";
    if (name.endsWith(".js"))  return "#fbbf24";
    if (name.endsWith(".css")) return "#38bdf8";
    return "#8b949e";
  };

  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -8, width: 0 }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={() => onSelect(tab.id)}
      className="relative flex items-center gap-2 h-full cursor-pointer select-none"
      style={{
        minWidth: 110,
        maxWidth: 180,
        padding: "0 16px",
        background: isActive ? "var(--ide-bg)" : "transparent",
        color: isActive ? "#e6edf3" : "#6e7681",
        borderRight: "1px solid var(--ide-border)",
        fontFamily: "var(--font-sans)",
        fontSize: 12.5,
        transition: "background 0.15s ease",
      }}
      id={`tab-${tab.id}`}
    >
      {/* Top indicator line */}
      {isActive && (
        <motion.div
          layoutId="tab-top-indicator"
          className="absolute top-0 left-0 right-0"
          style={{ height: 1.5, background: "#7c3aed", boxShadow: "0 0 8px rgba(124,58,237,0.6)" }}
        />
      )}

      {/* Unsaved dot */}
      {tab.unsaved && (
        <div
          style={{
            width: 5,
            height: 5,
            borderRadius: "50%",
            background: "#a78bfa",
            flexShrink: 0,
          }}
        />
      )}

      {/* Filename with color */}
      <span
        className="truncate"
        style={{ color: isActive ? getTabColor(tab.name) : undefined }}
      >
        {tab.name}
      </span>

      {/* Close button */}
      <motion.button
        animate={{ opacity: hovered || isActive ? 1 : 0 }}
        transition={{ duration: 0.1 }}
        onClick={(e) => { e.stopPropagation(); onClose(tab.id); }}
        whileHover={{ background: "rgba(255,255,255,0.1)" }}
        whileTap={{ scale: 0.85 }}
        className="ml-auto p-0.5 rounded flex-shrink-0"
        style={{ color: "#6e7681", lineHeight: 0 }}
      >
        <X size={12} />
      </motion.button>
    </motion.div>
  );
}

/* ── Coverage Pill Overlay ───────────────────────────────── */
function CoverageOverlay() {
  const metrics = [
    { label: "Lines",      value: 84, color: "#c084fc" },
    { label: "Branches",   value: 71, color: "#67e8f9" },
    { label: "Functions",  value: 89, color: "#86efac" },
    { label: "Statements", value: 82, color: "#fca5a5" },
  ];

  return (
    <div
      className="flex items-center flex-shrink-0"
      style={{
        gap: 20,
        padding: "8px 20px",
        borderTop: "1px solid var(--ide-border)",
        background: "linear-gradient(0deg, rgba(124,58,237,0.04) 0%, transparent 100%)",
        fontFamily: "var(--font-mono)",
        fontSize: 12,
      }}
    >
      <div className="flex items-center gap-1.5">
        <BarChart3 size={12} style={{ color: "#a78bfa" }} />
        <span style={{ color: "#a78bfa", fontWeight: 600 }}>Coverage</span>
      </div>
      {metrics.map((m) => (
        <div key={m.label} className="flex items-center gap-1.5">
          <span style={{ color: "#484f58" }}>{m.label}:</span>
          <div
            className="overflow-hidden rounded-full"
            style={{ width: 36, height: 3, background: "rgba(255,255,255,0.06)" }}
          >
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${m.value}%` }}
              transition={{ delay: 0.6, duration: 0.9, ease: "easeOut" }}
              style={{ height: "100%", background: m.color, borderRadius: 9999 }}
            />
          </div>
          <span style={{ color: m.color, fontWeight: 600 }}>{m.value}%</span>
        </div>
      ))}
      <div className="ml-auto flex items-center gap-1.5" style={{ color: "#484f58" }}>
        <GitBranch size={11} />
        <span>main</span>
        <Zap size={11} style={{ color: "#fde68a", marginLeft: 6 }} />
        <span style={{ color: "#fde68a" }}>AI Ready</span>
      </div>
    </div>
  );
}

/* ── Code Line ───────────────────────────────────────────── */
function CodeLine({ line }) {
  return (
    <div
      className="flex items-stretch group"
      style={{
        background: line.cov ? COV_BG[line.cov] : "transparent",
        paddingRight: 16,
        minHeight: 22,
      }}
    >
      {/* Gutter coverage dot */}
      <div
        style={{
          width: 3,
          flexShrink: 0,
          background: line.cov ? COV_GUTTER[line.cov] : "transparent",
        }}
      />

      {/* Line number */}
      <div
        className="select-none text-right flex-shrink-0"
        style={{
          width: 60,
          paddingRight: 20,
          paddingTop: 2,
          color: line.cov ? (line.cov === "uncovered" ? "#6b2d2d" : "#3b4048") : "var(--ide-line-num)",
          fontFamily: "var(--font-mono)",
          fontSize: 13,
          lineHeight: "1.6",
        }}
      >
        {line.n}
      </div>

      {/* Code tokens */}
      <div
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 13,
          lineHeight: "1.6",
          whiteSpace: "pre",
          paddingTop: 2,
          paddingLeft: 4,
        }}
      >
        {line.tokens.length === 0 ? (
          <span>&nbsp;</span>
        ) : (
          line.tokens.map((tok, i) => (
            <span key={i} style={{ color: TOKEN_COLOR[tok.t] || TOKEN_COLOR.plain }}>
              {tok.v}
            </span>
          ))
        )}
      </div>
    </div>
  );
}

/* ── Editor ─────────────────────────────────────────────── */
export default function Editor({ tabs, activeTabId, onSelectTab, onCloseTab }) {
  const fileData = FILES_CODE[activeTabId] || FILES_CODE["dashboard-tsx"];

  return (
    <motion.div
      className="flex flex-col flex-1 h-full min-w-0"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3, delay: 0.1 }}
      style={{ background: "var(--ide-bg)" }}
    >
      {/* ── Tab Bar ──────────────────────────────────────── */}
      <div
        className="flex items-end overflow-x-auto flex-shrink-0"
        style={{
          height: 44,
          background: "var(--ide-tabbar)",
          borderBottom: "1px solid var(--ide-border)",
        }}
      >
        <AnimatePresence mode="popLayout">
          {tabs.map((tab) => (
            <Tab
              key={tab.id}
              tab={tab}
              isActive={tab.id === activeTabId}
              onSelect={onSelectTab}
              onClose={onCloseTab}
            />
          ))}
        </AnimatePresence>
      </div>

      {/* ── Breadcrumb ────────────────────────────────────── */}
      <div
        className="flex items-center flex-shrink-0"
        style={{
          borderBottom: "1px solid var(--ide-border)",
          color: "#484f58",
          fontFamily: "var(--font-sans)",
          background: "var(--ide-bg)",
          fontSize: 12,
          padding: "6px 20px",
        }}
      >
        {fileData.breadcrumb.map((crumb, i) => (
          <span key={i} className="flex items-center">
            {i > 0 && <ChevronRight size={11} style={{ margin: "0 3px", opacity: 0.4 }} />}
            <span
              style={{
                color: i === fileData.breadcrumb.length - 1 ? "#8b949e" : "#484f58",
              }}
            >
              {crumb}
            </span>
          </span>
        ))}
      </div>

      {/* ── Code Area ─────────────────────────────────────── */}
      <div className="flex-1 overflow-auto relative">
        <AnimatePresence mode="wait">
          <motion.div
            key={activeTabId}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="py-2"
          >
            {fileData.lines.map((line) => (
              <CodeLine key={line.n} line={line} />
            ))}
          </motion.div>
        </AnimatePresence>

        {/* Coverage pill — bottom-right floating */}
        <motion.div
          initial={{ opacity: 0, scale: 0.9, y: 8 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ delay: 0.8, duration: 0.4, ease: "easeOut" }}
          className="absolute bottom-5 right-5"
          style={{ zIndex: 10 }}
        >
          <div
            className="flex items-center gap-2 px-4 py-2 rounded-full"
            style={{
              background: "rgba(13,17,23,0.85)",
              backdropFilter: "blur(20px)",
              WebkitBackdropFilter: "blur(20px)",
              border: "1px solid rgba(124,58,237,0.25)",
              boxShadow: "0 0 20px rgba(124,58,237,0.15), 0 8px 32px rgba(0,0,0,0.5)",
              fontSize: 12,
              fontFamily: "var(--font-mono)",
            }}
          >
            <div
              className="animate-pulse"
              style={{
                width: 7,
                height: 7,
                borderRadius: "50%",
                background: "#3fb950",
                boxShadow: "0 0 8px rgba(63,185,80,0.8)",
                animationDuration: "1.5s",
              }}
            />
            <span style={{ color: "#8b949e" }}>Test Coverage:</span>
            <span style={{ color: "#a78bfa", fontWeight: 600 }}>84%</span>
          </div>
        </motion.div>
      </div>

      {/* ── Coverage Bottom Bar ────────────────────────────── */}
      <CoverageOverlay />
    </motion.div>
  );
}
