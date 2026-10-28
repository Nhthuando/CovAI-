import React, {
  useState,
  useEffect,
  useMemo,
  useRef,
  useCallback,
} from "react";
import { motion, AnimatePresence } from "framer-motion";
import dagre from "dagre";
import {
  Network,
  RefreshCw,
  Play,
  CircleDot,
  AlertTriangle,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Sparkles,
  Layers,
  Box,
  FileCode,
  FunctionSquare,
  ArrowRight,
  ArrowLeft,
  X,
  Filter,
  LayoutGrid,
  ChevronRight,
  PanelRightClose,
  PanelRightOpen,
  ArrowDownUp,
  Sliders,
} from "lucide-react";
import {
  getProjectSnapshotsApi,
  getProjectStructureAnalysisApi,
  runProjectStructureAnalysisApi,
  getArchitectureAiSummaryApi,
} from "../../services/project.service";
import { getProjectJobsApi } from "../../services/job.service";

/* --- ROLE VISUAL THEMES (DUAL-THEME ACCESSIBLE) --- */
export const ROLE_THEMES = {
  route: {
    label: "Route",
    color: "#3b82f6",
    bg: "rgba(59, 130, 246, 0.12)",
    border: "#3b82f6",
  },
  controller: {
    label: "Controller",
    color: "#06b6d4",
    bg: "rgba(6, 182, 212, 0.12)",
    border: "#06b6d4",
  },
  service: {
    label: "Service",
    color: "#8b5cf6",
    bg: "rgba(139, 92, 246, 0.12)",
    border: "#8b5cf6",
  },
  component: {
    label: "Component",
    color: "#10b981",
    bg: "rgba(16, 185, 129, 0.12)",
    border: "#10b981",
  },
  page: {
    label: "Page",
    color: "#14b8a6",
    bg: "rgba(20, 184, 166, 0.12)",
    border: "#14b8a6",
  },
  hook: {
    label: "Hook",
    color: "#6366f1",
    bg: "rgba(99, 102, 241, 0.12)",
    border: "#6366f1",
  },
  model: {
    label: "Model",
    color: "#ec4899",
    bg: "rgba(236, 72, 153, 0.12)",
    border: "#ec4899",
  },
  validator: {
    label: "Validator",
    color: "#f59e0b",
    bg: "rgba(245, 158, 11, 0.12)",
    border: "#f59e0b",
  },
  utility: {
    label: "Utility",
    color: "#64748b",
    bg: "rgba(100, 116, 139, 0.12)",
    border: "#64748b",
  },
  config: {
    label: "Config",
    color: "#f43f5e",
    bg: "rgba(244, 63, 94, 0.12)",
    border: "#f43f5e",
  },
  test: {
    label: "Test",
    color: "#f97316",
    bg: "rgba(249, 115, 22, 0.12)",
    border: "#f97316",
  },
  unknown: {
    label: "Other",
    color: "#64748b",
    bg: "rgba(100, 116, 139, 0.12)",
    border: "#64748b",
  },
};

const STATUS_COPY = {
  QUEUED: "Queued",
  RUNNING: "Analyzing",
  SUCCESS: "Completed",
  FAILED: "Failed",
  CANCELED: "Canceled",
};

const pointsToSvgPath = (points) => {
  if (!points || points.length === 0) return "";
  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length; i++) {
    d += ` L ${points[i].x} ${points[i].y}`;
  }
  return d;
};

