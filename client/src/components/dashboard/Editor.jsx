import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Circle, BarChart3, GitBranch, Zap } from "lucide-react";

/* ── Sample code snippets per "file" ───────────────────── */
const FILE_CODE = {
  default: {
    name: "Dashboard.tsx",
    lang: "tsx",
    lines: [
      { n: 1,  tokens: [{ t: "keyword", v: "import" }, { t: "plain", v: " { useState, useEffect } " }, { t: "keyword", v: "from" }, { t: "string", v: " 'react'" }, { t: "plain", v: ";" }] },
      { n: 2,  tokens: [{ t: "keyword", v: "import" }, { t: "plain", v: " { motion } " }, { t: "keyword", v: "from" }, { t: "string", v: " 'framer-motion'" }, { t: "plain", v: ";" }] },
      { n: 3,  tokens: [] },
      { n: 4,  tokens: [{ t: "comment", v: "// 🤖 TestCovAI — AI-powered Test Coverage Platform" }] },
      { n: 5,  tokens: [{ t: "keyword", v: "interface" }, { t: "type", v: " CoverageSummary" }, { t: "plain", v: " {" }] },
      { n: 6,  tokens: [{ t: "plain", v: "  lines" }, { t: "plain", v: ": " }, { t: "type", v: "number" }, { t: "plain", v: ";" }] },
      { n: 7,  tokens: [{ t: "plain", v: "  branches" }, { t: "plain", v: ": " }, { t: "type", v: "number" }, { t: "plain", v: ";" }] },
      { n: 8,  tokens: [{ t: "plain", v: "  functions" }, { t: "plain", v: ": " }, { t: "type", v: "number" }, { t: "plain", v: ";" }] },
      { n: 9,  tokens: [{ t: "plain", v: "  statements" }, { t: "plain", v: ": " }, { t: "type", v: "number" }, { t: "plain", v: ";" }] },
      { n: 10, tokens: [{ t: "plain", v: "}" }] },
      { n: 11, tokens: [] },
      { n: 12, tokens: [{ t: "keyword", v: "const" }, { t: "fn", v: " Dashboard" }, { t: "plain", v: " = () => {" }] },
      { n: 13, tokens: [{ t: "keyword", v: "  const" }, { t: "plain", v: " [coverage, setCoverage] = " }, { t: "fn", v: "useState" }, { t: "plain", v: "<" }, { t: "type", v: "CoverageSummary" }, { t: "plain", v: ">({" }] },
      { n: 14, tokens: [{ t: "plain", v: "    lines: " }, { t: "number", v: "84" }, { t: "plain", v: "," }] },
      { n: 15, tokens: [{ t: "plain", v: "    branches: " }, { t: "number", v: "71" }, { t: "plain", v: "," }] },
      { n: 16, tokens: [{ t: "plain", v: "    functions: " }, { t: "number", v: "89" }, { t: "plain", v: "," }] },
      { n: 17, tokens: [{ t: "plain", v: "    statements: " }, { t: "number", v: "82" }, { t: "plain", v: "," }] },
      { n: 18, tokens: [{ t: "plain", v: "  });" }] },
      { n: 19, tokens: [] },
      { n: 20, tokens: [{ t: "fn", v: "  useEffect" }, { t: "plain", v: "(() => {" }] },
      { n: 21, tokens: [{ t: "fn", v: "    fetchCoverage" }, { t: "plain", v: "();" }] },
      { n: 22, tokens: [{ t: "plain", v: "  }, []);" }] },
      { n: 23, tokens: [] },
      { n: 24, tokens: [{ t: "keyword", v: "  return" }, { t: "plain", v: " (" }] },
      { n: 25, tokens: [{ t: "tag", v: "    <motion.div" }] },
      { n: 26, tokens: [{ t: "attr", v: "      initial" }, { t: "plain", v: "={{ opacity: " }, { t: "number", v: "0" }, { t: "plain", v: " }}" }] },
      { n: 27, tokens: [{ t: "attr", v: "      animate" }, { t: "plain", v: "={{ opacity: " }, { t: "number", v: "1" }, { t: "plain", v: " }}" }] },
      { n: 28, tokens: [{ t: "tag", v: "    >" }] },
      { n: 29, tokens: [{ t: "tag", v: "      <CoverageCard" }, { t: "attr", v: " data" }, { t: "plain", v: "={coverage} " }, { t: "tag", v: "/>" }] },
      { n: 30, tokens: [{ t: "tag", v: "    </motion.div>" }] },
      { n: 31, tokens: [{ t: "plain", v: "  );" }] },
      { n: 32, tokens: [{ t: "plain", v: "};" }] },
      { n: 33, tokens: [] },
      { n: 34, tokens: [{ t: "keyword", v: "export default" }, { t: "plain", v: " Dashboard;" }] },
    ],
  },
};

/* ── Token color map ────────────────────────────────────── */
const TOKEN_COLOR = {
  keyword: "#C084FC",
  type:    "#67E8F9",
  fn:      "#93C5FD",
  string:  "#86EFAC",
  number:  "#FCA5A5",
  comment: "#4B5563",
  tag:     "#F9A8D4",
  attr:    "#FDE68A",
  plain:   "#E2E8F0",
};

