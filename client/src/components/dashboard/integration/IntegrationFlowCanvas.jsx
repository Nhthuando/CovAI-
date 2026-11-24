import { useMemo, useRef, useState, useEffect, useCallback } from "react";
import dagre from "dagre";
import { motion } from "framer-motion";
import {
  Send,
  Network,
  ShieldCheck,
  Cpu,
  Layers,
  Database,
  ArrowLeftRight,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  ZoomIn,
  ZoomOut,
  Maximize2,
  CornerDownLeft,
  GitBranch,
  FileInput,
  Cog,
} from "lucide-react";

const NODE_WIDTH = 188;
const NODE_HEIGHT = 76;

const LAYER_ICONS = {
  CLIENT: Send,
  ROUTER: Network,
  MIDDLEWARE: ShieldCheck,
  INPUT: FileInput,
  DECISION: GitBranch,
  CONTROLLER: Cpu,
  SERVICE: Layers,
  PROCESS: Cog,
  DATABASE: Database,
  RESPONSE: ArrowLeftRight,
  ASSERTION: CheckCircle2,
};

function computeFlowLayout(nodes = [], edges = [], rankdir = "LR") {
  if (!nodes.length) {
    return { width: 640, height: 320, nodes: [], edges: [] };
  }

  const g = new dagre.graphlib.Graph();
  g.setGraph({
    rankdir,
    marginx: 44,
    marginy: 44,
    nodesep: rankdir === "TB" ? 46 : 44,
    ranksep: rankdir === "TB" ? 56 : 68,
  });
  g.setDefaultEdgeLabel(() => ({}));

  nodes.forEach((n) => {
    g.setNode(n.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  });

  edges.forEach((e) => {
    if (g.hasNode(e.from) && g.hasNode(e.to)) {
      g.setEdge(e.from, e.to);
    }
  });

  dagre.layout(g);

  const graphInfo = g.graph();
  const width = Math.max(graphInfo.width || 640, 640);
  const height = Math.max(graphInfo.height || 300, 300);

  return {
    width,
    height,
    nodes: nodes.map((n) => {
      const pos = g.node(n.id);
      return {
        ...n,
        x: pos?.x || 100,
        y: pos?.y || 100,
        width: NODE_WIDTH,
        height: NODE_HEIGHT,
      };
    }),
    edges: edges
      .filter((e) => g.hasNode(e.from) && g.hasNode(e.to))
      .map((e) => {
        const edgeLayout = g.edge(e.from, e.to);
        return {
          ...e,
          points: edgeLayout?.points || [],
        };
      }),
  };
}

function buildSmoothSvgPath(points = []) {
  if (!points || points.length === 0) return "";
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;
  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length - 1; i++) {
    const curr = points[i];
    const next = points[i + 1];
    const midX = (curr.x + next.x) / 2;
    const midY = (curr.y + next.y) / 2;
    d += ` Q ${curr.x} ${curr.y} ${midX} ${midY}`;
  }
  const last = points[points.length - 1];
  d += ` L ${last.x} ${last.y}`;
  return d;
}

function getSemanticStatusColor(status, statusCode) {
  const code = Number(statusCode || 0);
  if (status === "ERROR" || code >= 500) {
    return {
      stroke: "#fb7185",
      badgeClass: "bg-rose-500/10 text-rose-400 border-rose-500/30",
      nodeBorder: "border-rose-500/60 bg-rose-500/10",
      dot: "bg-rose-400",
      marker: "url(#arrow-error)",
    };
  }
  if (status === "BLOCKED" || (code >= 400 && code < 500)) {
    return {
      stroke: "#fbbf24",
      badgeClass: "bg-amber-500/10 text-amber-400 border-amber-500/30",
      nodeBorder: "border-amber-500/60 bg-amber-500/10",
      dot: "bg-amber-400",
      marker: "url(#arrow-warn)",
    };
  }
  if (status === "PASS") {
    return {
      stroke: "#34d399",
      badgeClass: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30",
      nodeBorder: "border-emerald-500/50 bg-emerald-500/10",
      dot: "bg-emerald-400",
      marker: "url(#arrow-pass)",
    };
  }
  return {
    stroke: "#38bdf8",
    badgeClass: "bg-sky-500/10 text-sky-400 border-sky-500/30",
    nodeBorder: "border-sky-500/60 bg-sky-500/10",
    dot: "bg-sky-400",
    marker: "url(#arrow-active)",
  };
}

