import React, { useState, useEffect, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import dagre from "dagre";
import {
  X, Sparkles, Info, ZoomIn, ZoomOut, GitBranch, ArrowLeft, TerminalSquare, Network
} from "lucide-react";
import { getProjectCfgApi, getProjectCcApi, getFileContentApi } from "../../services/project.service.js";

/* --- ANIMATION VARIANTS --- */
const containerVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.4, ease: "easeOut" } },
  exit: { opacity: 0, y: 20, transition: { duration: 0.3 } },
};

function syntaxHighlight(text) {
  return text
    .split(/(\bfunction\b|\bif\b|\belse\b|\breturn\b|\bconst\b|\blet\b|\bvar\b|"[^"]*"|\b\d+\b)/g)
    .map((part, i) => {
      if (["function", "if", "else", "return", "const", "let", "var"].includes(part))
        return <span key={i} style={{ color: "#c084fc" }}>{part}</span>;
      if (part.startsWith('"') || part.startsWith("'"))
        return <span key={i} style={{ color: "#86efac" }}>{part}</span>;
      if (/^\d+$/.test(part))
        return <span key={i} style={{ color: "#fca5a5" }}>{part}</span>;
      return <span key={i} style={{ color: "#e2e8f0" }}>{part}</span>;
    });
}

function computeLayout(nodes, edges) {
  if (!nodes || nodes.length === 0) return { nodes: [], edges: [] };
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: 'TB', marginx: 40, marginy: 40, nodesep: 60, ranksep: 80 });
  g.setDefaultEdgeLabel(() => ({}));

  nodes.forEach(n => {
    // Label length heuristic for width
    const label = n.label || n.type || n.id;
    const width = Math.max(120, label.length * 8 + 40);
    g.setNode(n.id, { width, height: 40 });
  });

  edges.forEach(e => {
    g.setEdge(e.from, e.to);
  });

  dagre.layout(g);

  return {
    nodes: nodes.map(n => {
      const pos = g.node(n.id);
      return { ...n, x: pos.x, y: pos.y, width: pos.width };
    }),
    edges: edges.map(e => {
      const edgePos = g.edge(e.from, e.to);
      return { ...e, points: edgePos.points };
    })
  };
}

const pointsToSvgPath = (points) => {
  if (!points || points.length === 0) return "";
  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length; i++) {
    d += ` L ${points[i].x} ${points[i].y}`;
  }
  return d;
};

/* --- NODE COMPONENTS --- */
function FuncNode({ label, x, y, onClick }) {
  return (
    <motion.div
      onClick={onClick}
      className="flex items-center justify-center font-mono select-none cursor-pointer"
      initial={{ x: "-50%", y: "-50%", scale: 1 }}
      whileHover={{ scale: 1.05, x: "-50%", y: "-50%", boxShadow: "0 0 20px rgba(34, 211, 238, 0.3)" }}
      whileTap={{ scale: 0.95, x: "-50%", y: "-50%" }}
      style={{
        position: "absolute", left: x, top: y, zIndex: 10,
        fontSize: "13px", padding: "12px 28px", borderRadius: "8px",
        background: "rgba(34, 211, 238, 0.08)", border: "1px solid rgba(34, 211, 238, 0.4)",
        color: "#67e8f9", backdropFilter: "blur(4px)", whiteSpace: "nowrap"
      }}
    >
      <Network size={15} style={{ marginRight: "8px", opacity: 0.8 }} />
      {label}()
    </motion.div>
  );
}

function CFGNode({ label, line, x, y, active = false, isDiamond = false, width = 120 }) {
  return (
    <motion.div
      initial={{ x: "-50%", y: "-50%", scale: 0.8, opacity: 0 }}
      animate={
        active
          ? { x: "-50%", y: "-50%", scale: [1, 1.05, 1], opacity: 1 }
          : { x: "-50%", y: "-50%", scale: 1, opacity: 1 }
      }
      transition={{
        scale: active ? { repeat: Infinity, duration: 2 } : { duration: 0.3 },
        default: { duration: 0.3 }
      }}
      className="flex items-center justify-center font-mono select-none text-center"
      style={{
        position: "absolute", left: x, top: y, zIndex: 10,
        fontSize: "13px", padding: isDiamond ? "10px 24px" : "10px 24px",
        borderRadius: isDiamond ? "8px" : "9999px", minWidth: `${width}px`,
        background: active ? "rgba(124, 58, 237, 0.15)" : "#161B22",
        border: active ? "1px solid #7C3AED" : "1px solid rgba(255,255,255,0.1)",
        color: active ? "#c4b5fd" : "#c9d1d9",
        boxShadow: active ? "0 0 25px rgba(124,58,237,0.25)" : "0 4px 12px rgba(0,0,0,0.4)",
      }}
    >
      {active && <span className="absolute animate-ping" style={{ left: "-8px", width: "12px", height: "12px", borderRadius: "50%", background: "#7C3AED" }} />}
      {isDiamond && <GitBranch size={14} style={{ marginRight: "8px", opacity: 0.7 }} />}
      {label} {line ? <span style={{ opacity: 0.5, fontSize: "11px", marginLeft: "6px" }}>(L{line})</span> : ""}
    </motion.div>
  );
}

