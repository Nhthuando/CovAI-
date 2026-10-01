import React, { useState, useEffect, useMemo, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import dagre from "dagre";
import {
  X,
  Sparkles,
  Info,
  ZoomIn,
  ZoomOut,
  GitBranch,
  ArrowLeft,
  TerminalSquare,
  Network,
  RefreshCw,
  RotateCcw,
  CheckCircle2,
  AlertTriangle,
  AlertOctagon,
  ShieldCheck,
  Calculator,
  Layers,
  Activity,
} from "lucide-react";
import {
  getProjectCfgApi,
  getProjectCcApi,
  getFileContentApi,
  buildCfgApi,
} from "../../services/project.service.js";
import { useBreakpoints } from "../../hooks/useMediaQuery";

/* --- ANIMATION VARIANTS --- */
const containerVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.4, ease: "easeOut" } },
  exit: { opacity: 0, y: 20, transition: { duration: 0.3 } },
};

function syntaxHighlight(text) {
  return text
    .split(
      /(\bfunction\b|\bif\b|\belse\b|\breturn\b|\bconst\b|\blet\b|\bvar\b|"[^"]*"|'[^']*'|\b\d+\b)/g,
    )
    .map((part, i) => {
      if (
        ["function", "if", "else", "return", "const", "let", "var"].includes(
          part,
        )
      )
        return (
          <span key={i} className="text-[var(--color-primary)] font-semibold">
            {part}
          </span>
        );
      if (part.startsWith('"') || part.startsWith("'"))
        return (
          <span key={i} className="text-[var(--color-success)]">
            {part}
          </span>
        );
      if (/^\d+$/.test(part))
        return (
          <span key={i} className="text-[var(--color-warning)]">
            {part}
          </span>
        );
      return (
        <span key={i} className="text-[var(--color-text)]">
          {part}
        </span>
      );
    });
}

function computeLayout(nodes, edges) {
  if (!nodes || nodes.length === 0)
    return { nodes: [], edges: [], width: 400, height: 400 };
  const g = new dagre.graphlib.Graph();
  g.setGraph({
    rankdir: "TB",
    marginx: 50,
    marginy: 50,
    nodesep: 60,
    ranksep: 80,
  });
  g.setDefaultEdgeLabel(() => ({}));

  nodes.forEach((n) => {
    // Label length heuristic for width
    const label = n.label || n.type || n.id;
    const width = Math.max(120, label.length * 8 + 40);
    g.setNode(n.id, { width, height: 40 });
  });

  edges.forEach((e) => {
    g.setEdge(e.from, e.to);
  });

  dagre.layout(g);

  const graphInfo = g.graph();
  const graphWidth = Math.max(graphInfo.width || 0, 400);
  const graphHeight = Math.max(graphInfo.height || 0, 300);

  return {
    width: graphWidth,
    height: graphHeight,
    nodes: nodes.map((n) => {
      const pos = g.node(n.id);
      return { ...n, x: pos.x, y: pos.y, width: pos.width };
    }),
    edges: edges.map((e) => {
      const edgePos = g.edge(e.from, e.to);
      return { ...e, points: edgePos.points };
    }),
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

const getComplexityMeta = (value) => {
  const v = value || 1;
  if (v <= 4) {
    return {
      level: "Low",
      riskText: "Low Risk",
      summary: "Low complexity, concise structure, easy to maintain.",
      recommendation:
        "Minimal defect risk. Standard unit test cases provide sufficient coverage.",
      color: "var(--color-success)",
      textColor: "text-[var(--color-success)]",
      badgeClass:
        "bg-[var(--color-success)]/10 text-[var(--color-success)] border-[var(--color-success)]/30",
      tier: 1,
      icon: CheckCircle2,
    };
  }
  if (v <= 10) {
    return {
      level: "Moderate",
      riskText: "Moderate Risk",
      summary: "Moderate complexity with multiple decision paths.",
      recommendation:
        "Thoroughly test all conditional branches (if / else / switch / loop).",
      color: "var(--color-warning)",
      textColor: "text-[var(--color-warning)]",
      badgeClass:
        "bg-[var(--color-warning)]/10 text-[var(--color-warning)] border-[var(--color-warning)]/30",
      tier: 2,
      icon: AlertTriangle,
    };
  }
  if (v <= 20) {
    return {
      level: "High",
      riskText: "High Risk",
      summary:
        "High complexity, difficult to exhaustively verify all execution paths.",
      recommendation:
        "Refactoring recommended: decompose into smaller helper functions or services.",
      color: "var(--color-danger)",
      textColor: "text-[var(--color-danger)]",
      badgeClass:
        "bg-[var(--color-danger)]/10 text-[var(--color-danger)] border-[var(--color-danger)]/30",
      tier: 3,
      icon: AlertOctagon,
    };
  }
  return {
    level: "Critical",
    riskText: "Very High Risk",
    summary:
      "Critical complexity (spaghetti flow), very high probability of regression bugs.",
    recommendation:
      "Immediate refactoring mandatory before deploying to production.",
    color: "var(--color-danger)",
    textColor: "text-[var(--color-danger)]",
    badgeClass:
      "bg-[var(--color-danger)]/15 text-[var(--color-danger)] border-[var(--color-danger)]/40",
    tier: 4,
    icon: AlertOctagon,
  };
};

/* --- NODE COMPONENTS --- */
function FuncNode({ label, x, y, onClick }) {
  return (
    <motion.div
      data-no-pan="true"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        onClick?.();
      }}
      className="flex items-center justify-center font-mono select-none cursor-pointer rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] hover:bg-[var(--color-surface-secondary)] hover:border-[var(--color-primary)] text-[var(--color-text)] transition-colors shadow-sm"
      initial={{ x: "-50%", y: "-50%", scale: 1 }}
      whileHover={{
        scale: 1.05,
        x: "-50%",
        y: "-50%",
      }}
      whileTap={{ scale: 0.95, x: "-50%", y: "-50%" }}
      style={{
        position: "absolute",
        left: x,
        top: y,
        zIndex: 10,
        fontSize: "13px",
        padding: "10px 24px",
        whiteSpace: "nowrap",
      }}
    >
      <Network
        size={15}
        className="mr-2 text-[var(--color-primary)] opacity-80"
      />
      {label}()
    </motion.div>
  );
}