export default function ProjectArchitecturePanel({ projectId, initialFile }) {
  const [snapshots, setSnapshots] = useState([]);
  const [snapshotId, setSnapshotId] = useState("");
  const [analysis, setAnalysis] = useState(null);
  const [job, setJob] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Views & Filters
  const [viewMode, setViewMode] = useState("overview"); // "overview" | "module"
  const [selectedDomain, setSelectedDomain] = useState("All");
  const [selectedRoles, setSelectedRoles] = useState(new Set());
  const [orientation, setOrientation] = useState("LR"); // "LR" | "TB"
  const [cardScale, setCardScale] = useState(1); // 1 | 1.15 for size adjustment

  // Selection & Inspector
  const [selectedNodeId, setSelectedNodeId] = useState(null);
  const [hoveredNodeId, setHoveredNodeId] = useState(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(true);
  const [drawerWidth, setDrawerWidth] = useState(400);
  const [isResizingDrawer, setIsResizingDrawer] = useState(false);

  // AI Summary State
  const [aiSummaryMap, setAiSummaryMap] = useState({});
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [aiError, setAiError] = useState("");

  // Pan & Zoom
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 50, y: 50 });
  const [isDragging, setIsDragging] = useState(false);
  const dragOriginRef = useRef({ startX: 0, startY: 0, panX: 0, panY: 0 });
  const canvasRef = useRef(null);

  // Load Snapshots
  const loadSnapshots = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    try {
      const response = await getProjectSnapshotsApi(projectId);
      const nextSnapshots = response.data || [];
      setSnapshots(nextSnapshots);
      setSnapshotId((curr) =>
        nextSnapshots.some((s) => s.id === curr)
          ? curr
          : nextSnapshots[0]?.id || "",
      );
      setError("");
    } catch (err) {
      setError(err.message || "Failed to load project snapshots.");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  // Load Architecture Analysis Data
  const loadAnalysis = useCallback(async () => {
    if (!projectId || !snapshotId) return;
    setLoading(true);
    try {
      const response = await getProjectStructureAnalysisApi(
        projectId,
        snapshotId,
      );
      const data = response.data;
      setAnalysis(data);

      if (data?.graph?.nodes) {
        const availableRoles = new Set(data.graph.nodes.map((n) => n.role));
        setSelectedRoles(availableRoles);

        if (initialFile) {
          const matched = data.graph.nodes.find(
            (n) => n.relativePath === initialFile || n.id === initialFile,
          );
          if (matched) setSelectedNodeId(matched.id);
        } else if (!selectedNodeId && data.graph.nodes.length > 0) {
          setSelectedNodeId(data.graph.nodes[0].id);
        }
      }
      setError("");
    } catch (err) {
      if (/Architecture analysis not found/i.test(err.message)) {
        setAnalysis(null);
      } else {
        setError(err.message || "Failed to load architecture analysis.");
      }
    } finally {
      setLoading(false);
    }
  }, [projectId, snapshotId, initialFile]);

  useEffect(() => {
    loadSnapshots();
  }, [loadSnapshots]);

  useEffect(() => {
    loadAnalysis();
  }, [loadAnalysis]);

  // Polling if job is running
  useEffect(() => {
    if (!job || !["QUEUED", "RUNNING"].includes(job.status) || !projectId)
      return;
    const poll = async () => {
      try {
        const response = await getProjectJobsApi(projectId);
        const updated = (response.jobs || []).find((j) => j.id === job.id);
        if (!updated) return;
        setJob(updated);
        if (updated.status === "SUCCESS") loadAnalysis();
        if (updated.status === "FAILED") {
          setError(updated.errorMessage || "Architecture analysis failed.");
        }
      } catch {
        /* ignore polling errors */
      }
    };
    const timer = setInterval(poll, 2500);
    return () => clearInterval(timer);
  }, [job, loadAnalysis, projectId]);

  const startAnalysis = async () => {
    if (!projectId) return;
    setLoading(true);
    try {
      const response = await runProjectStructureAnalysisApi(
        projectId,
        snapshotId || undefined,
      );
      setJob(response.job || response.data?.job || null);
      setError("");
    } catch (err) {
      setError(err.message || "Failed to start architecture analysis.");
    } finally {
      setLoading(false);
    }
  };

  // Node & Edge filtering
  const allNodes = analysis?.graph?.nodes || [];
  const allEdges = analysis?.graph?.edges || [];

  // Distinct Domains
  const availableDomains = useMemo(() => {
    const set = new Set();
    allNodes.forEach((n) => {
      if (n.domain) set.add(n.domain);
    });
    return Array.from(set).sort();
  }, [allNodes]);

  // Distinct Roles
  const availableRoles = useMemo(() => {
    const counts = {};
    allNodes.forEach((n) => {
      counts[n.role] = (counts[n.role] || 0) + 1;
    });
    return Object.entries(counts).sort((a, b) => b[1] - a[1]);
  }, [allNodes]);

  // Filtered nodes based on View Mode + Domain + Role Filter
  const visibleNodes = useMemo(() => {
    return allNodes.filter((node) => {
      if (selectedRoles.size > 0 && !selectedRoles.has(node.role)) {
        return false;
      }
      if (viewMode === "module" && selectedDomain !== "All") {
        return node.domain === selectedDomain;
      }
      return true;
    });
  }, [allNodes, selectedRoles, viewMode, selectedDomain]);

  const visibleNodeIds = useMemo(
    () => new Set(visibleNodes.map((n) => n.id)),
    [visibleNodes],
  );

  const visibleEdges = useMemo(() => {
    return allEdges.filter(
      (e) => visibleNodeIds.has(e.from) && visibleNodeIds.has(e.to),
    );
  }, [allEdges, visibleNodeIds]);

  // Node dimensions based on scale (sleek, compact, unclipped)
  const nodeWidth = Math.round(230 * cardScale);
  const nodeHeight = Math.round(78 * cardScale);

  // Compute Dagre Layout
  const layout = useMemo(() => {
    if (visibleNodes.length === 0) {
      return { width: 400, height: 300, nodes: [], edges: [] };
    }

    const g = new dagre.graphlib.Graph();
    g.setGraph({
      rankdir: orientation,
      marginx: 50,
      marginy: 50,
      nodesep: orientation === "LR" ? 45 : 60,
      ranksep: orientation === "LR" ? 75 : 65,
    });
    g.setDefaultEdgeLabel(() => ({}));

    visibleNodes.forEach((node) => {
      g.setNode(node.id, { width: nodeWidth, height: nodeHeight });
    });

    visibleEdges.forEach((edge) => {
      g.setEdge(edge.from, edge.to);
    });

    dagre.layout(g);

    const graphInfo = g.graph();
    const graphWidth = Math.max(graphInfo.width || 0, 500);
    const graphHeight = Math.max(graphInfo.height || 0, 400);

    const positionedNodes = visibleNodes.map((node) => {
      const pos = g.node(node.id);
      return {
        ...node,
        x: pos ? pos.x - nodeWidth / 2 : 0,
        y: pos ? pos.y - nodeHeight / 2 : 0,
        width: nodeWidth,
        height: nodeHeight,
      };
    });

    const positionedEdges = visibleEdges.map((edge) => {
      const edgeData = g.edge(edge.from, edge.to);
      return {
        ...edge,
        points: edgeData?.points || [],
      };
    });

    return {
      width: graphWidth + 120,
      height: graphHeight + 120,
      nodes: positionedNodes,
      edges: positionedEdges,
    };
  }, [visibleNodes, visibleEdges, orientation, nodeWidth, nodeHeight]);

  // Hover Focus Connections (dimming ONLY applies when hovering!)
  const hoverFocusInfo = useMemo(() => {
    if (!hoveredNodeId) {
      return {
        connectedNodeIds: new Set(),
        incomingEdgeIds: new Set(),
        outgoingEdgeIds: new Set(),
      };
    }
    const incomingEdgeIds = new Set();
    const outgoingEdgeIds = new Set();
    const connectedNodeIds = new Set([hoveredNodeId]);

    allEdges.forEach((e) => {
      if (e.from === hoveredNodeId) {
        outgoingEdgeIds.add(e.id);
        connectedNodeIds.add(e.to);
      }
      if (e.to === hoveredNodeId) {
        incomingEdgeIds.add(e.id);
        connectedNodeIds.add(e.from);
      }
    });

    return { connectedNodeIds, incomingEdgeIds, outgoingEdgeIds };
  }, [hoveredNodeId, allEdges]);

  // Selected Node Details
  const selectedNode = useMemo(
    () => allNodes.find((n) => n.id === selectedNodeId) || null,
    [allNodes, selectedNodeId],
  );

  // Incoming & Outgoing for selected node
  const selectedNodeDeps = useMemo(() => {
    if (!selectedNodeId) return { incoming: [], outgoing: [] };
    const incoming = [];
    const outgoing = [];

    allEdges.forEach((e) => {
      if (e.from === selectedNodeId) {
        const target = allNodes.find((n) => n.id === e.to);
        if (target) outgoing.push(target);
      }
      if (e.to === selectedNodeId) {
        const source = allNodes.find((n) => n.id === e.from);
        if (source) incoming.push(source);
      }
    });

    return { incoming, outgoing };
  }, [allEdges, allNodes, selectedNodeId]);

  // AI Summary Handler
  const handleGenerateAiSummary = useCallback(
    async (filePath, force = false) => {
      if (!filePath || !projectId || !snapshotId) return;
      if (!force && aiSummaryMap[filePath]) return;

      setIsAiLoading(true);
      setAiError("");
      try {
        const res = await getArchitectureAiSummaryApi(projectId, {
          snapshotId,
          filePath,
          force,
        });
        if (res.data) {
          setAiSummaryMap((prev) => ({
            ...prev,
            [filePath]: res.data,
          }));
        }
      } catch (err) {
        setAiError(err.message || "Failed to generate AI summary.");
      } finally {
        setIsAiLoading(false);
      }
    },
    [projectId, snapshotId, aiSummaryMap],
  );

  // Automatically fetch AI Summary when a file node is selected
  useEffect(() => {
    const filePath = selectedNode?.relativePath;
    if (!filePath || !projectId || !snapshotId) return;
    if (aiSummaryMap[filePath]) return;

    let isCancelled = false;
    setIsAiLoading(true);
    setAiError("");

    getArchitectureAiSummaryApi(projectId, { snapshotId, filePath })
      .then((res) => {
        if (!isCancelled && res?.data) {
          setAiSummaryMap((prev) => ({
            ...prev,
            [filePath]: res.data,
          }));
        }
      })
      .catch((err) => {
        if (!isCancelled) {
          setAiError(err.message || "Failed to generate AI summary.");
        }
      })
      .finally(() => {
        if (!isCancelled) {
          setIsAiLoading(false);
        }
      });

    return () => {
      isCancelled = true;
    };
  }, [selectedNode?.relativePath, projectId, snapshotId, aiSummaryMap]);

  // Toggle role filter
  const toggleRole = (role) => {
    setSelectedRoles((prev) => {
      const next = new Set(prev);
      if (next.has(role)) {
        if (next.size > 1) next.delete(role);
      } else {
        next.add(role);
      }
      return next;
    });
  };

  const selectAllRoles = () => {
    setSelectedRoles(new Set(availableRoles.map(([r]) => r)));
  };

  // Pan & Zoom Event Handlers
  const handleMouseDown = (e) => {
    if (e.button !== 0) return;
    setIsDragging(true);
    dragOriginRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      panX: pan.x,
      panY: pan.y,
    };
  };

  const handleMouseMove = (e) => {
    if (!isDragging) return;
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

  const handleWheel = (e) => {
    e.preventDefault();
    const zoomFactor = e.deltaY < 0 ? 1.08 : 0.92;
    setZoom((prev) => Math.max(0.25, Math.min(2.5, prev * zoomFactor)));
  };

  const handleResetView = () => {
    setZoom(1);
    setPan({ x: 50, y: 50 });
  };

  const handleFitView = () => {
    if (!canvasRef.current || layout.width === 0) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const scaleX = (rect.width - 80) / layout.width;
    const scaleY = (rect.height - 80) / layout.height;
    const newZoom = Math.max(0.35, Math.min(1.2, Math.min(scaleX, scaleY)));
    setZoom(newZoom);
    setPan({
      x: (rect.width - layout.width * newZoom) / 2,
      y: Math.max(25, (rect.height - layout.height * newZoom) / 2),
    });
  };

  // Drawer Resizing
  const handleDrawerResizeStart = (e) => {
    e.preventDefault();
    setIsResizingDrawer(true);
    const startX = e.clientX;
    const startWidth = drawerWidth;

    const onMouseMove = (moveEvent) => {
      const deltaX = startX - moveEvent.clientX;
      setDrawerWidth(Math.max(280, Math.min(700, startWidth + deltaX)));
    };

    const onMouseUp = () => {
      setIsResizingDrawer(false);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  };

  // Jump to node from inspector
  const jumpToNode = (nodeId) => {
    setSelectedNodeId(nodeId);
    const target = layout.nodes.find((n) => n.id === nodeId);
    if (target && canvasRef.current) {
      const rect = canvasRef.current.getBoundingClientRect();
      setPan({
        x: rect.width / 2 - (target.x + target.width / 2) * zoom,
        y: rect.height / 2 - (target.y + target.height / 2) * zoom,
      });
    }
  };

  const status = job?.status || (analysis ? "SUCCESS" : null);

  const analysisProgress = useMemo(() => {
    if (status === "SUCCESS") return 100;
    if (job?.progress !== undefined && job?.progress !== null) {
      return Math.min(100, Math.max(0, Math.round(job.progress)));
    }
    if (status === "RUNNING") return 65;
    if (status === "QUEUED") return 15;
    if (loading) return 40;
    return 0;
  }, [status, job?.progress, loading]);

  if (!projectId) {
    return (
      <section className="p-8 text-xs text-[var(--color-text-muted)] text-center">
        Please select a project to view its architecture.
      </section>
    );
  }

  return (
    <section className="flex flex-col h-full w-full overflow-hidden bg-[var(--color-bg)] text-[var(--color-text)] font-sans select-none">
      {/* --- TOP HEADER & CONTROLS --- */}
      <header className="shrink-0 px-4 py-2.5 border-b border-[var(--color-border)] bg-[var(--color-surface)] flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 text-xs text-[var(--color-text-muted)] font-mono">
            <Network size={14} className="text-[var(--color-primary)]" />
            <span>Architecture</span>
            <span>/</span>
            <span className="text-[var(--color-text)] font-medium">
              Network Graph
            </span>
          </div>
          {status && (
            <span
              className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-[var(--radius-sm)] text-[11px] font-mono border font-medium ${
                status === "SUCCESS"
                  ? "bg-[var(--color-success)]/10 text-[var(--color-success)] border-[var(--color-success)]/20"
                  : status === "RUNNING"
                    ? "bg-[var(--color-warning)]/10 text-[var(--color-warning)] border-[var(--color-warning)]/20 animate-pulse"
                    : "bg-[var(--color-surface-secondary)] text-[var(--color-text-muted)] border-[var(--color-border)]"
              }`}
            >
              <CircleDot size={10} />
              {STATUS_COPY[status] || status}
            </span>
          )}
          {status && (
            <div
              className="flex items-center gap-2 pl-2.5 border-l border-[var(--color-border)]"
              title={`Analysis Progress: ${analysisProgress}%`}
            >
              <div className="w-20 sm:w-28 h-1.5 rounded-full bg-[var(--color-surface-secondary)] border border-[var(--color-border)] overflow-hidden">
                <div
                  className={`h-full transition-all duration-300 ${
                    status === "SUCCESS"
                      ? "bg-[var(--color-success)]"
                      : status === "RUNNING"
                        ? "bg-[var(--color-warning)] animate-pulse"
                        : "bg-[var(--color-primary)]"
                  }`}
                  style={{ width: `${analysisProgress}%` }}
                />
              </div>
              <span className="text-[11px] font-mono text-[var(--color-text-muted)] font-medium select-none">
                {analysisProgress}%
              </span>
            </div>
          )}
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-2">
          {/* Dual View Mode Selector */}
          <div className="flex items-center rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-secondary)] p-0.5">
            <button
              type="button"
              onClick={() => setViewMode("overview")}
              className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-[calc(var(--radius-md)-2px)] transition-colors cursor-pointer ${
                viewMode === "overview"
                  ? "bg-[var(--color-surface)] text-[var(--color-primary)] shadow-xs"
                  : "text-[var(--color-text-secondary)] hover:text-[var(--color-text)]"
              }`}
              title="View entire project network architecture"
            >
              <LayoutGrid size={13} />
              <span>System Overview</span>
            </button>
            <button
              type="button"
              onClick={() => setViewMode("module")}
              className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-[calc(var(--radius-md)-2px)] transition-colors cursor-pointer ${
                viewMode === "module"
                  ? "bg-[var(--color-surface)] text-[var(--color-primary)] shadow-xs"
                  : "text-[var(--color-text-secondary)] hover:text-[var(--color-text)]"
              }`}
              title="Focus on specific domain modules"
            >
              <Box size={13} />
              <span>Module View</span>
            </button>
          </div>

          {/* Snapshot selector */}
          <select
            value={snapshotId}
            onChange={(e) => setSnapshotId(e.target.value)}
            className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)] px-2.5 py-1 text-xs font-mono outline-none focus-visible:ring-1 focus-visible:ring-[var(--color-primary)] font-medium"
            title="Select Git commit snapshot"
          >
            {snapshots.map((s) => (
              <option value={s.id} key={s.id}>
                {s.commitSha?.slice(0, 7) || s.id}
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={loadAnalysis}
            disabled={loading}
            className="p-1.5 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-secondary)] hover:text-[var(--color-text)] cursor-pointer disabled:opacity-50"
            title="Refresh Data"
            aria-label="Refresh Data"
          >
            <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
          </button>

          <button
            type="button"
            onClick={startAnalysis}
            disabled={
              loading || !snapshotId || ["QUEUED", "RUNNING"].includes(status)
            }
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--radius-md)] bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white text-xs font-medium transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed shadow-xs"
          >
            <Play size={11} fill="currentColor" />
            <span>{analysis ? "Re-analyze" : "Run Analysis"}</span>
          </button>

          {/* Toggle Inspector Drawer */}
          {selectedNode && (
            <button
              type="button"
              onClick={() => setIsDrawerOpen((prev) => !prev)}
              className={`p-1.5 rounded-[var(--radius-md)] border transition-colors cursor-pointer ${
                isDrawerOpen
                  ? "border-[var(--color-primary)] bg-[var(--color-primary)]/10 text-[var(--color-primary)]"
                  : "border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-secondary)] hover:text-[var(--color-text)]"
              }`}
              title={isDrawerOpen ? "Collapse Inspector" : "Expand Inspector"}
              aria-label={
                isDrawerOpen ? "Collapse Inspector" : "Expand Inspector"
              }
            >
              {isDrawerOpen ? (
                <PanelRightClose size={14} />
              ) : (
                <PanelRightOpen size={14} />
              )}
            </button>
          )}
        </div>
      </header>

      {/* --- SUB-BAR: DOMAIN PILLS & ROLE FILTERS --- */}
      {analysis && (
        <div className="shrink-0 px-4 py-2 bg-[var(--color-surface-secondary)]/50 border-b border-[var(--color-border)] flex flex-wrap items-center justify-between gap-3 text-xs">
          {/* Left: Domain Pills (in Module view) or Stats Summary */}
          {viewMode === "module" ? (
            <div className="flex items-center gap-1.5 overflow-x-auto custom-scrollbar py-0.5">
              <span className="text-[var(--color-text-muted)] font-medium flex items-center gap-1 pr-1 text-xs">
                <Box size={12} />
                Module:
              </span>
              <button
                type="button"
                onClick={() => setSelectedDomain("All")}
                className={`px-2.5 py-0.5 rounded-[var(--radius-sm)] text-xs font-medium transition-colors cursor-pointer border ${
                  selectedDomain === "All"
                    ? "bg-[var(--color-primary)] text-white border-[var(--color-primary)]"
                    : "bg-[var(--color-surface)] text-[var(--color-text)] hover:border-[var(--color-primary)] border-[var(--color-border)]"
                }`}
              >
                All Modules ({allNodes.length})
              </button>
              {availableDomains.map((dom) => {
                const count = allNodes.filter((n) => n.domain === dom).length;
                const isSelected = selectedDomain === dom;
                return (
                  <button
                    type="button"
                    key={dom}
                    onClick={() => setSelectedDomain(dom)}
                    className={`px-2.5 py-0.5 rounded-[var(--radius-sm)] text-xs font-medium transition-colors cursor-pointer flex items-center gap-1.5 border ${
                      isSelected
                        ? "bg-[var(--color-primary)] text-white border-[var(--color-primary)]"
                        : "bg-[var(--color-surface)] text-[var(--color-text)] hover:border-[var(--color-primary)] border-[var(--color-border)]"
                    }`}
                  >
                    <span>{dom}</span>
                    <span
                      className={`text-[10px] px-1.5 py-0.2 rounded font-mono font-medium ${
                        isSelected
                          ? "bg-white/20 text-white"
                          : "bg-[var(--color-surface-secondary)] text-[var(--color-text-muted)]"
                      }`}
                    >
                      {count}
                    </span>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="flex items-center gap-2 text-xs font-mono text-[var(--color-text-secondary)]">
              <span className="font-semibold text-[var(--color-text)]">
                {visibleNodes.length}
              </span>
              <span>files</span>
              <span className="text-[var(--color-text-muted)]">·</span>
              <span className="font-semibold text-[var(--color-text)]">
                {visibleEdges.length}
              </span>
              <span>dependencies</span>
              <span className="text-[var(--color-text-muted)]">·</span>
              <span className="font-semibold text-[var(--color-text)]">
                {analysis.summary.totalFunctions}
              </span>
              <span>functions</span>
            </div>
          )}

          {/* Right: Multi-select Role Chips */}
          <div className="flex items-center gap-1.5 overflow-x-auto custom-scrollbar py-0.5">
            <span className="text-[var(--color-text-muted)] font-medium flex items-center gap-1 pr-1 text-xs">
              <Filter size={12} />
              Roles:
            </span>
            {availableRoles.map(([role, count]) => {
              const theme = ROLE_THEMES[role] || ROLE_THEMES.unknown;
              const isActive = selectedRoles.has(role);
              return (
                <button
                  type="button"
                  key={role}
                  onClick={() => toggleRole(role)}
                  className={`px-2 py-0.5 rounded-[var(--radius-sm)] text-[11px] font-mono font-medium transition-all cursor-pointer flex items-center gap-1.5 border ${
                    isActive
                      ? "shadow-2xs text-[var(--color-text)]"
                      : "border-transparent bg-[var(--color-surface)]/60 text-[var(--color-text-muted)] opacity-60 hover:opacity-100"
                  }`}
                  style={{
                    borderColor: isActive ? theme.color : "transparent",
                    backgroundColor: isActive ? theme.bg : undefined,
                  }}
                  title={`Toggle role ${theme.label}`}
                >
                  <span
                    className="w-1.5 h-1.5 rounded-full shrink-0"
                    style={{ backgroundColor: theme.color }}
                  />
                  <span>{theme.label}</span>
                  <span className="text-[10px] opacity-75">({count})</span>
                </button>
              );
            })}
            <div className="w-[1px] h-3.5 bg-[var(--color-border)] mx-0.5 shrink-0" />
            <button
              type="button"
              onClick={selectAllRoles}
              className={`px-2.5 py-0.5 rounded-[var(--radius-sm)] text-[11px] font-mono font-medium transition-all cursor-pointer flex items-center gap-1.5 border shrink-0 ${
                selectedRoles.size === availableRoles.length
                  ? "bg-[var(--color-surface)] border-[var(--color-border)] text-[var(--color-text-secondary)] hover:text-[var(--color-text)] hover:border-[var(--color-primary)]/40"
                  : "bg-[var(--color-primary)] text-white border-[var(--color-primary)] shadow-2xs hover:bg-[var(--color-primary-hover)] font-semibold"
              }`}
              title="Show all roles"
            >
              <span>All</span>
              <span
                className={`text-[10px] font-mono ${
                  selectedRoles.size === availableRoles.length
                    ? "text-[var(--color-text-muted)]"
                    : "text-white/80"
                }`}
              >
                ({allNodes.length})
              </span>
            </button>
          </div>
        </div>
      )}

      {/* --- ERROR MESSAGE --- */}
      {error && (
        <div className="m-4 flex items-center justify-between gap-2 p-3 rounded-[var(--radius-md)] bg-[var(--color-danger)]/10 border border-[var(--color-danger)]/20 text-xs text-[var(--color-danger)] font-medium">
          <div className="flex items-center gap-2">
            <AlertTriangle size={15} className="shrink-0" />
            <span>{error}</span>
          </div>
          <button
            type="button"
            onClick={loadAnalysis}
            className="text-[11px] underline font-semibold cursor-pointer"
          >
            Retry
          </button>
        </div>
      )}

      {/* --- LOADING STATE --- */}
      {loading && !analysis && (
        <div className="flex-1 flex flex-col items-center justify-center p-8 text-center bg-[var(--color-bg)]">
          <div className="w-12 h-12 rounded-[var(--radius-md)] bg-[var(--color-surface)] border border-[var(--color-border)] flex items-center justify-center text-[var(--color-primary)] mb-3">
            <RefreshCw
              size={20}
              className="animate-spin text-[var(--color-primary)]"
            />
          </div>
          <h2 className="text-sm font-semibold text-[var(--color-text)]">
            Loading Architecture Network...
          </h2>
          <p className="mt-1 text-xs text-[var(--color-text-muted)] max-w-sm font-mono">
            Fetching AST snapshots and dependency graph
          </p>
        </div>
      )}

      {/* --- IN-PROGRESS ANALYSIS STATE --- */}
      {!analysis && !loading && ["QUEUED", "RUNNING"].includes(status) && (
        <div className="flex-1 flex flex-col items-center justify-center p-8 text-center bg-[var(--color-bg)]">
          <div className="w-12 h-12 rounded-[var(--radius-md)] bg-[var(--color-surface)] border border-[var(--color-border)] flex items-center justify-center text-[var(--color-warning)] mb-3">
            <RefreshCw
              size={20}
              className="animate-spin text-[var(--color-warning)]"
            />
          </div>
          <h2 className="text-sm font-semibold text-[var(--color-text)]">
            Architecture Analysis in Progress
          </h2>
          <p className="mt-1 text-xs text-[var(--color-text-secondary)] max-w-sm">
            Analyzing source files and building interactive dependency graph...
          </p>
        </div>
      )}

      {/* --- EMPTY STATE --- */}
      {!analysis && !loading && !["QUEUED", "RUNNING"].includes(status) && (
        <div className="flex-1 flex flex-col items-center justify-center p-8 text-center bg-[var(--color-bg)]">
          <div className="w-12 h-12 rounded-[var(--radius-md)] bg-[var(--color-surface)] border border-[var(--color-border)] flex items-center justify-center text-[var(--color-primary)] mb-3">
            <Network size={22} />
          </div>
          <h2 className="text-sm font-semibold text-[var(--color-text)]">
            Architecture map not available for this snapshot
          </h2>
          <p className="mt-1 text-xs text-[var(--color-text-secondary)] max-w-sm">
            Run architecture analysis to analyze file dependencies and generate
            the interactive network.
          </p>
          <button
            type="button"
            onClick={startAnalysis}
            disabled={!snapshotId || loading}
            className="mt-4 flex items-center gap-1.5 px-3.5 py-1.5 rounded-[var(--radius-md)] bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white text-xs font-medium shadow-xs transition-colors cursor-pointer disabled:opacity-50"
          >
            <Play size={11} fill="currentColor" />
            <span>Run Analysis</span>
          </button>
        </div>
      )}

      {/* --- MAIN GRAPH & INSPECTOR SPLIT --- */}
      {analysis && (
        <div className="flex-1 flex relative overflow-hidden w-full h-full">
          {/* CANVAS AREA */}
          <div
            ref={canvasRef}
            className="flex-1 h-full relative overflow-hidden select-none cursor-grab active:cursor-grabbing bg-[var(--color-bg)]"
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onWheel={handleWheel}
          >
            {/* TRANSFORMED GRAPH CONTAINER */}
            <div
              style={{
                transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                transformOrigin: "0 0",
                width: layout.width,
                height: layout.height,
                position: "relative",
              }}
            >
              {/* SVG CANVAS & EDGES LAYER */}
              <svg
                width={layout.width}
                height={layout.height}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  pointerEvents: "none",
                  overflow: "visible",
                }}
              >
                <defs>
                  {/* Subtle Canvas Dot Grid */}
                  <pattern
                    id="arch-dot-grid"
                    width="24"
                    height="24"
                    patternUnits="userSpaceOnUse"
                  >
                    <circle
                      cx="2"
                      cy="2"
                      r="1"
                      fill="var(--color-border)"
                      opacity="0.6"
                    />
                  </pattern>

                  {/* Standard SVG Markers Using CSS Design Tokens */}
                  <marker
                    id="arch-arrow-default"
                    viewBox="0 0 10 10"
                    refX="8"
                    refY="5"
                    markerWidth="6"
                    markerHeight="6"
                    orient="auto-start-reverse"
                  >
                    <path
                      d="M 0 0 L 10 5 L 0 10 z"
                      fill="var(--color-text-muted)"
                    />
                  </marker>
                  <marker
                    id="arch-arrow-outgoing"
                    viewBox="0 0 10 10"
                    refX="8"
                    refY="5"
                    markerWidth="6"
                    markerHeight="6"
                    orient="auto-start-reverse"
                  >
                    <path
                      d="M 0 0 L 10 5 L 0 10 z"
                      fill="var(--color-success)"
                    />
                  </marker>
                  <marker
                    id="arch-arrow-incoming"
                    viewBox="0 0 10 10"
                    refX="8"
                    refY="5"
                    markerWidth="6"
                    markerHeight="6"
                    orient="auto-start-reverse"
                  >
                    <path
                      d="M 0 0 L 10 5 L 0 10 z"
                      fill="var(--color-primary)"
                    />
                  </marker>
                </defs>

                {/* Background dot grid */}
                <rect
                  width={layout.width}
                  height={layout.height}
                  fill="url(#arch-dot-grid)"
                />

                {/* Edges */}
                {layout.edges.map((edge) => {
                  const isHoveredOutgoing = hoverFocusInfo.outgoingEdgeIds.has(
                    edge.id,
                  );
                  const isHoveredIncoming = hoverFocusInfo.incomingEdgeIds.has(
                    edge.id,
                  );
                  const isHoverConnected =
                    isHoveredOutgoing || isHoveredIncoming;
                  const isDimmed = hoveredNodeId && !isHoverConnected;

                  let strokeColor = "var(--color-border)";
                  let marker = "url(#arch-arrow-default)";
                  let strokeWidth = 1.5;

                  if (isHoveredOutgoing) {
                    strokeColor = "var(--color-success)";
                    marker = "url(#arch-arrow-outgoing)";
                    strokeWidth = 2.5;
                  } else if (isHoveredIncoming) {
                    strokeColor = "var(--color-primary)";
                    marker = "url(#arch-arrow-incoming)";
                    strokeWidth = 2.5;
                  } else if (
                    selectedNodeId === edge.from ||
                    selectedNodeId === edge.to
                  ) {
                    strokeColor = "var(--color-primary)";
                    strokeWidth = 2;
                  }

                  return (
                    <path
                      key={edge.id}
                      d={pointsToSvgPath(edge.points)}
                      fill="none"
                      stroke={strokeColor}
                      strokeWidth={strokeWidth}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      markerEnd={marker}
                      style={{
                        opacity: isDimmed ? 0.15 : isHoverConnected ? 1 : 0.65,
                        transition: "stroke 0.15s ease, opacity 0.15s ease",
                      }}
                    />
                  );
                })}
              </svg>

              {/* SLEEK DEVELOPER TOOL NODE CARDS */}
              {layout.nodes.map((node) => {
                const theme = ROLE_THEMES[node.role] || ROLE_THEMES.unknown;
                const isSelected = selectedNodeId === node.id;
                const isHovered = hoveredNodeId === node.id;
                const isHoverConnected = hoverFocusInfo.connectedNodeIds.has(
                  node.id,
                );
                // Note: Only dim when ACTIVELY HOVERING over another node!
                const isDimmed = hoveredNodeId && !isHoverConnected;
                const fileName = (node.relativePath || "")
                  .replace(/\\/g, "/")
                  .split("/")
                  .pop();

                return (
                  <div
                    key={node.id}
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedNodeId(node.id);
                      setIsDrawerOpen(true);
                    }}
                    onMouseEnter={() => setHoveredNodeId(node.id)}
                    onMouseLeave={() => setHoveredNodeId(null)}
                    style={{
                      position: "absolute",
                      left: `${node.x}px`,
                      top: `${node.y}px`,
                      width: `${node.width}px`,
                      height: `${node.height}px`,
                      opacity: isDimmed ? 0.35 : 1,
                      transform: isSelected
                        ? "scale(1.03)"
                        : isHovered
                          ? "scale(1.02)"
                          : "scale(1)",
                      zIndex: isSelected
                        ? 35
                        : isHovered
                          ? 30
                          : isHoverConnected
                            ? 20
                            : 10,
                      transition:
                        "transform 0.15s ease, opacity 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease",
                    }}
                    className={`rounded-[var(--radius-md)] border p-2.5 flex flex-col justify-between cursor-pointer select-none bg-[var(--color-surface)] ${
                      isSelected
                        ? "border-[var(--color-primary)] ring-2 ring-[var(--color-primary)]/25 shadow-xs"
                        : isHovered
                          ? "border-[var(--color-primary)] shadow-2xs"
                          : "border-[var(--color-border)] hover:border-[var(--color-primary)]/50"
                    }`}
                  >
                    {/* Top Row: Sleek Role Badge & Domain Tag */}
                    <div className="flex items-center justify-between gap-1.5 leading-none">
                      <span
                        className="inline-flex items-center gap-1.5 px-1.5 py-0.5 rounded-[var(--radius-sm)] text-[10px] font-mono font-medium truncate"
                        style={{
                          color: theme.color,
                          backgroundColor: theme.bg,
                          border: `1px solid ${theme.color}33`,
                        }}
                        title={`Role: ${theme.label}`}
                      >
                        <span
                          className="w-1.5 h-1.5 rounded-full shrink-0"
                          style={{ backgroundColor: theme.color }}
                        />
                        <span className="truncate">{theme.label}</span>
                      </span>
                      {isSelected && isAiLoading ? (
                        <span
                          className="flex items-center gap-1 text-[10px] font-mono text-[var(--color-primary)] font-medium"
                          title="Analyzing file architecture..."
                        >
                          <RefreshCw size={10} className="animate-spin" />
                          <span>AI</span>
                        </span>
                      ) : node.domain ? (
                        <span
                          className="text-[10px] font-mono text-[var(--color-text-muted)] truncate max-w-[95px]"
                          title={`Domain: ${node.domain}`}
                        >
                          {node.domain}
                        </span>
                      ) : null}
                    </div>

                    {/* Middle: File Name (Clean, Unclipped Monospace) */}
                    <div
                      className="font-mono text-xs font-semibold text-[var(--color-text)] truncate leading-normal py-0.5"
                      title={node.relativePath}
                    >
                      {fileName}
                    </div>

                    {/* Bottom: LOC & Functions Stats */}
                    <div className="flex items-center justify-between text-[10px] font-mono text-[var(--color-text-muted)] pt-1 border-t border-[var(--color-border)] leading-none">
                      <span
                        className="flex items-center gap-1"
                        title={`${node.lineCount || 0} Lines of code`}
                      >
                        <FileCode
                          size={11}
                          className="shrink-0 text-[var(--color-text-muted)]"
                        />
                        <span>{node.lineCount || 0}L</span>
                      </span>
                      <span
                        className="flex items-center gap-1"
                        title={`${node.functions?.length || 0} Functions`}
                      >
                        <FunctionSquare
                          size={11}
                          className="shrink-0 text-[var(--color-text-muted)]"
                        />
                        <span>{node.functions?.length || 0} fn</span>
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* FLOATING CANVAS CONTROLS TOOLBAR */}
            <div className="absolute bottom-5 left-5 flex items-center gap-1 p-1 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-md)] shadow-md z-30">
              <button
                type="button"
                onClick={() => setZoom((prev) => Math.min(2.5, prev * 1.15))}
                className="p-1.5 text-[var(--color-text-secondary)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-secondary)] rounded-[var(--radius-sm)] transition-colors cursor-pointer"
                title="Zoom In (+)"
                aria-label="Zoom In"
              >
                <ZoomIn size={14} />
              </button>
              <button
                type="button"
                onClick={() => setZoom((prev) => Math.max(0.25, prev * 0.85))}
                className="p-1.5 text-[var(--color-text-secondary)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-secondary)] rounded-[var(--radius-sm)] transition-colors cursor-pointer"
                title="Zoom Out (-)"
                aria-label="Zoom Out"
              >
                <ZoomOut size={14} />
              </button>
              <button
                type="button"
                onClick={handleResetView}
                className="px-2 py-1 text-xs font-mono font-medium text-[var(--color-text)] hover:bg-[var(--color-surface-secondary)] rounded-[var(--radius-sm)] cursor-pointer"
                title="Reset View (100%)"
                aria-label="Reset View"
              >
                {Math.round(zoom * 100)}%
              </button>
              <button
                type="button"
                onClick={handleFitView}
                className="p-1.5 text-[var(--color-text-secondary)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-secondary)] rounded-[var(--radius-sm)] transition-colors cursor-pointer"
                title="Fit to Screen"
                aria-label="Fit to Screen"
              >
                <Maximize2 size={14} />
              </button>

              <div className="w-[1px] h-4 bg-[var(--color-border)] mx-1" />

              {/* Orientation toggle */}
              <button
                type="button"
                onClick={() =>
                  setOrientation((prev) => (prev === "LR" ? "TB" : "LR"))
                }
                className="px-2 py-1 text-xs font-mono font-medium text-[var(--color-text)] hover:bg-[var(--color-surface-secondary)] rounded-[var(--radius-sm)] cursor-pointer flex items-center gap-1"
                title="Toggle Graph Layout (Horizontal / Vertical)"
                aria-label="Toggle Graph Layout"
              >
                <ArrowDownUp size={13} />
                <span>{orientation === "LR" ? "Horizontal" : "Vertical"}</span>
              </button>

              <div className="w-[1px] h-4 bg-[var(--color-border)] mx-1" />

              {/* Card Size Scale Toggle */}
              <button
                type="button"
                onClick={() => setCardScale((prev) => (prev === 1 ? 1.15 : 1))}
                className={`px-2 py-1 text-xs font-mono font-medium rounded-[var(--radius-sm)] cursor-pointer transition-colors ${
                  cardScale > 1
                    ? "bg-[var(--color-primary)] text-white"
                    : "text-[var(--color-text)] hover:bg-[var(--color-surface-secondary)]"
                }`}
                title="Toggle Card Display Size (Normal / Large)"
                aria-label="Toggle Card Display Size"
              >
                {cardScale > 1 ? "Large" : "Normal"}
              </button>
            </div>
          </div>

          {/* --- RIGHT RESIZABLE INSPECTOR DRAWER --- */}
          <AnimatePresence>
            {selectedNode && isDrawerOpen && (
              <motion.aside
                initial={{ width: 0, opacity: 0 }}
                animate={{ width: drawerWidth, opacity: 1 }}
                exit={{ width: 0, opacity: 0 }}
                transition={{ duration: 0.2, ease: "easeOut" }}
                style={{ width: `${drawerWidth}px` }}
                className="h-full shrink-0 border-l border-[var(--color-border)] bg-[var(--color-surface)] flex flex-col z-40 shadow-lg relative"
              >
                {/* Drag Resize Handle on left border of drawer */}
                <div
                  onMouseDown={handleDrawerResizeStart}
                  className={`absolute -left-1.5 top-0 bottom-0 w-3 cursor-col-resize z-50 transition-colors ${
                    isResizingDrawer
                      ? "bg-[var(--color-primary)]"
                      : "hover:bg-[var(--color-primary)]/40"
                  }`}
                  title="Drag to resize Inspector drawer"
                />

                {/* Drawer Header */}
                <div className="p-3.5 border-b border-[var(--color-border)] flex items-start justify-between gap-3 bg-[var(--color-surface-secondary)]/30">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 mb-1">
                      <span
                        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-[var(--radius-sm)] text-[10px] font-mono font-medium"
                        style={{
                          backgroundColor:
                            ROLE_THEMES[selectedNode.role]?.bg ||
                            "rgba(100,116,139,0.12)",
                          color:
                            ROLE_THEMES[selectedNode.role]?.color ||
                            "var(--color-text)",
                          border: `1px solid ${
                            ROLE_THEMES[selectedNode.role]?.color ||
                            "var(--color-border)"
                          }33`,
                        }}
                      >
                        <span
                          className="w-1.5 h-1.5 rounded-full"
                          style={{
                            backgroundColor:
                              ROLE_THEMES[selectedNode.role]?.color ||
                              "#64748b",
                          }}
                        />
                        {ROLE_THEMES[selectedNode.role]?.label ||
                          selectedNode.role}
                      </span>
                      {selectedNode.domain && (
                        <span className="px-1.5 py-0.5 rounded-[var(--radius-sm)] text-[10px] font-mono text-[var(--color-text-secondary)] bg-[var(--color-surface)] border border-[var(--color-border)]">
                          {selectedNode.domain}
                        </span>
                      )}
                    </div>
                    <h2
                      className="text-sm font-semibold font-mono text-[var(--color-text)] truncate"
                      title={selectedNode.relativePath}
                    >
                      {(selectedNode.relativePath || "")
                        .replace(/\\/g, "/")
                        .split("/")
                        .pop()}
                    </h2>
                    <p className="text-[11px] font-mono text-[var(--color-text-muted)] mt-0.5 truncate">
                      {selectedNode.relativePath}
                    </p>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {isAiLoading && (
                      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-[var(--radius-sm)] text-[10px] font-mono text-[var(--color-primary)] bg-[var(--color-primary)]/10 border border-[var(--color-primary)]/20 animate-pulse">
                        <RefreshCw size={10} className="animate-spin" />
                        <span>AI Analyzing</span>
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => setIsDrawerOpen(false)}
                      className="p-1 rounded-[var(--radius-sm)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-secondary)] cursor-pointer"
                      title="Close Inspector"
                      aria-label="Close Inspector"
                    >
                      <X size={15} />
                    </button>
                  </div>
                </div>

                {/* Metrics Stats Grid */}
                <div className="grid grid-cols-4 p-3 gap-2 border-b border-[var(--color-border)] bg-[var(--color-surface-secondary)]/20 text-center font-mono">
                  <div className="p-2 rounded-[var(--radius-sm)] bg-[var(--color-surface)] border border-[var(--color-border)]">
                    <div className="text-[10px] font-medium text-[var(--color-text-muted)] uppercase tracking-wider">
                      Lines
                    </div>
                    <div className="text-sm font-semibold text-[var(--color-text)] mt-0.5">
                      {selectedNode.lineCount || 0}
                    </div>
                  </div>
                  <div className="p-2 rounded-[var(--radius-sm)] bg-[var(--color-surface)] border border-[var(--color-border)]">
                    <div className="text-[10px] font-medium text-[var(--color-text-muted)] uppercase tracking-wider">
                      Functions
                    </div>
                    <div className="text-sm font-semibold text-[var(--color-text)] mt-0.5">
                      {selectedNode.functions?.length || 0}
                    </div>
                  </div>
                  <div className="p-2 rounded-[var(--radius-sm)] bg-[var(--color-surface)] border border-[var(--color-border)]">
                    <div className="text-[10px] font-medium text-[var(--color-text-muted)] uppercase tracking-wider">
                      Calls Out
                    </div>
                    <div className="text-sm font-semibold text-[var(--color-success)] mt-0.5">
                      {selectedNodeDeps.outgoing.length}
                    </div>
                  </div>
                  <div className="p-2 rounded-[var(--radius-sm)] bg-[var(--color-surface)] border border-[var(--color-border)]">
                    <div className="text-[10px] font-medium text-[var(--color-text-muted)] uppercase tracking-wider">
                      Called In
                    </div>
                    <div className="text-sm font-semibold text-[var(--color-primary)] mt-0.5">
                      {selectedNodeDeps.incoming.length}
                    </div>
                  </div>
                </div>

                {/* Drawer Scrollable Content */}
                <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar">
                  {/* Rotating Loading Spinner for AI Summary */}
                  {isAiLoading && (
                    <div className="p-4 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] flex items-center justify-center gap-2.5 text-xs text-[var(--color-text-secondary)] shadow-2xs">
                      <RefreshCw
                        size={15}
                        className="animate-spin text-[var(--color-primary)] shrink-0"
                      />
                      <span className="font-mono">
                        Analyzing file architecture with AI...
                      </span>
                    </div>
                  )}

                  {/* AI Architectural Summary Block */}
                  {aiSummaryMap[selectedNode.relativePath] && !isAiLoading && (
                    <div className="p-3.5 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-2xs">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-1.5 text-xs font-semibold text-[var(--color-text)]">
                          <Sparkles
                            size={13}
                            className="text-[var(--color-primary)]"
                          />
                          <span>AI Architecture Summary</span>
                        </div>
                        <button
                          type="button"
                          onClick={() =>
                            handleGenerateAiSummary(
                              selectedNode.relativePath,
                              true,
                            )
                          }
                          className="inline-flex items-center gap-1 text-[11px] font-mono text-[var(--color-primary)] hover:underline cursor-pointer"
                          title="Re-analyze summary"
                        >
                          <RefreshCw size={10} />
                          <span>Re-analyze</span>
                        </button>
                      </div>
                      <p className="text-xs text-[var(--color-text)] leading-relaxed font-sans">
                        {aiSummaryMap[selectedNode.relativePath].fileSummary}
                      </p>
                    </div>
                  )}

                  {aiError &&
                    !isAiLoading &&
                    !aiSummaryMap[selectedNode.relativePath] && (
                      <div className="p-3 rounded-[var(--radius-md)] bg-[var(--color-danger)]/10 border border-[var(--color-danger)]/20 text-xs text-[var(--color-danger)] flex items-center justify-between gap-2">
                        <span className="truncate">{aiError}</span>
                        <button
                          type="button"
                          onClick={() =>
                            handleGenerateAiSummary(
                              selectedNode.relativePath,
                              true,
                            )
                          }
                          className="underline text-[11px] font-semibold shrink-0 cursor-pointer"
                        >
                          Retry
                        </button>
                      </div>
                    )}

                  {/* Functions List with AI Explanations */}
                  <div>
                    <h3 className="text-xs font-semibold text-[var(--color-text)] flex items-center justify-between mb-2.5">
                      <span className="flex items-center gap-1.5">
                        <FunctionSquare
                          size={13}
                          className="text-[var(--color-primary)]"
                        />
                        <span>
                          Functions & Methods (
                          {selectedNode.functions?.length || 0})
                        </span>
                      </span>
                    </h3>

                    {selectedNode.functions?.length === 0 ? (
                      <div className="p-3 text-center text-xs text-[var(--color-text-muted)] border border-dashed border-[var(--color-border)] rounded-[var(--radius-sm)]">
                        No functions detected in this file.
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {selectedNode.functions.map((fn, idx) => {
                          const isArrow = fn.type === "ArrowFunctionExpression";
                          const isAnon = !fn.name || fn.name === "anonymous";
                          const displayName =
                            fn.displayName ||
                            (isAnon
                              ? isArrow
                                ? "arrow function"
                                : "anonymous"
                              : fn.name);

                          const fnAiSummary =
                            aiSummaryMap[selectedNode.relativePath]
                              ?.functionSummaries?.[fn.id] ||
                            aiSummaryMap[selectedNode.relativePath]
                              ?.functionSummaries?.[
                              `${displayName}@L${fn.startLine}`
                            ] ||
                            aiSummaryMap[selectedNode.relativePath]
                              ?.functionSummaries?.[
                              `${displayName} (L${fn.startLine})`
                            ] ||
                            aiSummaryMap[selectedNode.relativePath]
                              ?.functionSummaries?.[fn.name] ||
                            (isArrow
                              ? aiSummaryMap[selectedNode.relativePath]
                                  ?.functionSummaries?.["arrow function"] ||
                                aiSummaryMap[selectedNode.relativePath]
                                  ?.functionSummaries?.["anonymous"]
                              : null);

                          return (
                            <div
                              key={fn.id || idx}
                              className="p-2.5 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] hover:border-[var(--color-border-subtle,var(--color-text-muted))] transition-colors"
                            >
                              <div className="flex items-center justify-between gap-2">
                                <div className="flex items-center gap-1.5 min-w-0">
                                  <span className="font-mono text-xs font-semibold text-[var(--color-text)] truncate">
                                    {displayName}
                                  </span>
                                  {isArrow && (
                                    <span className="text-[9px] font-mono font-medium px-1 py-0.2 rounded bg-[var(--color-surface-secondary)] text-[var(--color-text-muted)] border border-[var(--color-border)] shrink-0">
                                      =&gt;
                                    </span>
                                  )}
                                </div>
                                <div className="flex items-center gap-1.5 shrink-0">
                                  {fn.exported && (
                                    <span className="text-[9px] font-mono font-medium px-1.5 py-0.2 rounded bg-[var(--color-success)]/10 text-[var(--color-success)] border border-[var(--color-success)]/20 uppercase">
                                      exp
                                    </span>
                                  )}
                                  <span className="text-[10px] font-mono text-[var(--color-text-muted)]">
                                    L{fn.startLine}–L{fn.endLine}
                                  </span>
                                </div>
                              </div>

                              {/* AI Explanation for function (only if available) */}
                              {fnAiSummary && (
                                <p className="text-[11px] text-[var(--color-text-secondary)] mt-1.5 pl-2 border-l border-[var(--color-primary)] leading-relaxed">
                                  {fnAiSummary}
                                </p>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {/* Connected Dependencies */}
                  <div className="space-y-3 pt-3 border-t border-[var(--color-border)]">
                    {/* Outgoing */}
                    <div>
                      <h4 className="text-xs font-semibold text-[var(--color-text)] flex items-center gap-1.5 mb-2">
                        <ArrowRight
                          size={13}
                          className="text-[var(--color-success)]"
                        />
                        <span>
                          Outgoing Dependencies (Imports) (
                          {selectedNodeDeps.outgoing.length})
                        </span>
                      </h4>
                      {selectedNodeDeps.outgoing.length === 0 ? (
                        <p className="text-[11px] text-[var(--color-text-muted)] italic pl-1">
                          This file does not import any internal source files.
                        </p>
                      ) : (
                        <div className="space-y-1.5">
                          {selectedNodeDeps.outgoing.map((dep) => (
                            <button
                              type="button"
                              key={dep.id}
                              onClick={() => jumpToNode(dep.id)}
                              className="w-full text-left p-2 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface-secondary)]/40 hover:bg-[var(--color-surface-secondary)] hover:border-[var(--color-primary)] transition-colors flex items-center justify-between text-xs font-mono cursor-pointer"
                              title={`Jump to ${dep.relativePath}`}
                            >
                              <span className="truncate text-[var(--color-text)] font-semibold">
                                {(dep.relativePath || "")
                                  .replace(/\\/g, "/")
                                  .split("/")
                                  .pop()}
                              </span>
                              <span
                                className="text-[10px] font-mono font-medium uppercase px-1.5 py-0.5 rounded-[var(--radius-sm)]"
                                style={{
                                  color:
                                    ROLE_THEMES[dep.role]?.color || "inherit",
                                  backgroundColor:
                                    ROLE_THEMES[dep.role]?.bg || "transparent",
                                }}
                              >
                                {dep.role}
                              </span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Incoming */}
                    <div>
                      <h4 className="text-xs font-semibold text-[var(--color-text)] flex items-center gap-1.5 mb-2">
                        <ArrowLeft
                          size={13}
                          className="text-[var(--color-primary)]"
                        />
                        <span>
                          Incoming Dependencies (Imported by) (
                          {selectedNodeDeps.incoming.length})
                        </span>
                      </h4>
                      {selectedNodeDeps.incoming.length === 0 ? (
                        <p className="text-[11px] text-[var(--color-text-muted)] italic pl-1">
                          No internal source files import this file.
                        </p>
                      ) : (
                        <div className="space-y-1.5">
                          {selectedNodeDeps.incoming.map((dep) => (
                            <button
                              type="button"
                              key={dep.id}
                              onClick={() => jumpToNode(dep.id)}
                              className="w-full text-left p-2 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface-secondary)]/40 hover:bg-[var(--color-surface-secondary)] hover:border-[var(--color-primary)] transition-colors flex items-center justify-between text-xs font-mono cursor-pointer"
                              title={`Jump to ${dep.relativePath}`}
                            >
                              <span className="truncate text-[var(--color-text)] font-semibold">
                                {(dep.relativePath || "")
                                  .replace(/\\/g, "/")
                                  .split("/")
                                  .pop()}
                              </span>
                              <span
                                className="text-[10px] font-mono font-medium uppercase px-1.5 py-0.5 rounded-[var(--radius-sm)]"
                                style={{
                                  color:
                                    ROLE_THEMES[dep.role]?.color || "inherit",
                                  backgroundColor:
                                    ROLE_THEMES[dep.role]?.bg || "transparent",
                                }}
                              >
                                {dep.role}
                              </span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </motion.aside>
            )}
          </AnimatePresence>
        </div>
      )}
    </section>
  );
}