/* ── Tab component ──────────────────────────────────────── */
function Tab({ tab, isActive, onSelect, onClose }) {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -10 }}
      onClick={() => onSelect(tab.id)}
      className="relative flex items-center gap-2 px-4 h-full cursor-pointer group text-sm select-none"
      style={{
        minWidth: 120,
        maxWidth: 180,
        background: isActive ? "var(--ide-active-tab)" : "transparent",
        color: isActive ? "var(--text-primary)" : "var(--text-secondary)",
        borderRight: "1px solid var(--ide-border)",
        fontFamily: "var(--font-sans)",
        fontSize: 13,
      }}
      id={`tab-${tab.id}`}
    >
      {/* Top indicator */}
      {isActive && (
        <motion.div
          layoutId="tab-indicator"
          className="absolute top-0 left-0 right-0 h-0.5"
          style={{ background: "var(--primary)" }}
        />
      )}
      {/* Dot for unsaved */}
      <Circle size={7} className="opacity-40 flex-shrink-0" style={{ fill: tab.unsaved ? "var(--primary-light)" : "transparent", color: tab.unsaved ? "var(--primary-light)" : "transparent" }} />
      <span className="truncate">{tab.name}</span>
      <button
        onClick={(e) => { e.stopPropagation(); onClose(tab.id); }}
        className="ml-auto opacity-0 group-hover:opacity-100 hover:text-white transition-opacity rounded p-0.5"
        style={{ color: "var(--text-secondary)" }}
      >
        <X size={12} />
      </button>
    </motion.div>
  );
}

/* ── Coverage overlay bar ───────────────────────────────── */
function CoverageOverlay() {
  const metrics = [
    { label: "Lines", value: 84, color: "#C084FC" },
    { label: "Branches", value: 71, color: "#67E8F9" },
    { label: "Functions", value: 89, color: "#86EFAC" },
    { label: "Statements", value: 82, color: "#FCA5A5" },
  ];

  return (
    <div
      className="flex items-center gap-4 px-5 py-2.5"
      style={{
        borderTop: "1px solid var(--ide-border)",
        background: "linear-gradient(0deg, rgba(124,58,237,0.06) 0%, transparent 100%)",
        fontFamily: "var(--font-mono)",
        fontSize: 12,
      }}
    >
      <div className="flex items-center gap-1.5" style={{ color: "var(--text-muted)" }}>
        <BarChart3 size={13} style={{ color: "var(--primary-light)" }} />
        <span style={{ color: "var(--primary-light)", fontWeight: 500 }}>Coverage</span>
      </div>
      {metrics.map((m) => (
        <div key={m.label} className="flex items-center gap-2">
          <span style={{ color: "var(--text-muted)" }}>{m.label}:</span>
          <div className="flex items-center gap-1">
            <div
              className="h-1 rounded-full"
              style={{
                width: 32,
                background: "rgba(255,255,255,0.1)",
                position: "relative",
                overflow: "hidden",
              }}
            >
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${m.value}%` }}
                transition={{ delay: 0.5, duration: 0.8, ease: "easeOut" }}
                className="absolute inset-y-0 left-0 rounded-full"
                style={{ background: m.color }}
              />
            </div>
            <span style={{ color: m.color, fontWeight: 600 }}>{m.value}%</span>
          </div>
        </div>
      ))}
      <div className="ml-auto flex items-center gap-1.5" style={{ color: "var(--text-muted)" }}>
        <GitBranch size={12} />
        <span>main</span>
        <Zap size={12} style={{ color: "#FDE68A", marginLeft: 8 }} />
        <span style={{ color: "#FDE68A" }}>AI Ready</span>
      </div>
    </div>
  );
}

/* ── Code line ──────────────────────────────────────────── */
function CodeLine({ line, isHighlighted }) {
  return (
    <div
      className="flex items-start group"
      style={{
        background: isHighlighted ? "rgba(124,58,237,0.08)" : "transparent",
        paddingRight: 16,
      }}
    >
      {/* Line number */}
      <div
        className="select-none text-right pr-5 pt-0.5 flex-shrink-0"
        style={{
          width: 56,
          color: isHighlighted ? "var(--text-muted)" : "var(--ide-line-num)",
          fontFamily: "var(--font-mono)",
          fontSize: 13,
          lineHeight: "1.6",
        }}
      >
        {line.n}
      </div>
      {/* Code */}
      <div
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 13,
          lineHeight: "1.6",
          whiteSpace: "pre",
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
  const activeFile = FILE_CODE.default;

  return (
    <div
      className="flex flex-col flex-1 h-full"
      style={{ background: "var(--ide-bg)", minWidth: 0 }}
    >
      {/* Tab bar */}
      <div
        className="flex items-end overflow-x-auto flex-shrink-0"
        style={{
          height: 42,
          background: "var(--ide-tabbar)",
          borderBottom: "1px solid var(--ide-border)",
        }}
      >
        <AnimatePresence>
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

      {/* Breadcrumb */}
      <div
        className="flex items-center px-5 py-2 text-xs flex-shrink-0"
        style={{
          borderBottom: "1px solid var(--ide-border)",
          color: "var(--text-muted)",
          fontFamily: "var(--font-sans)",
          background: "var(--ide-bg)",
        }}
      >
        <span>src</span>
        <span className="mx-1">/</span>
        <span>pages</span>
        <span className="mx-1">/</span>
        <span style={{ color: "var(--text-secondary)" }}>{activeFile.name}</span>
      </div>

      {/* Code area — scrollable */}
      <div className="flex-1 overflow-auto">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.2 }}
          className="py-3"
        >
          {activeFile.lines.map((line) => (
            <CodeLine
              key={line.n}
              line={line}
              isHighlighted={line.n === 14 || line.n === 29}
            />
          ))}
        </motion.div>
      </div>

      {/* Coverage overlay */}
      <CoverageOverlay />
    </div>
  );
}