function CFGNode({
  label,
  line,
  x,
  y,
  active = false,
  isDiamond = false,
  width = 120,
  isSelected = false,
  onClick,
}) {
  return (
    <motion.div
      data-no-pan="true"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        onClick?.();
      }}
      initial={{ x: "-50%", y: "-50%", scale: 0.8, opacity: 0 }}
      animate={
        isSelected
          ? { x: "-50%", y: "-50%", scale: 1.08, opacity: 1 }
          : active
            ? { x: "-50%", y: "-50%", scale: [1, 1.04, 1], opacity: 1 }
            : { x: "-50%", y: "-50%", scale: 1, opacity: 1 }
      }
      transition={{
        scale: isSelected
          ? { duration: 0.2 }
          : active
            ? { repeat: Infinity, duration: 2.5 }
            : { duration: 0.3 },
        default: { duration: 0.3 },
      }}
      whileHover={{ scale: isSelected ? 1.1 : 1.05 }}
      whileTap={{ scale: 0.96 }}
      className={`flex items-center justify-center font-mono select-none text-center shadow-sm cursor-pointer transition-all ${
        isDiamond ? "rounded-[var(--radius-md)]" : "rounded-full"
      } ${
        isSelected
          ? "border-2 border-[var(--color-primary)] bg-[var(--color-primary)]/15 text-[var(--color-primary)] font-bold ring-2 ring-[var(--color-primary)]/50 ring-offset-2 ring-offset-[var(--color-bg)] z-30 shadow-md"
          : active
            ? "border-2 border-[var(--color-primary)] bg-[var(--color-surface)] text-[var(--color-primary)] font-semibold z-10 hover:border-[var(--color-primary)]"
            : "border border-[var(--color-border)] bg-[var(--color-surface)] hover:border-[var(--color-primary)]/70 text-[var(--color-text)] z-10"
      }`}
      style={{
        position: "absolute",
        left: x,
        top: y,
        fontSize: "12px",
        padding: "8px 20px",
        minWidth: `${width}px`,
      }}
    >
      {isSelected && (
        <span className="absolute -top-1.5 -right-1.5 flex h-3 w-3">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[var(--color-primary)] opacity-75"></span>
          <span className="relative inline-flex rounded-full h-3 w-3 bg-[var(--color-primary)]"></span>
        </span>
      )}
      {active && !isSelected && (
        <span className="absolute -left-1.5 w-2.5 h-2.5 rounded-full bg-[var(--color-primary)] animate-ping" />
      )}
      {isDiamond && (
        <GitBranch
          size={13}
          className="mr-1.5 text-[var(--color-warning)] opacity-90"
        />
      )}
      <span>{label}</span>
      {line ? (
        <span
          className={`text-[11px] ml-1.5 font-mono ${
            isSelected
              ? "text-[var(--color-primary)] font-bold opacity-100"
              : "opacity-60"
          }`}
        >
          (L{line})
        </span>
      ) : null}
    </motion.div>
  );
}