/**
 * Interactive SVG + HTML node pipeline diagram for Integration API flow simulation.
 * Renders the shared API topology and animates a Request Packet along traversed edges
 * according to the active test scenario's execution steps.
 */
export default function IntegrationFlowCanvas({
  graph = null,
  steps = [],
  currentStepIndex = 0,
  activeNodeIds = [],
  activeEdgeIds = [],
  isPlaying = false,
  playbackSpeed = 1,
  onSelectNode = null,
}) {
  const containerRef = useRef(null);
  const pathRefs = useRef(new Map());
  const rafRef = useRef(null);

  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [layoutOverride, setLayoutOverride] = useState(null); // null | "LR" | "TB"
  const panStartRef = useRef({ x: 0, y: 0 });
  const [packetPos, setPacketPos] = useState(null);

  const nodeCount = graph?.nodes?.length || 0;
  const effectiveDir = layoutOverride || (nodeCount > 8 ? "TB" : "LR");

  const layout = useMemo(
    () => computeFlowLayout(graph?.nodes || [], graph?.edges || [], effectiveDir),
    [graph, effectiveDir],
  );

  const nodeMap = useMemo(() => {
    const map = new Map();
    layout.nodes.forEach((n) => map.set(n.id, n));
    return map;
  }, [layout.nodes]);

  const activeNodeSet = useMemo(() => new Set(activeNodeIds), [activeNodeIds]);
  const activeEdgeSet = useMemo(() => new Set(activeEdgeIds), [activeEdgeIds]);

  const currentStep = steps[currentStepIndex] || null;

  // Map visited steps up to currentStepIndex for coloring traversed nodes & edges
  const visitedState = useMemo(() => {
    const nodeStatus = new Map();
    const edgeStatus = new Map();
    for (let i = 0; i <= currentStepIndex && i < steps.length; i++) {
      const s = steps[i];
      if (s?.nodeId) {
        nodeStatus.set(s.nodeId, { status: s.status, statusCode: s.statusCode });
      }
      if (s?.edgeId) {
        edgeStatus.set(s.edgeId, { status: s.status, statusCode: s.statusCode });
      }
    }
    return { nodeStatus, edgeStatus };
  }, [steps, currentStepIndex]);

  const fitToView = useCallback(() => {
    const el = containerRef.current;
    if (!el || !layout.width || !layout.height) return;
    const rect = el.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const scaleX = (rect.width - 32) / layout.width;
    const scaleY = (rect.height - 32) / layout.height;
    const nextZoom = Math.max(0.32, Math.min(1.15, Math.min(scaleX, scaleY)));
    const nextX = (rect.width - layout.width * nextZoom) / 2;
    const nextY = (rect.height - layout.height * nextZoom) / 2;
    setZoom(Number(nextZoom.toFixed(2)));
    setPan({ x: Math.round(nextX), y: Math.round(nextY) });
  }, [layout.width, layout.height]);

  useEffect(() => {
    const id = requestAnimationFrame(() => fitToView());
    return () => cancelAnimationFrame(id);
  }, [fitToView]);

  // Animate Request Packet along the active edge path using SVG getPointAtLength
  useEffect(() => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }

    if (!currentStep) {
      return;
    }

    const activeNode = nodeMap.get(currentStep.nodeId);
    const edgeId = currentStep.edgeId;
    const pathEl = edgeId ? pathRefs.current.get(edgeId) : null;

    if (!edgeId || !pathEl || typeof pathEl.getTotalLength !== "function") {
      if (activeNode) {
        rafRef.current = requestAnimationFrame(() => {
          setPacketPos({ x: activeNode.x, y: activeNode.y - NODE_HEIGHT / 2 - 14 });
        });
      }
      return () => {
        if (rafRef.current) cancelAnimationFrame(rafRef.current);
      };
    }

    const totalLength = pathEl.getTotalLength();
    if (!totalLength || totalLength <= 0) {
      if (activeNode) {
        rafRef.current = requestAnimationFrame(() => {
          setPacketPos({ x: activeNode.x, y: activeNode.y - NODE_HEIGHT / 2 - 14 });
        });
      }
      return () => {
        if (rafRef.current) cancelAnimationFrame(rafRef.current);
      };
    }

    const durationMs = Math.max(200, Math.round(520 / playbackSpeed));
    const startTime = performance.now();

    const tick = (now) => {
      const elapsed = now - startTime;
      const rawT = Math.min(1, elapsed / durationMs);
      // Smooth cubic ease-out
      const easedT = 1 - Math.pow(1 - rawT, 3);
      try {
        const pt = pathEl.getPointAtLength(easedT * totalLength);
        setPacketPos({ x: pt.x, y: pt.y });
      } catch {
        if (activeNode) setPacketPos({ x: activeNode.x, y: activeNode.y });
      }
      if (rawT < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else if (activeNode) {
        setPacketPos({ x: activeNode.x, y: activeNode.y - NODE_HEIGHT / 2 - 14 });
      }
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [currentStep, nodeMap, playbackSpeed]);

  const handlePointerDown = (e) => {
    if (e.target.closest("[data-no-pan='true']")) return;
    setIsPanning(true);
    panStartRef.current = { x: e.clientX - pan.x, y: e.clientY - pan.y };
  };

  const handlePointerMove = (e) => {
    if (!isPanning) return;
    setPan({
      x: e.clientX - panStartRef.current.x,
      y: e.clientY - panStartRef.current.y,
    });
  };

  const handlePointerUp = () => setIsPanning(false);

  const handleWheel = (e) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
    }
    const delta = e.deltaY > 0 ? -0.08 : 0.08;
    setZoom((z) => Number(Math.max(0.4, Math.min(1.8, z + delta)).toFixed(2)));
  };

  const packetSemantic = currentStep
    ? getSemanticStatusColor(currentStep.status, currentStep.statusCode)
    : getSemanticStatusColor("ACTIVE", null);

  return (
    <div
      ref={containerRef}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerUp}
      onWheel={handleWheel}
      className={`relative w-full h-full overflow-hidden bg-[var(--color-bg)] select-none ${
        isPanning ? "cursor-grabbing" : "cursor-grab"
      }`}
    >
      {/* Subtle engineering dot grid background */}
      <div
        className="absolute inset-0 pointer-events-none opacity-25"
        style={{
          backgroundImage:
            "radial-gradient(var(--color-border-strong) 1px, transparent 1px)",
          backgroundSize: "20px 20px",
        }}
      />

      {/* Zoom & Fit Controls */}
      <div
        data-no-pan="true"
        className="absolute top-3 right-3 z-20 flex items-center gap-1 p-1 rounded-md bg-[var(--color-surface)] border border-[var(--color-border)]"
      >
        <button
          type="button"
          onClick={() => setZoom((z) => Number(Math.max(0.4, z - 0.12).toFixed(2)))}
          title="Zoom Out"
          className="p-1.5 rounded text-[var(--color-text-secondary)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-secondary)] transition-colors duration-150 cursor-pointer"
        >
          <ZoomOut className="w-3.5 h-3.5" />
        </button>
        <span className="px-1.5 text-[11px] font-mono tabular-nums text-[var(--color-text-muted)]">
          {Math.round(zoom * 100)}%
        </span>
        <button
          type="button"
          onClick={() => setZoom((z) => Number(Math.min(1.8, z + 0.12).toFixed(2)))}
          title="Zoom In"
          className="p-1.5 rounded text-[var(--color-text-secondary)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-secondary)] transition-colors duration-150 cursor-pointer"
        >
          <ZoomIn className="w-3.5 h-3.5" />
        </button>
        <div className="w-px h-4 bg-[var(--color-border)] mx-0.5" />
        <button
          type="button"
          onClick={() => setLayoutOverride(effectiveDir === "LR" ? "TB" : "LR")}
          title={`Switch layout (${effectiveDir === "LR" ? "Vertical" : "Horizontal"})`}
          className="px-1.5 py-1 rounded text-[10px] font-mono text-[var(--color-text-secondary)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-secondary)] transition-colors duration-150 cursor-pointer"
        >
          {effectiveDir}
        </button>
        <div className="w-px h-4 bg-[var(--color-border)] mx-0.5" />
        <button
          type="button"
          onClick={fitToView}
          title="Fit Graph to View"
          className="p-1.5 rounded text-[var(--color-text-secondary)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-secondary)] transition-colors duration-150 cursor-pointer"
        >
          <Maximize2 className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Legend Strip */}
      <div
        data-no-pan="true"
        className="absolute bottom-3 left-3 z-20 flex flex-wrap items-center gap-3 px-2.5 py-1.5 rounded-md bg-[var(--color-surface)] border border-[var(--color-border)] text-[10px] font-mono text-[var(--color-text-muted)]"
      >
        <span className="inline-flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-sky-400" />
          Request
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-emerald-400" />
          2xx Pass
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-amber-400" />
          4xx Guard / Reject
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-rose-400" />
          5xx / Failure
        </span>
      </div>

      {/* Transformed Canvas Layer */}
      <div
        style={{
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
          transformOrigin: "0 0",
          width: layout.width,
          height: layout.height,
        }}
        className="relative"
      >
        {/* SVG Edges Layer */}
        <svg
          width={layout.width}
          height={layout.height}
          className="absolute inset-0 overflow-visible pointer-events-none"
        >
          <defs>
            {[
              { id: "arrow-idle", color: "#475569" },
              { id: "arrow-active", color: "#38bdf8" },
              { id: "arrow-pass", color: "#34d399" },
              { id: "arrow-warn", color: "#fbbf24" },
              { id: "arrow-error", color: "#fb7185" },
            ].map((m) => (
              <marker
                key={m.id}
                id={m.id}
                markerWidth="8"
                markerHeight="8"
                refX="7"
                refY="4"
                orient="auto"
              >
                <path d="M 0 1 L 7 4 L 0 7 z" fill={m.color} />
              </marker>
            ))}
          </defs>

          {layout.edges.map((edge) => {
            const pathD = buildSmoothSvgPath(edge.points);
            const isInScenarioPath = activeEdgeSet.has(edge.id);
            const traversed = visitedState.edgeStatus.get(edge.id);
            const isCurrentEdge = currentStep?.edgeId === edge.id;

            let stroke = "#334155";
            let marker = "url(#arrow-idle)";
            let strokeWidth = 1.5;
            let opacity = isInScenarioPath ? 0.55 : 0.18;
            let dashArray = edge.kind === "reject" || edge.kind === "error" ? "4 4" : undefined;

            if (traversed) {
              const sem = getSemanticStatusColor(traversed.status, traversed.statusCode);
              stroke = sem.stroke;
              marker = sem.marker;
              strokeWidth = isCurrentEdge ? 2.6 : 2.1;
              opacity = 0.95;
              dashArray = undefined;
            }

            const midPt =
              edge.points.length > 0
                ? edge.points[Math.floor(edge.points.length / 2)]
                : null;

            return (
              <g key={edge.id}>
                <path
                  ref={(el) => {
                    if (el) pathRefs.current.set(edge.id, el);
                    else pathRefs.current.delete(edge.id);
                  }}
                  d={pathD}
                  fill="none"
                  stroke={stroke}
                  strokeWidth={strokeWidth}
                  strokeDasharray={dashArray}
                  strokeOpacity={opacity}
                  markerEnd={marker}
                  style={{ transition: "stroke 150ms ease, stroke-opacity 150ms ease" }}
                />
                {edge.label && midPt && (isInScenarioPath || traversed) && (
                  <g transform={`translate(${midPt.x}, ${midPt.y - 10})`}>
                    <rect
                      x={-Math.min(72, edge.label.length * 3.3 + 8)}
                      y={-9}
                      width={Math.min(144, edge.label.length * 6.6 + 16)}
                      height={16}
                      rx={4}
                      fill="var(--color-surface)"
                      stroke="var(--color-border)"
                      strokeWidth={1}
                      opacity={traversed ? 0.95 : 0.65}
                    />
                    <text
                      textAnchor="middle"
                      y={2.5}
                      fontSize={9}
                      fontFamily="var(--font-mono)"
                      fill={traversed ? stroke : "var(--color-text-muted)"}
                    >
                      {edge.label.length > 22
                        ? `${edge.label.slice(0, 20)}…`
                        : edge.label}
                    </text>
                  </g>
                )}
              </g>
            );
          })}
        </svg>

        {/* HTML Node Cards Layer */}
        {layout.nodes.map((node) => {
          const Icon = LAYER_ICONS[node.kind] || Cpu;
          const isCurrent = currentStep?.nodeId === node.id;
          const visited = visitedState.nodeStatus.get(node.id);
          const isInScenario = activeNodeSet.has(node.id);
          const sem = visited
            ? getSemanticStatusColor(visited.status, visited.statusCode)
            : null;

          const borderClass = isCurrent
            ? `${sem?.nodeBorder || "border-sky-400 bg-sky-500/10"} ring-2 ring-[var(--color-primary)]/40`
            : visited
              ? sem?.nodeBorder || "border-[var(--color-border-strong)] bg-[var(--color-surface)]"
              : "border-[var(--color-border)] bg-[var(--color-surface)]";

          const branchesCount = node.meta?.branches?.length || 0;
          const dbModelsCount = node.meta?.models?.length || 0;

          return (
            <motion.button
              key={node.id}
              type="button"
              data-no-pan="true"
              onClick={() => isInScenario && onSelectNode?.(node.id)}
              initial={false}
              animate={{
                scale: isCurrent ? 1.03 : 1,
                opacity: isInScenario || activeNodeSet.size === 0 ? 1 : 0.3,
              }}
              transition={{ duration: 0.16 }}
              style={{
                position: "absolute",
                left: node.x - node.width / 2,
                top: node.y - node.height / 2,
                width: node.width,
                height: node.height,
              }}
              className={`text-left rounded-md border px-2.5 py-2 flex flex-col justify-between transition-colors duration-150 ${borderClass} ${
                isInScenario ? "cursor-pointer hover:border-[var(--color-primary)]/60" : "cursor-default"
              }`}
            >
              <div className="flex items-center justify-between gap-1.5">
                <div className="flex items-center gap-1.5 min-w-0">
                  <Icon className="w-3.5 h-3.5 text-[var(--color-text-secondary)] shrink-0" />
                  <span className="text-[9px] font-mono font-semibold uppercase tracking-wider text-[var(--color-text-muted)] truncate">
                    {node.layer}
                  </span>
                </div>
                {isCurrent ? (
                  <span className="relative flex h-2 w-2 shrink-0">
                    {isPlaying && (
                      <span
                        className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${
                          sem?.dot || "bg-sky-400"
                        }`}
                      />
                    )}
                    <span
                      className={`relative inline-flex rounded-full h-2 w-2 ${
                        sem?.dot || "bg-sky-400"
                      }`}
                    />
                  </span>
                ) : visited ? (
                  visited.status === "ERROR" ? (
                    <XCircle className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                  ) : visited.status === "BLOCKED" ? (
                    <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                  ) : (
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                  )
                ) : null}
              </div>

              <div className="min-w-0">
                <div className="text-[11px] font-mono font-semibold text-[var(--color-text)] truncate">
                  {node.title}
                </div>
                <div className="text-[10px] font-mono text-[var(--color-text-muted)] truncate">
                  {node.subtitle}
                </div>
              </div>

              {(branchesCount > 0 || dbModelsCount > 0) && (
                <div className="flex items-center gap-1.5 text-[9px] font-mono text-[var(--color-text-muted)]">
                  {branchesCount > 0 && (
                    <span className="px-1 rounded bg-[var(--color-surface-secondary)] border border-[var(--color-border)] tabular-nums">
                      {branchesCount} {branchesCount === 1 ? "branch" : "branches"}
                    </span>
                  )}
                  {dbModelsCount > 0 && (
                    <span className="px-1 rounded bg-[var(--color-surface-secondary)] border border-[var(--color-border)] tabular-nums">
                      {dbModelsCount} {dbModelsCount === 1 ? "model" : "models"}
                    </span>
                  )}
                </div>
              )}
            </motion.button>
          );
        })}

        {/* Animated Request Packet Indicator */}
        {packetPos && currentStep && (
          <div
            style={{
              position: "absolute",
              left: packetPos.x,
              top: packetPos.y,
              transform: "translate(-50%, -50%)",
            }}
            className={`z-30 pointer-events-none inline-flex items-center gap-1.5 px-2 py-1 rounded-md border text-[10px] font-mono font-bold tabular-nums shadow-sm ${packetSemantic.badgeClass} bg-[var(--color-surface)]`}
          >
            {currentStep.direction === "return" ? (
              <CornerDownLeft className="w-3 h-3 shrink-0" />
            ) : (
              <Send className="w-3 h-3 shrink-0" />
            )}
            <span>
              {currentStep.statusCode
                ? `HTTP ${currentStep.statusCode}`
                : currentStep.requestState?.method || "REQ"}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