export default function CFGCalculator({ project, onClose }) {
  const [cfgs, setCfgs] = useState([]);
  const [ccs, setCcs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [selectedFile, setSelectedFile] = useState(null);
  const [selectedFunc, setSelectedFunc] = useState(null);
  const [sourceCode, setSourceCode] = useState("");
  const [zoom, setZoom] = useState(1);

  useEffect(() => {
    async function fetchData() {
      try {
        setLoading(true);
        // Using snapshotId empty to default to latest snapshot
        const [cfgRes, ccRes] = await Promise.all([
          getProjectCfgApi(project.id, ""),
          getProjectCcApi(project.id, "")
        ]);
        setCfgs(cfgRes.data);
        setCcs(ccRes.data);

        if (cfgRes.data.length > 0) {
          const firstFile = [...new Set(cfgRes.data.map(c => c.filePath))][0];
          setSelectedFile(firstFile);
        }
      } catch (err) {
        setError(err.message || "Failed to fetch CFG/CC data");
      } finally {
        setLoading(false);
      }
    }
    if (project?.id) fetchData();
  }, [project]);

  useEffect(() => {
    async function fetchCode() {
      if (selectedFile && project?.id) {
        try {
          const res = await getFileContentApi(project.id, selectedFile);
          setSourceCode(res.data.content);
        } catch (err) {
          setSourceCode("// Failed to load source code");
        }
      }
    }
    fetchCode();
  }, [selectedFile, project]);

  const uniqueFiles = useMemo(() => {
    return [...new Set(cfgs.map(c => c.filePath))];
  }, [cfgs]);

  const fileCfgs = useMemo(() => {
    return cfgs.filter(c => c.filePath === selectedFile);
  }, [cfgs, selectedFile]);

  const fileCcs = useMemo(() => {
    return ccs.filter(c => c.filePath === selectedFile);
  }, [ccs, selectedFile]);

  const activeCfg = useMemo(() => {
    return fileCfgs.find(c => c.functionName === selectedFunc);
  }, [fileCfgs, selectedFunc]);

  const activeCc = useMemo(() => {
    return fileCcs.find(c => c.functionName === selectedFunc);
  }, [fileCcs, selectedFunc]);

  const maxCc = useMemo(() => {
    if (fileCcs.length === 0) return 0;
    return Math.max(...fileCcs.map(c => c.value));
  }, [fileCcs]);

  const isCallGraph = selectedFunc === null;

  // Process source code lines
  const sourceLines = useMemo(() => {
    return sourceCode.split('\n').map((text, i) => ({ num: i + 1, text }));
  }, [sourceCode]);

  // DAGRE Layouts
  const graphLayout = useMemo(() => {
    if (isCallGraph) {
      // Just layout the functions side by side or vertically
      const nodes = fileCfgs.map((c, i) => ({ id: c.functionName, label: c.functionName }));
      const edges = [];
      // Create a dummy chain so dagre lays them out nicely vertically
      for(let i=0; i<nodes.length-1; i++) edges.push({ from: nodes[i].id, to: nodes[i+1].id });
      return computeLayout(nodes, edges);
    } else {
      if (!activeCfg || !activeCfg.graphJson) return { nodes: [], edges: [] };
      try {
        const parsed = JSON.parse(activeCfg.graphJson);
        let nodes = parsed.nodes || [];
        let edges = parsed.edges || [];

        // Add virtual exit node to conform to standard McCabe CFG calculation
        if (nodes.length > 0) {
          const fromNodeIds = new Set(edges.map(e => e.from));
          const leafNodes = nodes.filter(n => !fromNodeIds.has(n.id));

          if (leafNodes.length > 0) {
            const exitNodeId = "virtual_exit_node";
            nodes = [...nodes, { id: exitNodeId, type: "exit", label: "Virtual Exit" }];
            leafNodes.forEach(leaf => {
              edges = [...edges, { from: leaf.id, to: exitNodeId }];
            });
          }
        }

        return computeLayout(nodes, edges);
      } catch (e) {
        return { nodes: [], edges: [] };
      }
    }
  }, [isCallGraph, fileCfgs, activeCfg]);

  return (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="visible"
      exit="exit"
      className="fixed inset-0 z-50 flex flex-col"
      style={{ background: "#0D1117", fontFamily: "var(--font-sans)", color: "#F0F6FC" }}
    >
      {/* --- HEADER --- */}
      <div
        className="flex items-center justify-between flex-shrink-0"
        style={{ padding: "0 24px", height: "56px", background: "#161B22", borderBottom: "1px solid rgba(255,255,255,0.08)" }}
      >
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            {["#ff5f57", "#febc2e", "#28c840"].map((color, i) => (
              <div key={i} onClick={i === 0 ? onClose : undefined} className="cursor-pointer hover:scale-110 transition-transform" style={{ width: "14px", height: "14px", borderRadius: "50%", background: color, boxShadow: `0 0 4px ${color}60` }} />
            ))}
          </div>
          <div style={{ width: "1px", height: "20px", background: "rgba(255,255,255,0.1)" }} />
          <div className="flex items-center gap-4">
            <select
              value={selectedFile || ""}
              onChange={(e) => { setSelectedFile(e.target.value); setSelectedFunc(null); }}
              style={{ 
                background: "rgba(255,255,255,0.08)", 
                color: "#c9d1d9", 
                border: "1px solid rgba(255,255,255,0.12)", 
                borderRadius: "6px", 
                padding: "6px 12px", 
                fontSize: "13px", 
                outline: "none",
                cursor: "pointer",
                boxShadow: "0 2px 8px rgba(0,0,0,0.2)",
                fontFamily: "monospace"
              }}
              onMouseOver={(e) => e.currentTarget.style.background = "rgba(255,255,255,0.12)"}
              onMouseOut={(e) => e.currentTarget.style.background = "rgba(255,255,255,0.08)"}
            >
              {uniqueFiles.map(f => (
                <option key={f} value={f} style={{ background: "#0D1117", color: "#c9d1d9", padding: "8px" }}>
                  {f}
                </option>
              ))}
            </select>
            <div className="flex items-center gap-2 text-sm text-[#8B949E]">
              {!isCallGraph && (
                <>
                  <span style={{ color: "rgba(255,255,255,0.3)" }}>/</span>
                  <span style={{ color: "#A78BFA", fontFamily: "monospace", fontWeight: "bold" }}>{selectedFunc}()</span>
                </>
              )}
            </div>
          </div>
        </div>
        <button
          className="transition-colors cursor-pointer"
          onClick={onClose}
          style={{ padding: "6px", color: "#8B949E", background: "transparent", border: "none", borderRadius: "6px" }}
          onMouseOver={(e) => { e.currentTarget.style.color = "#ff5f57"; e.currentTarget.style.background = "rgba(255,255,255,0.05)"; }}
          onMouseOut={(e) => { e.currentTarget.style.color = "#8B949E"; e.currentTarget.style.background = "transparent"; }}
        >
          <X size={20} />
        </button>
      </div>

      {loading ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>Loading analysis data...</div>
      ) : error ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#ef4444' }}>{error}</div>
      ) : (
        /* --- MAIN CONTENT --- */
        <div style={{ flex: 1, display: "flex", overflowX: "auto", overflowY: "hidden", background: "#0D1117", width: "100%" }}>
          <div style={{ display: "flex", height: "100%", minWidth: "1350px", width: "100%" }}>

            {/* LEFT COLUMN: Source Code */}
            <div style={{ width: "420px", flexShrink: 0, display: "flex", flexDirection: "column", borderRight: "1px solid rgba(255,255,255,0.05)", background: "#0D1117" }}>
              <div style={{ padding: "20px 32px", fontSize: "11px", letterSpacing: "0.2em", color: "#8B949E", textTransform: "uppercase", fontWeight: "bold", display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "1px solid rgba(255,255,255,0.05)", background: "rgba(22,27,34,0.5)" }}>
                <span>Source Code</span>
                <span style={{ background: "rgba(255,255,255,0.1)", padding: "4px 10px", borderRadius: "6px", fontSize: "10px", color: "#fff" }}>JS/TS</span>
              </div>
              <div style={{ flex: 1, overflowY: "auto", padding: "24px 0", fontFamily: "monospace", fontSize: "14px", lineHeight: "1.8" }}>
                {sourceLines.map((line) => {
                  const isActiveScope = activeCfg && line.num >= activeCfg.startLine && line.num <= activeCfg.endLine;
                  const isDimmed = !isCallGraph && !isActiveScope;
                  
                  return (
                    <div
                      key={line.num}
                      style={{
                        display: "flex",
                        alignItems: "flex-start",
                        padding: "4px 32px",
                        background: isActiveScope ? "rgba(124, 58, 237, 0.08)" : "transparent",
                        borderLeft: isActiveScope ? "3px solid #7C3AED" : "3px solid transparent",
                        opacity: isDimmed ? 0.3 : 1,
                        transition: "background-color 0.3s, opacity 0.3s"
                      }}
                    >
                      <span style={{ width: "40px", flexShrink: 0, textAlign: "right", paddingRight: "24px", userSelect: "none", color: isActiveScope ? "#A78BFA" : "#484F58" }}>
                        {line.num}
                      </span>
                      <span style={{ whiteSpace: "pre-wrap", wordBreak: 'break-word', flex: 1 }}>
                        {syntaxHighlight(line.text)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* MIDDLE COLUMN: Graph Area */}
            <div style={{ flex: 1, minWidth: "550px", display: "flex", flexDirection: "column", borderRight: "1px solid rgba(255,255,255,0.05)", background: "#0D1117", position: "relative" }}>
              <div style={{ padding: "20px 32px", fontSize: "11px", letterSpacing: "0.2em", color: "#8B949E", textTransform: "uppercase", fontWeight: "bold", display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "1px solid rgba(255,255,255,0.05)", zIndex: 20, background: "rgba(22,27,34,0.5)" }}>
                <div className="flex items-center gap-3">
                  {!isCallGraph && (
                    <motion.button
                      whileHover={{ x: -3 }}
                      onClick={() => setSelectedFunc(null)}
                      className="cursor-pointer"
                      style={{ display: "flex", alignItems: "center", gap: "6px", color: "#C4B5FD", background: "transparent", border: "none", fontWeight: "bold" }}
                    >
                      <ArrowLeft size={16} /> Back
                    </motion.button>
                  )}
                  <span style={{ color: "rgba(255,255,255,0.8)" }}>{isCallGraph ? "Functions in File" : "Control Flow Graph"}</span>
                </div>
                <div className="flex items-center gap-3">
                  <ZoomOut size={16} onClick={() => setZoom(z => Math.max(z - 0.2, 0.2))} style={{ cursor: "pointer", color: "#8B949E" }} />
                  <span style={{ fontSize: "11px", color: "#8B949E", width: "36px", textAlign: "center", fontFamily: "monospace", fontWeight: "bold" }}>{Math.round(zoom * 100)}%</span>
                  <ZoomIn size={16} onClick={() => setZoom(z => Math.min(z + 0.2, 3))} style={{ cursor: "pointer", color: "#8B949E" }} />
                </div>
              </div>

              <div
                style={{ flex: 1, position: "relative", overflow: "hidden", background: "radial-gradient(ellipse at center, rgba(255,255,255,0.03) 0%, transparent 100%)", display: "flex", alignItems: "center", justifyContent: "center" }}
                onWheel={(e) => {
                  const delta = e.deltaY > 0 ? -0.05 : 0.05;
                  setZoom(z => Math.min(Math.max(z + delta, 0.2), 3));
                }}
              >
                <motion.div
                  drag
                  dragConstraints={{ left: -1000, right: 1000, top: -1000, bottom: 1000 }}
                  dragElastic={0.1}
                  style={{
                    scale: zoom,
                    cursor: "grab",
                    position: "absolute",
                    left: "-50%",
                    top: "-50%",
                    width: "200%",
                    height: "200%",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center"
                  }}
                  whileTap={{ cursor: "grabbing" }}
                >
                  <AnimatePresence mode="wait">
                    {isCallGraph ? (
                      /* --- CALL GRAPH --- */
                      <motion.div
                        key="call-graph"
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 1.05 }}
                        transition={{ duration: 0.3 }}
                        style={{ position: "relative", width: "100%", height: "100%" }}
                      >
                        {/* We center the nodes generated by dagre */}
                        <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', width: 800, height: 800 }}>
                          {graphLayout.nodes.map(n => (
                            <FuncNode key={n.id} label={n.id} x={n.x} y={n.y} onClick={() => setSelectedFunc(n.id)} />
                          ))}
                        </div>

                        <div style={{ position: "absolute", bottom: "20%", left: "50%", transform: "translateX(-50%)", fontSize: "13px", color: "#8B949E", background: "#161B22", padding: "12px 24px", borderRadius: "9999px", border: "1px solid rgba(255,255,255,0.1)", boxShadow: "0 10px 25px rgba(0,0,0,0.5)", display: "flex", alignItems: "center", gap: "8px", whiteSpace: "nowrap" }}>
                          <Sparkles size={16} color="#22D3EE" />
                          Click a function node to analyze its CFG
                        </div>
                      </motion.div>
                    ) : (
                      /* --- CFG --- */
                      <motion.div
                        key="cfg"
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 1.05 }}
                        transition={{ duration: 0.3 }}
                        style={{ position: "relative", width: "100%", height: "100%" }}
                      >
                        <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', width: 800, height: 800 }}>
                          <svg width="100%" height="100%" style={{ position: "absolute", inset: 0, pointerEvents: "none", overflow: "visible" }}>
                            <defs>
                              <marker id="arrowhead" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
                                <polygon points="0 0, 10 3.5, 0 7" fill="rgba(255,255,255,0.4)" />
                              </marker>
                            </defs>
                            {graphLayout.edges.map((e, i) => (
                              <path key={i} d={pointsToSvgPath(e.points)} fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth="1.5" markerEnd="url(#arrowhead)" />
                            ))}
                          </svg>

                          {graphLayout.nodes.map(n => (
                            <CFGNode key={n.id} label={n.label || n.type || n.id} line={n.line} x={n.x} y={n.y} width={n.width} isDiamond={n.type === 'condition'} active={n.type === 'start' || n.type === 'return' || n.type === 'exit'} />
                          ))}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              </div>
            </div>

            {/* RIGHT COLUMN: Metrics */}
            <div style={{ width: "400px", flexShrink: 0, display: "flex", flexDirection: "column", padding: "40px", overflowY: "auto", background: "#161B22" }}>
              <AnimatePresence mode="wait">
                {isCallGraph ? (
                  <motion.div
                    key="metrics-macro"
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -20 }}
                    transition={{ duration: 0.3 }}
                    style={{ display: "flex", flexDirection: "column", height: "100%" }}
                  >
                    <div style={{ fontSize: "11px", letterSpacing: "0.2em", color: "#8B949E", textTransform: "uppercase", fontWeight: "bold", marginBottom: "32px" }}>
                      File Summary Overview
                    </div>

                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px", marginBottom: "40px" }}>
                      <div style={{ background: "#0D1117", padding: "20px", borderRadius: "12px", border: "1px solid rgba(255,255,255,0.05)", boxShadow: "0 4px 6px rgba(0,0,0,0.1)" }}>
                        <div style={{ color: "#8B949E", fontSize: "10px", fontWeight: "bold", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: "8px" }}>Functions</div>
                        <div style={{ fontSize: "32px", fontFamily: "monospace", color: "#fff" }}>{fileCfgs.length}</div>
                      </div>
                      <div style={{ background: "#0D1117", padding: "20px", borderRadius: "12px", border: "1px solid rgba(255,255,255,0.05)", boxShadow: "0 4px 6px rgba(0,0,0,0.1)" }}>
                        <div style={{ color: "#8B949E", fontSize: "10px", fontWeight: "bold", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: "8px" }}>Max CC</div>
                        <div style={{ fontSize: "32px", fontFamily: "monospace", color: "#fbbf24" }}>{maxCc}</div>
                      </div>
                    </div>

                    <div style={{ borderRadius: "12px", padding: "24px", border: "1px solid rgba(34,211,238,0.2)", background: "rgba(34,211,238,0.05)", position: "relative", overflow: "hidden" }}>
                      <div style={{ position: "absolute", top: 0, right: 0, padding: "16px", opacity: 0.1 }}><Info size={40} /></div>
                      <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "12px", color: "#22D3EE", fontWeight: "bold", fontSize: "14px", letterSpacing: "0.05em" }}>
                        Call Graph Analysis
                      </div>
                      <p style={{ color: "#8B949E", fontSize: "13px", lineHeight: "1.6", position: "relative", zIndex: 10, margin: 0 }}>
                        Select a function on the left to inspect its internal logic complexity and Control Flow Graph.
                      </p>
                    </div>
                  </motion.div>
                ) : (
                  <motion.div
                    key="metrics-micro"
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -20 }}
                    transition={{ duration: 0.3 }}
                    style={{ display: "flex", flexDirection: "column", height: "100%" }}
                  >
                    <div style={{ fontSize: "11px", letterSpacing: "0.2em", color: "#8B949E", textTransform: "uppercase", fontWeight: "bold", marginBottom: "32px" }}>
                      Function Complexity
                    </div>

                    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", marginBottom: "40px", position: "relative" }}>
                      <div style={{ position: "relative", display: "flex", alignItems: "center", justifyContent: "center", width: "160px", height: "160px" }}>
                        <svg style={{ width: "100%", height: "100%", transform: "rotate(-90deg)" }}>
                          <circle cx="80" cy="80" r="70" stroke="rgba(255,255,255,0.05)" strokeWidth="14" fill="none" />
                          <circle
                            cx="80" cy="80" r="70" stroke={activeCc?.value >= 10 ? "#ef4444" : activeCc?.value >= 5 ? "#fbbf24" : "#22c55e"}
                            strokeWidth="14" fill="none" strokeDasharray="440" strokeDashoffset={440 - (440 * Math.min(activeCc?.value || 0, 20) / 20)}
                            strokeLinecap="round" style={{ filter: `drop-shadow(0 0 10px ${activeCc?.value >= 10 ? 'rgba(239,68,68,0.5)' : activeCc?.value >= 5 ? 'rgba(251,191,36,0.5)' : 'rgba(34,197,94,0.5)'})` }}
                          />
                        </svg>
                        <div style={{ position: "absolute", display: "flex", flexDirection: "column", alignItems: "center" }}>
                          <span style={{ fontSize: "48px", fontWeight: "bold", fontFamily: "monospace", color: "#F0F6FC" }}>{activeCc?.value || 1}</span>
                          <span style={{ fontSize: "10px", color: "#8B949E", marginTop: "8px", fontWeight: "bold", letterSpacing: "0.1em", textTransform: "uppercase" }}>McCabe CC</span>
                        </div>
                      </div>

                      <div style={{ marginTop: "32px", padding: "8px 20px", borderRadius: "9999px", fontSize: "13px", fontWeight: "bold", border: `1px solid ${activeCc?.value >= 10 ? '#ef4444' : activeCc?.value >= 5 ? '#fbbf24' : '#22c55e'}40`, background: `${activeCc?.value >= 10 ? '#ef4444' : activeCc?.value >= 5 ? '#fbbf24' : '#22c55e'}1a`, color: activeCc?.value >= 10 ? '#ef4444' : activeCc?.value >= 5 ? '#fbbf24' : '#22c55e' }}>
                        Complexity: {activeCc?.value >= 10 ? "High" : activeCc?.value >= 5 ? "Moderate" : "Low"}
                      </div>
                    </div>

                    <div style={{ marginBottom: "32px", background: "#0D1117", borderRadius: "12px", padding: "20px", border: "1px solid rgba(255,255,255,0.05)" }}>
                      <div style={{ fontSize: "10px", letterSpacing: "0.15em", color: "#8B949E", textTransform: "uppercase", fontWeight: "bold", marginBottom: "16px" }}>
                        Graph Metrics
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: "12px", fontFamily: "monospace", fontSize: "13px" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                          <span style={{ color: "#8B949E" }}>Edges (E)</span>
                          <span style={{ color: "#22D3EE", fontWeight: "bold" }}>{graphLayout.edges.length}</span>
                        </div>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                          <span style={{ color: "#8B949E" }}>Nodes (N)</span>
                          <span style={{ color: "#4ADE80", fontWeight: "bold" }}>{graphLayout.nodes.length}</span>
                        </div>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                          <span style={{ color: "#8B949E" }}>Exits (P)</span>
                          <span style={{ color: "#fff", fontWeight: "bold" }}>1</span>
                        </div>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </div>
      )}
    </motion.div>
  );
}