export default function CFGCalculator({ project, onClose, initialFile, initialFunc }) {
  const { isMobile } = useBreakpoints();
  const [cfgs, setCfgs] = useState([]);
  const [ccs, setCcs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [selectedFile, setSelectedFile] = useState(null);
  const [selectedFunc, setSelectedFunc] = useState(null);
  const [selectedNodeId, setSelectedNodeId] = useState(null);
  const [highlightedLine, setHighlightedLine] = useState(null);
  const codeContainerRef = useRef(null);
  const [sourceCode, setSourceCode] = useState("");
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragOriginRef = useRef({ startX: 0, startY: 0, panX: 0, panY: 0 });
  const canvasRef = useRef(null);
  const [rebuilding, setRebuilding] = useState(false);

  // Resize state
  const [leftWidth, setLeftWidth] = useState(420);
  const [rightWidth, setRightWidth] = useState(400);
  const [isResizingLeft, setIsResizingLeft] = useState(false);
  const [isResizingRight, setIsResizingRight] = useState(false);
  const [topHeight, setTopHeight] = useState(30); // Percentage
  const [isResizingTop, setIsResizingTop] = useState(false);

  useEffect(() => {
    const handleMouseMove = (e) => {
      if (isResizingLeft) {
        setLeftWidth(Math.max(200, Math.min(800, e.clientX)));
      } else if (isResizingRight) {
        setRightWidth(
          Math.max(200, Math.min(800, window.innerWidth - e.clientX)),
        );
      } else if (isResizingTop) {
        const containerHeight = window.innerHeight;
        const newHeight = (e.clientY / containerHeight) * 100;
        setTopHeight(Math.max(10, Math.min(80, newHeight)));
      }
    };
    const handleMouseUp = () => {
      setIsResizingLeft(false);
      setIsResizingRight(false);
      setIsResizingTop(false);
      document.body.style.cursor = "default";
    };
    if (isResizingLeft || isResizingRight || isResizingTop) {
      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = isResizingTop ? "row-resize" : "col-resize";
    }
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isResizingLeft, isResizingRight, isResizingTop]);

  const handleRebuild = async () => {
    try {
      setRebuilding(true);
      setError(null);
      await buildCfgApi(project.id, "");
      // Wait a moment for the job to process, then refetch
      await new Promise((r) => setTimeout(r, 3000));
      const [cfgRes, ccRes] = await Promise.all([
        getProjectCfgApi(project.id, ""),
        getProjectCcApi(project.id, ""),
      ]);
      setCfgs(cfgRes.data);
      setCcs(ccRes.data);
      if (cfgRes.data.length > 0) {
        const firstFile = [...new Set(cfgRes.data.map((c) => c.filePath))][0];
        setSelectedFile(firstFile);
      }
    } catch (err) {
      setError(err.message || "Failed to rebuild CFG");
    } finally {
      setRebuilding(false);
    }
  };

  useEffect(() => {
    async function fetchData() {
      try {
        setLoading(true);
        // Using snapshotId empty to default to latest snapshot
        const [cfgRes, ccRes] = await Promise.all([
          getProjectCfgApi(project.id, ""),
          getProjectCcApi(project.id, ""),
        ]);
        setCfgs(cfgRes.data);
        setCcs(ccRes.data);

        if (cfgRes.data.length > 0) {
          const firstFile = [...new Set(cfgRes.data.map((c) => c.filePath))][0];
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
    return [...new Set(cfgs.map((c) => c.filePath))];
  }, [cfgs]);

  const fileCfgs = useMemo(() => {
    return cfgs.filter((c) => c.filePath === selectedFile);
  }, [cfgs, selectedFile]);

  const fileCcs = useMemo(() => {
    return ccs.filter((c) => c.filePath === selectedFile);
  }, [ccs, selectedFile]);

  const activeCfg = useMemo(() => {
    return fileCfgs.find((c) => c.functionName === selectedFunc);
  }, [fileCfgs, selectedFunc]);

  const activeCc = useMemo(() => {
    return fileCcs.find((c) => c.functionName === selectedFunc);
  }, [fileCcs, selectedFunc]);

  const maxCc = useMemo(() => {
    if (fileCcs.length === 0) return 0;
    return Math.max(...fileCcs.map((c) => c.value));
  }, [fileCcs]);

  const isCallGraph = selectedFunc === null;

  // Process source code lines
  const sourceLines = useMemo(() => {
    return sourceCode.split("\n").map((text, i) => ({ num: i + 1, text }));
  }, [sourceCode]);

  // DAGRE Layouts
  const graphLayout = useMemo(() => {
    if (isCallGraph) {
      // Just layout the functions side by side or vertically
      const nodes = fileCfgs.map((c, i) => ({
        id: c.functionName,
        label: c.functionName,
      }));
      const edges = [];
      // Create a dummy chain so dagre lays them out nicely vertically
      for (let i = 0; i < nodes.length - 1; i++)
        edges.push({ from: nodes[i].id, to: nodes[i + 1].id });
      return computeLayout(nodes, edges);
    } else {
      if (!activeCfg || !activeCfg.graphJson)
        return { nodes: [], edges: [], width: 400, height: 400 };
      try {
        const parsed = JSON.parse(activeCfg.graphJson);
        let nodes = parsed.nodes || [];
        let edges = parsed.edges || [];

        // Add virtual exit node to conform to standard McCabe CFG calculation
        if (nodes.length > 0) {
          const fromNodeIds = new Set(edges.map((e) => e.from));
          const leafNodes = nodes.filter((n) => !fromNodeIds.has(n.id));

          if (leafNodes.length > 0) {
            const exitNodeId = "virtual_exit_node";
            nodes = [
              ...nodes,
              {
                id: exitNodeId,
                type: "exit",
                label: "Virtual Exit",
                line: activeCfg?.endLine,
              },
            ];
            leafNodes.forEach((leaf) => {
              edges = [...edges, { from: leaf.id, to: exitNodeId }];
            });
          }
        }

        return computeLayout(nodes, edges);
      } catch (e) {
        return { nodes: [], edges: [], width: 400, height: 400 };
      }
    }
  }, [isCallGraph, fileCfgs, activeCfg]);

  // Auto-center / reset pan & zoom when file or function changes
  useEffect(() => {
    setPan({ x: 0, y: 0 });
    setZoom(1);
  }, [selectedFile, selectedFunc]);

  // Handle canvas mouse drag for panning
  const handleCanvasMouseDown = (e) => {
    if (e.button !== 0) return;
    if (e.target.closest("button") || e.target.closest("[data-no-pan]")) return;

    setIsDragging(true);
    dragOriginRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      panX: pan.x,
      panY: pan.y,
    };
  };

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e) => {
      const dx = e.clientX - dragOriginRef.current.startX;
      const dy = e.clientY - dragOriginRef.current.startY;
      setPan({
        x: dragOriginRef.current.panX + dx,
        y: dragOriginRef.current.panY + dy,
      });
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isDragging]);

  // Handle canvas mouse wheel zoom
  useEffect(() => {
    const container = canvasRef.current;
    if (!container) return;

    const onWheel = (e) => {
      e.preventDefault();
      const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;
      setZoom((z) =>
        Math.min(Math.max(Number((z * zoomFactor).toFixed(2)), 0.2), 3),
      );
    };

    container.addEventListener("wheel", onWheel, { passive: false });
    return () => container.removeEventListener("wheel", onWheel);
  }, []);

  // Handle node selection and smooth scroll to source line
  const handleNodeClick = (node) => {
    setSelectedNodeId(node.id);
    const targetLine =
      node.line ||
      (node.type === "start"
        ? activeCfg?.startLine
        : node.type === "exit"
          ? activeCfg?.endLine
          : null);

    if (targetLine) {
      setHighlightedLine(targetLine);
      const el = document.getElementById(`cfg-source-line-${targetLine}`);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    }
  };

  const selectedNode = useMemo(() => {
    if (!selectedNodeId) return null;
    return graphLayout.nodes.find((n) => n.id === selectedNodeId) || null;
  }, [selectedNodeId, graphLayout.nodes]);

  const selectedNodeInEdges = useMemo(() => {
    if (!selectedNode) return [];
    return graphLayout.edges.filter((e) => e.to === selectedNode.id);
  }, [selectedNode, graphLayout.edges]);

  const selectedNodeOutEdges = useMemo(() => {
    if (!selectedNode) return [];
    return graphLayout.edges.filter((e) => e.from === selectedNode.id);
  }, [selectedNode, graphLayout.edges]);

  const selectedNodeLineText = useMemo(() => {
    if (!selectedNode) return "";
    const targetLine =
      selectedNode.line ||
      (selectedNode.type === "start"
        ? activeCfg?.startLine
        : selectedNode.type === "exit"
          ? activeCfg?.endLine
          : null);
    if (!targetLine) return "";
    const lineObj = sourceLines.find((l) => l.num === targetLine);
    return lineObj ? lineObj.text.trim() : "";
  }, [selectedNode, sourceLines, activeCfg]);

  // Sync scroll and highlight when active function CFG changes
  useEffect(() => {
    setSelectedNodeId(null);
    if (activeCfg?.startLine) {
      setHighlightedLine(activeCfg.startLine);
      const timer = setTimeout(() => {
        const el = document.getElementById(
          `cfg-source-line-${activeCfg.startLine}`,
        );
        if (el) {
          el.scrollIntoView({ behavior: "smooth", block: "center" });
        }
      }, 150);
      return () => clearTimeout(timer);
    } else {
      setHighlightedLine(null);
    }
  }, [selectedFunc, activeCfg]);

  return (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="visible"
      exit="exit"
      className="fixed inset-0 z-50 flex flex-col"
      style={{
        background: "var(--color-bg)",
        fontFamily: "var(--font-sans)",
        color: "var(--color-text)",
      }}
    >
      {/* --- HEADER --- */}
      <div className="flex items-center justify-between flex-shrink-0 px-5 h-14 bg-[var(--color-surface)] border-b border-[var(--color-border)]">
        <div className="flex items-center gap-3">
          <select
            value={selectedFile || ""}
            onChange={(e) => {
              setSelectedFile(e.target.value);
              setSelectedFunc(null);
            }}
            className="bg-[var(--color-bg)] text-[var(--color-text)] border border-[var(--color-border)] rounded-[var(--radius-md)] px-3 py-1.5 text-xs outline-none cursor-pointer font-mono focus:border-[var(--color-primary)]"
          >
            {uniqueFiles.map((f) => (
              <option
                key={f}
                value={f}
                className="bg-[var(--color-surface)] text-[var(--color-text)]"
              >
                {f}
              </option>
            ))}
          </select>
          <div className="flex items-center gap-1.5 text-xs text-[var(--color-text-secondary)]">
            {!isCallGraph && (
              <>
                <span className="text-[var(--color-text-muted)]">/</span>
                <span className="text-[var(--color-primary)] font-mono font-bold">
                  {selectedFunc}()
                </span>
              </>
            )}
          </div>
        </div>
        <button
          className="p-1.5 rounded-[var(--radius-sm)] hover:bg-[var(--color-surface-secondary)] text-[var(--color-text-secondary)] hover:text-[var(--color-text)] transition-colors cursor-pointer bg-transparent border-none"
          onClick={onClose}
          title="Close"
        >
          <X size={18} />
        </button>
      </div>

      {loading || rebuilding ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 text-[var(--color-text-secondary)]">
          <motion.div
            animate={{ rotate: 360 }}
            transition={{ repeat: Infinity, duration: 1, ease: "linear" }}
          >
            <RefreshCw size={28} className="text-[var(--color-primary)]" />
          </motion.div>
          <span className="text-xs font-mono">
            {rebuilding ? "Rebuilding CFG..." : "Loading analysis data..."}
          </span>
        </div>
      ) : error ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 text-[var(--color-danger)]">
          <span className="text-xs">{error}</span>
          <button
            onClick={handleRebuild}
            className="px-4 py-2 rounded-[var(--radius-md)] bg-[var(--color-primary)] text-white hover:bg-[var(--color-primary-hover)] cursor-pointer text-xs font-semibold flex items-center gap-2 transition-colors shadow-sm border-none"
          >
            <RefreshCw size={14} /> Rebuild CFG
          </button>
        </div>
      ) : cfgs.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-4 p-6 text-center">
          <div className="flex flex-col items-center gap-2">
            <Network
              size={44}
              className="text-[var(--color-text-muted)] opacity-60"
            />
            <span className="text-base font-bold text-[var(--color-text)]">
              No CFG Data Available
            </span>
            <span className="text-xs text-[var(--color-text-secondary)] max-w-md leading-relaxed">
              Control Flow Graph and Cyclomatic Complexity data have not been
              generated for the current snapshot. Click the button below to
              build.
            </span>
          </div>
          <button
            onClick={handleRebuild}
            className="px-5 py-2.5 rounded-[var(--radius-md)] bg-[var(--color-primary)] text-white hover:bg-[var(--color-primary-hover)] cursor-pointer text-xs font-semibold flex items-center gap-2 transition-colors shadow-sm border-none"
          >
            <RefreshCw size={16} /> Build CFG & CC
          </button>
        </div>
      ) : (
        /* --- MAIN CONTENT --- */
        <div
          style={{
            flex: 1,
            display: "flex",
            overflowX: isMobile ? "hidden" : "auto",
            overflowY: "hidden",
            background: "var(--color-bg)",
            width: "100%",
          }}
        >
          <div
            style={{
              display: "flex",
              height: "100%",
              width: "100%",
              flexDirection: isMobile ? "column" : "row",
            }}
          >
            {/* LEFT COLUMN: Source Code */}
            <div
              style={{
                width: isMobile ? "100%" : `${leftWidth}px`,
                flexShrink: 0,
                display: "flex",
                flexDirection: "column",
                borderRight: "1px solid var(--color-border)",
                background: "var(--color-surface)",
                height: isMobile ? `${topHeight}%` : "100%",
                position: "relative",
              }}
            >
              <div
                onMouseDown={() =>
                  isMobile ? setIsResizingTop(true) : setIsResizingLeft(true)
                }
                style={{
                  position: "absolute",
                  [isMobile ? "bottom" : "right"]: -3,
                  top: isMobile ? "auto" : 0,
                  bottom: isMobile ? -3 : 0,
                  width: isMobile ? "100%" : 6,
                  height: isMobile ? 6 : "100%",
                  cursor: isMobile ? "row-resize" : "col-resize",
                  zIndex: 100,
                }}
              />
              <div className="px-5 py-3 text-[11px] font-mono tracking-wider text-[var(--color-text-secondary)] uppercase font-bold flex items-center justify-between border-b border-[var(--color-border)] bg-[var(--color-surface)]">
                <div className="flex items-center gap-2">
                  <span>Source Code</span>
                  {highlightedLine && (
                    <span className="bg-[var(--color-primary)]/15 text-[var(--color-primary)] border border-[var(--color-primary)]/30 px-2 py-0.5 rounded-[var(--radius-sm)] text-[10px] font-mono font-bold">
                      Line {highlightedLine}
                    </span>
                  )}
                </div>
                <span className="bg-[var(--color-primary)]/10 text-[var(--color-primary)] border border-[var(--color-primary)]/20 px-2 py-0.5 rounded-[var(--radius-sm)] text-[10px] font-mono font-semibold">
                  JS/TS
                </span>
              </div>
              <div
                ref={codeContainerRef}
                className="flex-1 overflow-y-auto py-3 font-mono text-xs leading-relaxed bg-[var(--color-bg)]"
              >
                {sourceLines.map((line) => {
                  const isTargetLine = highlightedLine === line.num;
                  const isActiveScope =
                    activeCfg &&
                    line.num >= activeCfg.startLine &&
                    line.num <= activeCfg.endLine;
                  const isDimmed =
                    !isCallGraph && !isActiveScope && !isTargetLine;

                  return (
                    <div
                      key={line.num}
                      id={`cfg-source-line-${line.num}`}
                      onClick={() => {
                        const matchingNode = graphLayout.nodes.find(
                          (n) => n.line === line.num,
                        );
                        if (matchingNode) {
                          setSelectedNodeId(matchingNode.id);
                        }
                        setHighlightedLine(line.num);
                      }}
                      className={`flex items-start px-4 py-0.5 transition-all cursor-pointer ${
                        isTargetLine
                          ? "bg-[var(--color-primary)]/20 border-l-[4px] border-l-[var(--color-primary)] shadow-sm font-semibold"
                          : isActiveScope
                            ? "bg-[var(--color-primary)]/5 border-l-[3px] border-l-[var(--color-primary)]/50 hover:bg-[var(--color-surface-secondary)]/50"
                            : "border-l-[3px] border-l-transparent hover:bg-[var(--color-surface-secondary)]/40"
                      } ${isDimmed ? "opacity-35" : "opacity-100"}`}
                    >
                      <span
                        className={`w-11 flex-shrink-0 text-right pr-2 select-none font-mono text-[11px] flex items-center justify-end gap-1 ${
                          isTargetLine
                            ? "text-[var(--color-primary)] font-bold"
                            : isActiveScope
                              ? "text-[var(--color-primary)] font-semibold"
                              : "text-[var(--color-text-muted)]"
                        }`}
                      >
                        {isTargetLine && (
                          <span className="text-[var(--color-primary)] text-[10px] animate-pulse">
                            ▶
                          </span>
                        )}
                        <span>{line.num}</span>
                      </span>
                      <span
                        className={`whitespace-pre-wrap break-all flex-1 font-mono text-xs ${
                          isTargetLine
                            ? "text-[var(--color-text)] font-semibold"
                            : "text-[var(--color-text)]"
                        }`}
                      >
                        {syntaxHighlight(line.text)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* MIDDLE COLUMN: Graph Area */}
            <div
              style={{
                flex: 1,
                minWidth: isMobile ? "100%" : "550px",
                display: "flex",
                flexDirection: "column",
                borderRight: "1px solid var(--color-border)",
                background: "var(--color-bg)",
                position: "relative",
                height: isMobile ? "40%" : "100%",
              }}
            >
              <div className="px-5 py-3 text-[11px] font-mono tracking-wider text-[var(--color-text-secondary)] uppercase font-bold flex items-center justify-between border-b border-[var(--color-border)] bg-[var(--color-surface)] z-20">
                <div className="flex items-center gap-3">
                  {!isCallGraph && (
                    <motion.button
                      whileHover={{ x: -2 }}
                      onClick={() => setSelectedFunc(null)}
                      className="flex items-center gap-1.5 text-[var(--color-primary)] hover:opacity-80 font-bold font-mono text-xs cursor-pointer bg-transparent border-none"
                    >
                      <ArrowLeft size={14} /> Back
                    </motion.button>
                  )}
                  <span className="text-[var(--color-text)]">
                    {isCallGraph ? "Functions in File" : "Control Flow Graph"}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 bg-[var(--color-bg)] px-2.5 py-1 rounded-[var(--radius-md)] border border-[var(--color-border)]">
                  <ZoomOut
                    size={14}
                    onClick={() =>
                      setZoom((z) =>
                        Math.min(
                          Math.max(Number((z - 0.15).toFixed(2)), 0.2),
                          3,
                        ),
                      )
                    }
                    className="cursor-pointer text-[var(--color-text-secondary)] hover:text-[var(--color-text)] transition-colors"
                    title="Zoom Out"
                  />
                  <span className="text-xs text-[var(--color-text-secondary)] w-11 text-center font-mono font-bold select-none">
                    {Math.round(zoom * 100)}%
                  </span>
                  <ZoomIn
                    size={14}
                    onClick={() =>
                      setZoom((z) =>
                        Math.min(
                          Math.max(Number((z + 0.15).toFixed(2)), 0.2),
                          3,
                        ),
                      )
                    }
                    className="cursor-pointer text-[var(--color-text-secondary)] hover:text-[var(--color-text)] transition-colors"
                    title="Zoom In"
                  />
                  <div className="w-[1px] h-3.5 bg-[var(--color-border)] mx-1" />
                  <button
                    onClick={() => {
                      setZoom(1);
                      setPan({ x: 0, y: 0 });
                    }}
                    title="Reset View (Center Graph)"
                    className="flex items-center gap-1 text-[var(--color-text-secondary)] hover:text-[var(--color-primary)] transition-colors p-0.5 cursor-pointer bg-transparent border-none text-[11px] font-mono font-medium"
                  >
                    <RotateCcw size={12} />
                    <span>Reset</span>
                  </button>
                </div>
              </div>

              <div
                ref={canvasRef}
                onMouseDown={handleCanvasMouseDown}
                style={{
                  flex: 1,
                  position: "relative",
                  overflow: "hidden",
                  background: "var(--color-bg)",
                  cursor: isDragging ? "grabbing" : "grab",
                  userSelect: "none",
                }}
              >
                <div
                  style={{
                    position: "absolute",
                    left: "50%",
                    top: "50%",
                    transform: `translate(calc(-50% + ${pan.x}px), calc(-50% + ${pan.y}px)) scale(${zoom})`,
                    transformOrigin: "center center",
                    transition: isDragging ? "none" : "transform 0.1s ease-out",
                    willChange: "transform",
                  }}
                >
                  {graphLayout.nodes.length === 0 ? (
                    <div className="flex flex-col items-center justify-center p-8 text-center text-[var(--color-text-secondary)]">
                      <GitBranch
                        size={32}
                        className="text-[var(--color-text-muted)] mb-3 opacity-50"
                      />
                      <span className="text-sm font-semibold text-[var(--color-text)]">
                        No graph nodes found
                      </span>
                      <span className="text-xs text-[var(--color-text-muted)] mt-1">
                        This function might be empty or unparseable.
                      </span>
                    </div>
                  ) : isCallGraph ? (
                    /* --- CALL GRAPH --- */
                    <div
                      style={{
                        position: "relative",
                        width: `${graphLayout.width}px`,
                        height: `${graphLayout.height}px`,
                      }}
                    >
                      {graphLayout.nodes.map((n) => (
                        <FuncNode
                          key={n.id}
                          label={n.id}
                          x={n.x}
                          y={n.y}
                          onClick={() => setSelectedFunc(n.id)}
                        />
                      ))}
                    </div>
                  ) : (
                    /* --- CFG --- */
                    <div
                      style={{
                        position: "relative",
                        width: `${graphLayout.width}px`,
                        height: `${graphLayout.height}px`,
                      }}
                    >
                      <svg
                        width={graphLayout.width}
                        height={graphLayout.height}
                        style={{
                          position: "absolute",
                          inset: 0,
                          pointerEvents: "none",
                          overflow: "visible",
                        }}
                      >
                        <defs>
                          <marker
                            id="arrowhead"
                            markerWidth="10"
                            markerHeight="7"
                            refX="9"
                            refY="3.5"
                            orient="auto"
                          >
                            <polygon
                              points="0 0, 10 3.5, 0 7"
                              fill="var(--color-primary)"
                            />
                          </marker>
                        </defs>
                        {graphLayout.edges.map((e, i) => (
                          <path
                            key={i}
                            d={pointsToSvgPath(e.points)}
                            fill="none"
                            stroke="var(--color-primary)"
                            strokeOpacity="0.6"
                            strokeWidth="2"
                            markerEnd="url(#arrowhead)"
                          />
                        ))}
                      </svg>

                      {graphLayout.nodes.map((n) => (
                        <CFGNode
                          key={n.id}
                          label={n.label || n.type || n.id}
                          line={n.line}
                          x={n.x}
                          y={n.y}
                          width={n.width}
                          isDiamond={n.type === "condition"}
                          active={
                            n.type === "start" ||
                            n.type === "return" ||
                            n.type === "exit"
                          }
                          isSelected={selectedNodeId === n.id}
                          onClick={() => handleNodeClick(n)}
                        />
                      ))}
                    </div>
                  )}
                </div>

                {/* Floating Hint Pill */}
                <div className="absolute bottom-4 left-1/2 -translate-x-1/2 text-xs text-[var(--color-text-secondary)] bg-[var(--color-surface)]/90 backdrop-blur-sm px-4 py-2 rounded-full border border-[var(--color-border)] flex items-center gap-2 whitespace-nowrap shadow-sm pointer-events-none select-none z-20">
                  <Sparkles size={14} className="text-[var(--color-primary)]" />
                  {isCallGraph
                    ? "Click a function node to analyze its CFG • Drag canvas to pan"
                    : "Click any node to navigate to code • Drag canvas to pan • Scroll to zoom"}
                </div>
              </div>
            </div>

            {/* RIGHT COLUMN: Metrics */}
            <div
              style={{
                width: isMobile ? "100%" : `${rightWidth}px`,
                flexShrink: 0,
                display: "flex",
                flexDirection: "column",
                padding: isMobile ? "20px" : "32px",
                overflowY: "auto",
                background: "var(--color-surface)",
                height: isMobile ? "30%" : "100%",
                position: "relative",
              }}
            >
              {!isMobile && (
                <div
                  onMouseDown={() => setIsResizingRight(true)}
                  style={{
                    position: "absolute",
                    left: -3,
                    top: 0,
                    bottom: 0,
                    width: 6,
                    cursor: "col-resize",
                    zIndex: 100,
                  }}
                />
              )}
              <AnimatePresence mode="wait">
                {isCallGraph ? (
                  <motion.div
                    key="metrics-macro"
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -20 }}
                    transition={{ duration: 0.3 }}
                    className="flex flex-col h-full"
                  >
                    <div className="flex items-center gap-2 mb-5 pb-3 border-b border-[var(--color-border)]">
                      <Layers
                        size={15}
                        className="text-[var(--color-primary)]"
                      />
                      <div className="text-xs font-mono tracking-wider text-[var(--color-text)] uppercase font-bold">
                        File Architecture Overview
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3 mb-4">
                      <div className="bg-[var(--color-bg)] p-3.5 rounded-[var(--radius-md)] border border-[var(--color-border)]">
                        <div className="text-[10px] font-mono font-semibold tracking-wider text-[var(--color-text-muted)] uppercase mb-1">
                          Total Functions
                        </div>
                        <div className="text-2xl font-mono font-bold text-[var(--color-text)]">
                          {fileCfgs.length}
                        </div>
                      </div>
                      <div className="bg-[var(--color-bg)] p-3.5 rounded-[var(--radius-md)] border border-[var(--color-border)]">
                        <div className="text-[10px] font-mono font-semibold tracking-wider text-[var(--color-text-muted)] uppercase mb-1">
                          Max McCabe CC
                        </div>
                        <div
                          className={`text-2xl font-mono font-bold ${
                            maxCc >= 10
                              ? "text-[var(--color-danger)]"
                              : maxCc >= 5
                                ? "text-[var(--color-warning)]"
                                : "text-[var(--color-success)]"
                          }`}
                        >
                          {maxCc}
                        </div>
                      </div>
                    </div>

                    {/* Complexity Distribution */}
                    <div className="rounded-[var(--radius-md)] p-4 border border-[var(--color-border)] bg-[var(--color-bg)] mb-4">
                      <div className="text-xs font-mono font-bold text-[var(--color-text)] mb-2.5 flex items-center justify-between">
                        <div className="flex items-center gap-1.5">
                          <Activity
                            size={13}
                            className="text-[var(--color-primary)]"
                          />
                          <span>Complexity Distribution</span>
                        </div>
                        <span className="text-[10px] text-[var(--color-text-muted)] font-normal">
                          {fileCcs.length} analyzed
                        </span>
                      </div>
                      <div className="flex gap-1 h-2 w-full rounded-full overflow-hidden bg-[var(--color-surface)] border border-[var(--color-border)] mb-2.5">
                        <div
                          style={{
                            width: `${(fileCcs.filter((c) => c.value <= 4).length / (fileCcs.length || 1)) * 100}%`,
                          }}
                          className="bg-[var(--color-success)] transition-all"
                          title="Low risk (<= 4)"
                        />
                        <div
                          style={{
                            width: `${(fileCcs.filter((c) => c.value > 4 && c.value <= 10).length / (fileCcs.length || 1)) * 100}%`,
                          }}
                          className="bg-[var(--color-warning)] transition-all"
                          title="Moderate risk (5-10)"
                        />
                        <div
                          style={{
                            width: `${(fileCcs.filter((c) => c.value > 10).length / (fileCcs.length || 1)) * 100}%`,
                          }}
                          className="bg-[var(--color-danger)] transition-all"
                          title="High risk (> 10)"
                        />
                      </div>
                      <div className="flex justify-between text-[10px] font-mono text-[var(--color-text-secondary)]">
                        <span className="flex items-center gap-1">
                          <span className="w-2 h-2 rounded-full bg-[var(--color-success)] inline-block" />
                          Low ({fileCcs.filter((c) => c.value <= 4).length})
                        </span>
                        <span className="flex items-center gap-1">
                          <span className="w-2 h-2 rounded-full bg-[var(--color-warning)] inline-block" />
                          Mod (
                          {
                            fileCcs.filter((c) => c.value > 4 && c.value <= 10)
                              .length
                          }
                          )
                        </span>
                        <span className="flex items-center gap-1">
                          <span className="w-2 h-2 rounded-full bg-[var(--color-danger)] inline-block" />
                          High ({fileCcs.filter((c) => c.value > 10).length})
                        </span>
                      </div>
                    </div>

                    {/* Navigation Help */}
                    <div className="rounded-[var(--radius-md)] p-4 border border-[var(--color-border)] bg-[var(--color-bg)]">
                      <div className="flex items-center gap-2 mb-2 text-[var(--color-primary)] font-bold text-xs font-mono uppercase tracking-wider">
                        <Info size={14} />
                        Call Graph Navigation
                      </div>
                      <p className="text-xs text-[var(--color-text-secondary)] leading-relaxed m-0">
                        Select a function node in the Call Graph to inspect its
                        internal Control Flow Graph, McCabe complexity index,
                        decision paths, and recommended test cases.
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
                    className="flex flex-col h-full"
                  >
                    {/* Header */}
                    <div className="flex items-center justify-between mb-4 pb-3 border-b border-[var(--color-border)]">
                      <div className="flex items-center gap-2">
                        <Activity
                          size={15}
                          className="text-[var(--color-primary)]"
                        />
                        <span className="text-xs font-mono font-bold uppercase tracking-wider text-[var(--color-text)]">
                          Complexity Analysis
                        </span>
                      </div>
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded-[var(--radius-sm)] bg-[var(--color-surface-secondary)] border border-[var(--color-border)] text-[var(--color-text-secondary)] font-semibold truncate max-w-[140px]">
                        {selectedFunc}()
                      </span>
                    </div>

                    {/* --- SELECTED NODE INSPECTOR --- */}
                    {selectedNode ? (
                      <div className="rounded-[var(--radius-md)] border-2 border-[var(--color-primary)]/40 bg-[var(--color-bg)] p-3.5 mb-4 shadow-sm">
                        <div className="flex items-center justify-between mb-2.5 pb-2 border-b border-[var(--color-border)]">
                          <div className="flex items-center gap-1.5 text-xs font-mono font-bold uppercase tracking-wider text-[var(--color-text)]">
                            <GitBranch
                              size={13}
                              className="text-[var(--color-primary)]"
                            />
                            <span>Node Inspector</span>
                          </div>
                          <button
                            onClick={() => {
                              setSelectedNodeId(null);
                              setHighlightedLine(null);
                            }}
                            title="Deselect Node"
                            className="flex items-center gap-1 text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors p-0.5 rounded-[var(--radius-sm)] hover:bg-[var(--color-surface-secondary)] cursor-pointer bg-transparent border-none text-[11px] font-mono"
                          >
                            <X size={12} />
                            <span>Deselect</span>
                          </button>
                        </div>

                        {/* Node Identity & Type */}
                        <div className="flex items-center justify-between gap-2 mb-2.5 flex-wrap">
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-sm font-bold text-[var(--color-text)]">
                              {selectedNode.label ||
                                selectedNode.type ||
                                selectedNode.id}
                            </span>
                            {selectedNode.line && (
                              <span className="text-[10px] font-mono font-bold text-[var(--color-primary)] bg-[var(--color-primary)]/10 border border-[var(--color-primary)]/20 px-2 py-0.5 rounded-[var(--radius-sm)]">
                                Line {selectedNode.line}
                              </span>
                            )}
                          </div>

                          <span
                            className={`text-[10px] font-mono font-bold uppercase px-2.5 py-0.5 rounded-full border ${
                              selectedNode.type === "condition"
                                ? "bg-[var(--color-warning)]/15 text-[var(--color-warning)] border-[var(--color-warning)]/30"
                                : selectedNode.type === "start"
                                  ? "bg-[var(--color-primary)]/15 text-[var(--color-primary)] border-[var(--color-primary)]/30"
                                  : selectedNode.type === "return" ||
                                      selectedNode.type === "exit"
                                    ? "bg-[var(--color-danger)]/15 text-[var(--color-danger)] border-[var(--color-danger)]/30"
                                    : "bg-[var(--color-surface-secondary)] text-[var(--color-text-secondary)] border-[var(--color-border)]"
                            }`}
                          >
                            {selectedNode.type === "condition"
                              ? "Decision (Branch)"
                              : selectedNode.type === "start"
                                ? "Function Entry"
                                : selectedNode.type === "return"
                                  ? "Return Exit"
                                  : selectedNode.type === "exit"
                                    ? "Virtual Exit"
                                    : "Sequential Stmt"}
                          </span>
                        </div>

                        {/* Code snippet preview */}
                        {selectedNodeLineText && (
                          <div className="mb-2.5 rounded-[var(--radius-sm)] bg-[var(--color-surface)] border border-[var(--color-border)] p-2 font-mono text-xs text-[var(--color-text)] leading-relaxed">
                            <div className="text-[9px] uppercase tracking-wider text-[var(--color-text-muted)] font-semibold mb-1 flex items-center justify-between">
                              <span>Source Line Preview</span>
                              <span className="text-[var(--color-primary)] font-bold">
                                L{selectedNode.line || activeCfg?.startLine}
                              </span>
                            </div>
                            <div className="text-xs font-mono whitespace-pre-wrap break-all text-[var(--color-text)] bg-[var(--color-bg)]/80 p-2 rounded-[var(--radius-sm)] border border-[var(--color-border)]/50">
                              {syntaxHighlight(selectedNodeLineText)}
                            </div>
                          </div>
                        )}

                        {/* Connectivity Grid */}
                        <div className="grid grid-cols-3 gap-1.5 mb-2.5">
                          <div className="p-1.5 rounded-[var(--radius-sm)] bg-[var(--color-surface)] border border-[var(--color-border)] text-center">
                            <div className="text-[9px] font-mono uppercase text-[var(--color-text-muted)] tracking-wider">
                              In-Degree
                            </div>
                            <div className="text-sm font-mono font-bold text-[var(--color-text)] mt-0.5">
                              {selectedNodeInEdges.length}
                            </div>
                          </div>
                          <div className="p-1.5 rounded-[var(--radius-sm)] bg-[var(--color-surface)] border border-[var(--color-border)] text-center">
                            <div className="text-[9px] font-mono uppercase text-[var(--color-text-muted)] tracking-wider">
                              Out-Degree
                            </div>
                            <div className="text-sm font-mono font-bold text-[var(--color-text)] mt-0.5">
                              {selectedNodeOutEdges.length}
                            </div>
                          </div>
                          <div className="p-1.5 rounded-[var(--radius-sm)] bg-[var(--color-surface)] border border-[var(--color-border)] text-center">
                            <div className="text-[9px] font-mono uppercase text-[var(--color-text-muted)] tracking-wider">
                              Complexity
                            </div>
                            <div
                              className={`text-sm font-mono font-bold mt-0.5 ${
                                selectedNode.type === "condition"
                                  ? "text-[var(--color-warning)]"
                                  : "text-[var(--color-text-secondary)]"
                              }`}
                            >
                              {selectedNode.type === "condition"
                                ? "+1 CC"
                                : "+0"}
                            </div>
                          </div>
                        </div>

                        {/* Node Flow Description */}
                        <div className="text-[11px] text-[var(--color-text-secondary)] bg-[var(--color-surface)] p-2 rounded-[var(--radius-sm)] border border-[var(--color-border)] leading-relaxed">
                          {selectedNode.type === "condition" && (
                            <span className="flex items-start gap-1.5">
                              <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-warning)] mt-1 flex-shrink-0 inline-block" />
                              <span>
                                <strong className="text-[var(--color-text)]">
                                  Branching Node:
                                </strong>{" "}
                                Evaluates predicate condition and creates 2
                                alternative execution branches (+1 McCabe
                                Complexity).
                              </span>
                            </span>
                          )}
                          {selectedNode.type === "start" && (
                            <span className="flex items-start gap-1.5">
                              <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-primary)] mt-1 flex-shrink-0 inline-block" />
                              <span>
                                <strong className="text-[var(--color-text)]">
                                  Entry Point:
                                </strong>{" "}
                                Function entry root node initializing call scope
                                and parameter bindings.
                              </span>
                            </span>
                          )}
                          {selectedNode.type === "return" && (
                            <span className="flex items-start gap-1.5">
                              <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-danger)] mt-1 flex-shrink-0 inline-block" />
                              <span>
                                <strong className="text-[var(--color-text)]">
                                  Return Statement:
                                </strong>{" "}
                                Terminates execution along this branch and
                                yields return value to caller.
                              </span>
                            </span>
                          )}
                          {selectedNode.type === "exit" && (
                            <span className="flex items-start gap-1.5">
                              <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-danger)] mt-1 flex-shrink-0 inline-block" />
                              <span>
                                <strong className="text-[var(--color-text)]">
                                  Terminal Sink:
                                </strong>{" "}
                                Virtual McCabe exit node absorbing all terminal
                                return paths (P = 1).
                              </span>
                            </span>
                          )}
                          {selectedNode.type !== "condition" &&
                            selectedNode.type !== "start" &&
                            selectedNode.type !== "return" &&
                            selectedNode.type !== "exit" && (
                              <span className="flex items-start gap-1.5">
                                <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-text-muted)] mt-1 flex-shrink-0 inline-block" />
                                <span>
                                  <strong className="text-[var(--color-text)]">
                                    Sequential Statement:
                                  </strong>{" "}
                                  Linear execution block without conditional
                                  branching.
                                </span>
                              </span>
                            )}
                        </div>
                      </div>
                    ) : (
                      <div className="rounded-[var(--radius-md)] border border-dashed border-[var(--color-border)] p-3 mb-4 text-center bg-[var(--color-bg)]/40">
                        <div className="flex items-center justify-center gap-1.5 text-xs text-[var(--color-text-secondary)] font-mono">
                          <Sparkles
                            size={13}
                            className="text-[var(--color-primary)]"
                          />
                          <span>
                            Click any node in graph to inspect its parameters
                          </span>
                        </div>
                      </div>
                    )}

                    {/* Radial Meter & Status Card */}
                    {(() => {
                      const ccVal = activeCc?.value || 1;
                      const meta = getComplexityMeta(ccVal);
                      const MetaIcon = meta.icon;
                      const circumference = 364.4; // 2 * PI * 58
                      const dashoffset =
                        circumference -
                        (circumference * Math.min(ccVal, 20)) / 20;

                      return (
                        <>
                          <div className="flex flex-col items-center justify-center p-5 mb-4 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg)]">
                            <div className="relative flex items-center justify-center w-36 h-36">
                              <svg className="w-full h-full -rotate-90">
                                <circle
                                  cx="72"
                                  cy="72"
                                  r="58"
                                  stroke="var(--color-border)"
                                  strokeWidth="10"
                                  fill="none"
                                  opacity="0.4"
                                />
                                <circle
                                  cx="72"
                                  cy="72"
                                  r="58"
                                  stroke={meta.color}
                                  strokeWidth="10"
                                  fill="none"
                                  strokeDasharray={circumference}
                                  strokeDashoffset={dashoffset}
                                  strokeLinecap="round"
                                  style={{
                                    transition:
                                      "stroke-dashoffset 0.6s cubic-bezier(0.4, 0, 0.2, 1)",
                                  }}
                                />
                              </svg>
                              <div className="absolute flex flex-col items-center">
                                <span className="text-3xl font-extrabold font-mono text-[var(--color-text)] tracking-tight">
                                  {ccVal}
                                </span>
                                <span className="text-[10px] font-mono font-bold tracking-wider text-[var(--color-text-secondary)] uppercase mt-0.5">
                                  McCabe CC
                                </span>
                              </div>
                            </div>

                            {/* Status Pill */}
                            <div className="mt-4 flex flex-col items-center gap-2.5 w-full">
                              <div
                                className={`inline-flex items-center gap-1.5 px-3.5 py-1 rounded-full text-xs font-semibold border ${meta.badgeClass}`}
                              >
                                <MetaIcon size={13} />
                                <span>
                                  {meta.level} Complexity ({meta.riskText})
                                </span>
                              </div>

                              {/* 4-Tier Interactive Scale Bar */}
                              <div className="w-full px-2 mt-1">
                                <div className="flex gap-1.5 h-1.5 w-full rounded-full overflow-hidden bg-[var(--color-border)]/50 p-0.5">
                                  <div
                                    className={`flex-1 rounded-full transition-all duration-300 ${
                                      meta.tier === 1
                                        ? "bg-[var(--color-success)] shadow-xs"
                                        : "bg-[var(--color-border)] opacity-30"
                                    }`}
                                  />
                                  <div
                                    className={`flex-1 rounded-full transition-all duration-300 ${
                                      meta.tier === 2
                                        ? "bg-[var(--color-warning)] shadow-xs"
                                        : "bg-[var(--color-border)] opacity-30"
                                    }`}
                                  />
                                  <div
                                    className={`flex-1 rounded-full transition-all duration-300 ${
                                      meta.tier === 3
                                        ? "bg-[var(--color-danger)] shadow-xs"
                                        : "bg-[var(--color-border)] opacity-30"
                                    }`}
                                  />
                                  <div
                                    className={`flex-1 rounded-full transition-all duration-300 ${
                                      meta.tier === 4
                                        ? "bg-[var(--color-danger)] shadow-xs"
                                        : "bg-[var(--color-border)] opacity-30"
                                    }`}
                                  />
                                </div>
                                <div className="flex justify-between text-[10px] font-mono text-[var(--color-text-muted)] mt-1.5 px-0.5">
                                  <span
                                    className={
                                      meta.tier === 1
                                        ? "text-[var(--color-success)] font-bold"
                                        : ""
                                    }
                                  >
                                    1-4 Low
                                  </span>
                                  <span
                                    className={
                                      meta.tier === 2
                                        ? "text-[var(--color-warning)] font-bold"
                                        : ""
                                    }
                                  >
                                    5-10 Mod
                                  </span>
                                  <span
                                    className={
                                      meta.tier === 3
                                        ? "text-[var(--color-danger)] font-bold"
                                        : ""
                                    }
                                  >
                                    11-20 High
                                  </span>
                                  <span
                                    className={
                                      meta.tier === 4
                                        ? "text-[var(--color-danger)] font-bold"
                                        : ""
                                    }
                                  >
                                    20+ Crit
                                  </span>
                                </div>
                              </div>
                            </div>
                          </div>

                          {/* Graph Formula Card */}
                          <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg)] p-4 mb-4">
                            <div className="flex items-center justify-between mb-3 pb-2.5 border-b border-[var(--color-border)]">
                              <div className="flex items-center gap-1.5 text-xs font-mono font-bold uppercase tracking-wider text-[var(--color-text)]">
                                <Calculator
                                  size={13}
                                  className="text-[var(--color-primary)]"
                                />
                                <span>Graph Formula</span>
                              </div>
                              <span className="text-[10px] font-mono font-bold text-[var(--color-primary)] bg-[var(--color-primary)]/10 px-2 py-0.5 rounded-[var(--radius-sm)] border border-[var(--color-primary)]/20">
                                M = E - N + 2P
                              </span>
                            </div>

                            {/* Equation calculation visualization */}
                            <div className="bg-[var(--color-surface)] rounded-[var(--radius-sm)] py-2 px-3 mb-3 border border-[var(--color-border)] flex items-center justify-center gap-2 font-mono text-xs text-[var(--color-text)]">
                              <span className="font-bold text-[var(--color-primary)] text-sm">
                                {ccVal}
                              </span>
                              <span className="text-[var(--color-text-muted)]">
                                =
                              </span>
                              <span className="font-semibold">
                                {graphLayout.edges.length}
                              </span>
                              <span className="text-[var(--color-text-muted)] text-[10px]">
                                (E)
                              </span>
                              <span className="text-[var(--color-text-muted)]">
                                -
                              </span>
                              <span className="font-semibold">
                                {graphLayout.nodes.length}
                              </span>
                              <span className="text-[var(--color-text-muted)] text-[10px]">
                                (N)
                              </span>
                              <span className="text-[var(--color-text-muted)]">
                                +
                              </span>
                              <span className="font-semibold">2</span>
                              <span className="text-[var(--color-text-muted)] text-[10px]">
                                (P)
                              </span>
                            </div>

                            {/* 3 Metrics Mini Cards Grid */}
                            <div className="grid grid-cols-3 gap-2">
                              <div className="p-2.5 rounded-[var(--radius-sm)] bg-[var(--color-surface)] border border-[var(--color-border)] text-center transition-colors hover:border-[var(--color-primary)]/40">
                                <div className="text-[10px] font-mono font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">
                                  Edges (E)
                                </div>
                                <div className="text-base font-mono font-bold text-[var(--color-primary)] mt-0.5">
                                  {graphLayout.edges.length}
                                </div>
                              </div>
                              <div className="p-2.5 rounded-[var(--radius-sm)] bg-[var(--color-surface)] border border-[var(--color-border)] text-center transition-colors hover:border-[var(--color-primary)]/40">
                                <div className="text-[10px] font-mono font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">
                                  Nodes (N)
                                </div>
                                <div className="text-base font-mono font-bold text-[var(--color-success)] mt-0.5">
                                  {graphLayout.nodes.length}
                                </div>
                              </div>
                              <div className="p-2.5 rounded-[var(--radius-sm)] bg-[var(--color-surface)] border border-[var(--color-border)] text-center transition-colors hover:border-[var(--color-primary)]/40">
                                <div className="text-[10px] font-mono font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">
                                  Exits (P)
                                </div>
                                <div className="text-base font-mono font-bold text-[var(--color-text)] mt-0.5">
                                  1
                                </div>
                              </div>
                            </div>
                          </div>

                          {/* QA & Testing Insights Card */}
                          <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg)] p-4">
                            <div className="flex items-center gap-1.5 text-xs font-mono font-bold uppercase tracking-wider text-[var(--color-text)] mb-3 pb-2 border-b border-[var(--color-border)]">
                              <ShieldCheck
                                size={13}
                                className="text-[var(--color-primary)]"
                              />
                              <span>QA & Testing Guidance</span>
                            </div>

                            <div className="space-y-2.5 text-xs">
                              <div className="flex items-start gap-2.5 text-[var(--color-text-secondary)]">
                                <div className="w-1.5 h-1.5 rounded-full bg-[var(--color-primary)] mt-1.5 flex-shrink-0" />
                                <div className="leading-relaxed">
                                  <strong className="text-[var(--color-text)]">
                                    Basis Path Coverage:
                                  </strong>{" "}
                                  Requires at least{" "}
                                  <span className="font-mono font-bold text-[var(--color-primary)]">
                                    {ccVal} independent test cases
                                  </span>{" "}
                                  to achieve 100% path coverage.
                                </div>
                              </div>
                              <div className="flex items-start gap-2.5 text-[var(--color-text-secondary)]">
                                <div className="w-1.5 h-1.5 rounded-full bg-[var(--color-primary)] mt-1.5 flex-shrink-0" />
                                <div className="leading-relaxed">
                                  <strong className="text-[var(--color-text)]">
                                    Decision Points:
                                  </strong>{" "}
                                  Detected{" "}
                                  <span className="font-mono font-bold text-[var(--color-text)]">
                                    {Math.max(0, ccVal - 1)} conditional
                                    branches
                                  </span>{" "}
                                  (if, switch, loop, ternary).
                                </div>
                              </div>
                              <div className="flex items-start gap-2.5 text-[var(--color-text-secondary)]">
                                <div className="w-1.5 h-1.5 rounded-full bg-[var(--color-primary)] mt-1.5 flex-shrink-0" />
                                <div className="leading-relaxed">
                                  <strong className="text-[var(--color-text)]">
                                    Recommendation:
                                  </strong>{" "}
                                  {meta.recommendation}
                                </div>
                              </div>
                            </div>
                          </div>
                        </>
                      );
                    })()}
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
