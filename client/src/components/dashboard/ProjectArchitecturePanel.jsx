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
  Box,
  FileCode,
  FunctionSquare,
  ArrowRight,
  ArrowLeft,
  X,
  Filter,
  LayoutGrid,
  PanelRightClose,
  PanelRightOpen,
  ArrowDownUp,
} from "lucide-react";
import {
  getProjectSnapshotsApi,
  getProjectStructureAnalysisApi,
  runProjectStructureAnalysisApi,
  getArchitectureAiSummaryApi,
} from "../../services/project.service";
import { getProjectJobsApi } from "../../services/job.service";
import "./portfolio/portfolio.css";

/* --- ROLE VISUAL THEMES (QUIET DESATURATED STUDIO PALETTE) --- */
export const ROLE_THEMES = {
  route: {
    label: "Route",
    color: "var(--ps-cobalt)",
    bg: "var(--ps-inset)",
    border: "var(--ps-line-strong)",
  },
  controller: {
    label: "Controller",
    color: "var(--ps-teal)",
    bg: "var(--ps-inset)",
    border: "var(--ps-line-strong)",
  },
  service: {
    label: "Service",
    color: "var(--ps-indigo)",
    bg: "var(--ps-inset)",
    border: "var(--ps-line-strong)",
  },
  component: {
    label: "Component",
    color: "var(--ps-emerald)",
    bg: "var(--ps-inset)",
    border: "var(--ps-line-strong)",
  },
  page: {
    label: "Page",
    color: "var(--ps-teal)",
    bg: "var(--ps-inset)",
    border: "var(--ps-line-strong)",
  },
  hook: {
    label: "Hook",
    color: "var(--ps-cobalt)",
    bg: "var(--ps-inset)",
    border: "var(--ps-line-strong)",
  },
  model: {
    label: "Model",
    color: "var(--ps-indigo)",
    bg: "var(--ps-inset)",
    border: "var(--ps-line-strong)",
  },
  validator: {
    label: "Validator",
    color: "var(--ps-amber)",
    bg: "var(--ps-inset)",
    border: "var(--ps-line-strong)",
  },
  utility: {
    label: "Utility",
    color: "var(--ps-ink-muted)",
    bg: "var(--ps-inset)",
    border: "var(--ps-line)",
  },
  config: {
    label: "Config",
    color: "var(--ps-ink-muted)",
    bg: "var(--ps-inset)",
    border: "var(--ps-line)",
  },
  test: {
    label: "Test",
    color: "var(--ps-amber)",
    bg: "var(--ps-inset)",
    border: "var(--ps-line-strong)",
  },
  unknown: {
    label: "Other",
    color: "var(--ps-ink-muted)",
    bg: "var(--ps-inset)",
    border: "var(--ps-line)",
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

  // Clear job belonging to a different snapshot via derived value
  const activeJob =
    job && (!snapshotId || !job.snapshotId || job.snapshotId === snapshotId)
      ? job
      : null;

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
      const isValidAnalysis = Boolean(
        data &&
          typeof data === "object" &&
          data.graph &&
          Array.isArray(data.graph.nodes),
      );
      setAnalysis(isValidAnalysis ? data : null);

      if (isValidAnalysis) {
        const availableRoles = new Set(
          data.graph.nodes.map((n) => n.role || "unknown"),
        );
        setSelectedRoles(availableRoles);

        if (initialFile) {
          const matched = data.graph.nodes.find(
            (n) => n.relativePath === initialFile || n.id === initialFile,
          );
          if (matched) {
            setSelectedNodeId(matched.id);
          } else {
            setSelectedNodeId(data.graph.nodes[0]?.id || null);
          }
        } else {
          setSelectedNodeId((prev) =>
            prev && data.graph.nodes.some((n) => n.id === prev)
              ? prev
              : data.graph.nodes[0]?.id || null,
          );
        }
      } else {
        setSelectedRoles(new Set());
        setSelectedNodeId(null);
      }
      setError("");
    } catch (err) {
      if (/Architecture analysis not found/i.test(err.message)) {
        setAnalysis(null);
        setSelectedNodeId(null);
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
    if (
      !activeJob ||
      !["QUEUED", "RUNNING"].includes(activeJob.status) ||
      !projectId
    )
      return;
    const poll = async () => {
      try {
        const response = await getProjectJobsApi(projectId);
        const updated = (response.jobs || []).find((j) => j.id === activeJob.id);
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
    const timer = setInterval(poll, 5000);
    return () => clearInterval(timer);
  }, [activeJob, loadAnalysis, projectId]);

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

  const totalFunctionsCount = useMemo(() => {
    if (typeof analysis?.summary?.totalFunctions === "number") {
      return analysis.summary.totalFunctions;
    }
    return allNodes.reduce(
      (sum, n) => sum + (Array.isArray(n.functions) ? n.functions.length : 0),
      0,
    );
  }, [analysis?.summary?.totalFunctions, allNodes]);

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
      const roleKey = n.role || "unknown";
      counts[roleKey] = (counts[roleKey] || 0) + 1;
    });
    return Object.entries(counts).sort((a, b) => b[1] - a[1]);
  }, [allNodes]);

  // Filtered nodes based on View Mode + Domain + Role Filter
  const visibleNodes = useMemo(() => {
    return allNodes.filter((node) => {
      if (selectedRoles.size > 0 && !selectedRoles.has(node.role || "unknown")) {
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

  const selectedAiSummary = useMemo(() => {
    if (!snapshotId || !selectedNode?.relativePath) return null;
    return aiSummaryMap[`${snapshotId}:${selectedNode.relativePath}`] || null;
  }, [aiSummaryMap, snapshotId, selectedNode]);

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
      const summaryKey = `${snapshotId}:${filePath}`;
      if (!force && aiSummaryMap[summaryKey]) return;

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
            [summaryKey]: res.data,
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
    const summaryKey = `${snapshotId}:${filePath}`;
    if (aiSummaryMap[summaryKey]) return;

    let isCancelled = false;
    setIsAiLoading(true);
    setAiError("");

    getArchitectureAiSummaryApi(projectId, { snapshotId, filePath })
      .then((res) => {
        if (!isCancelled && res?.data) {
          setAiSummaryMap((prev) => ({
            ...prev,
            [summaryKey]: res.data,
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

  const status = activeJob?.status || (analysis ? "SUCCESS" : null);

  const analysisProgress = useMemo(() => {
    if (status === "SUCCESS") return 100;
    if (activeJob?.progress !== undefined && activeJob?.progress !== null) {
      return Math.min(100, Math.max(0, Math.round(activeJob.progress)));
    }
    if (status === "RUNNING") return 65;
    if (status === "QUEUED") return 15;
    if (loading) return 40;
    return 0;
  }, [status, activeJob, loading]);

  if (!projectId) {
    return (
      <section className="p-8 text-xs text-[var(--color-text-muted)] text-center">
        Please select a project to view its architecture.
      </section>
    );
  }

  return (
    <section className="portfolio-studio flex flex-col h-full w-full overflow-hidden bg-[var(--ps-bg)] text-[var(--ps-ink)] font-sans select-none">
      {/* --- TOP HEADER & CONTROLS --- */}
      <header className="shrink-0 h-12 px-4 border-b border-[var(--ps-line)] bg-[var(--ps-surface)] flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex items-center gap-1.5 text-xs text-[var(--ps-ink-muted)] ps-mono min-w-0">
            <Network size={14} style={{ color: "var(--ps-cobalt)" }} className="shrink-0" />
            <span>Architecture</span>
            <span className="text-[var(--ps-line-strong)]">/</span>
            <span className="text-[var(--ps-ink)] font-medium truncate">
              Network Graph
            </span>
          </div>

          {status && ["QUEUED", "RUNNING"].includes(status) ? (
            <div
              className="flex items-center gap-2 pl-2.5 border-l border-[var(--ps-line)]"
              title={`Analysis Progress: ${analysisProgress}%`}
            >
              <span
                className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] ps-mono border"
                style={{
                  backgroundColor: "color-mix(in srgb, var(--ps-amber) 10%, transparent)",
                  borderColor: "color-mix(in srgb, var(--ps-amber) 25%, transparent)",
                  color: "var(--ps-amber)",
                }}
              >
                <CircleDot size={10} className="animate-pulse" />
                <span>{STATUS_COPY[status] || status}</span>
                <span>{analysisProgress}%</span>
              </span>
            </div>
          ) : status ? (
            <span
              className="hidden sm:inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] ps-mono border border-[var(--ps-line)] bg-[var(--ps-inset)] text-[var(--ps-ink-secondary)]"
              title={`Status: ${STATUS_COPY[status] || status}`}
            >
              <span
                className="w-1.5 h-1.5 rounded-full"
                style={{
                  backgroundColor:
                    status === "SUCCESS"
                      ? "var(--ps-emerald)"
                      : status === "FAILED"
                        ? "var(--ps-rose)"
                        : "var(--ps-ink-muted)",
                }}
              />
              <span>{STATUS_COPY[status] || status}</span>
            </span>
          ) : null}
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-2 shrink-0">
          {/* Dual View Mode Selector */}
          <div className="flex items-center rounded-md border border-[var(--ps-line)] bg-[var(--ps-inset)] p-0.5">
            <button
              type="button"
              onClick={() => setViewMode("overview")}
              className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-[5px] transition-colors cursor-pointer ${
                viewMode === "overview"
                  ? "bg-[var(--ps-surface)] text-[var(--ps-ink)] border border-[var(--ps-line-strong)]"
                  : "text-[var(--ps-ink-muted)] hover:text-[var(--ps-ink)] border border-transparent"
              }`}
              title="View entire project network architecture"
            >
              <LayoutGrid size={12} />
              <span>System Overview</span>
            </button>
            <button
              type="button"
              onClick={() => setViewMode("module")}
              className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-[5px] transition-colors cursor-pointer ${
                viewMode === "module"
                  ? "bg-[var(--ps-surface)] text-[var(--ps-ink)] border border-[var(--ps-line-strong)]"
                  : "text-[var(--ps-ink-muted)] hover:text-[var(--ps-ink)] border border-transparent"
              }`}
              title="Focus on specific domain modules"
            >
              <Box size={12} />
              <span>Module View</span>
            </button>
          </div>

          {/* Snapshot selector */}
          <select
            value={snapshotId}
            onChange={(e) => setSnapshotId(e.target.value)}
            className="ps-select !h-7"
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
            className="w-7 h-7 rounded-md border border-[var(--ps-line)] bg-[var(--ps-surface)] text-[var(--ps-ink-secondary)] hover:text-[var(--ps-ink)] hover:bg-[var(--ps-surface-2)] inline-flex items-center justify-center cursor-pointer disabled:opacity-45 transition-colors"
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
            className="h-7 px-3 rounded-md ps-btn-contrast text-xs inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed"
          >
            <Play size={11} fill="currentColor" />
            <span>{analysis ? "Re-analyze" : "Run Analysis"}</span>
          </button>

          {/* Toggle Inspector Drawer */}
          {selectedNode && (
            <button
              type="button"
              onClick={() => setIsDrawerOpen((prev) => !prev)}
              className={`w-7 h-7 rounded-md border inline-flex items-center justify-center transition-colors cursor-pointer ${
                isDrawerOpen
                  ? "border-[var(--ps-line-strong)] bg-[var(--ps-surface-2)] text-[var(--ps-ink)]"
                  : "border-[var(--ps-line)] bg-[var(--ps-surface)] text-[var(--ps-ink-secondary)] hover:text-[var(--ps-ink)]"
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
        <div className="shrink-0 px-4 py-2 bg-[var(--ps-inset)] border-b border-[var(--ps-line)] flex flex-wrap items-center justify-between gap-3 text-xs">
          {/* Left: Domain Pills (in Module view) or Stats Summary */}
          {viewMode === "module" ? (
            <div className="flex items-center gap-1.5 overflow-x-auto custom-scrollbar py-0.5">
              <span className="text-[var(--ps-ink-muted)] font-medium flex items-center gap-1 pr-1 text-xs">
                <Box size={12} />
                Module:
              </span>
              <button
                type="button"
                onClick={() => setSelectedDomain("All")}
                className={`px-2.5 py-0.5 rounded-md text-xs font-medium transition-colors cursor-pointer border ${
                  selectedDomain === "All"
                    ? "bg-[var(--ps-ink)] text-[var(--ps-bg)] border-transparent"
                    : "bg-[var(--ps-surface)] text-[var(--ps-ink-secondary)] hover:text-[var(--ps-ink)] border-[var(--ps-line)]"
                }`}
              >
                All ({allNodes.length})
              </button>
              {availableDomains.map((dom) => {
                const count = allNodes.filter((n) => n.domain === dom).length;
                const isSelected = selectedDomain === dom;
                return (
                  <button
                    type="button"
                    key={dom}
                    onClick={() => setSelectedDomain(dom)}
                    className={`px-2.5 py-0.5 rounded-md text-xs font-medium transition-colors cursor-pointer flex items-center gap-1.5 border ${
                      isSelected
                        ? "bg-[var(--ps-ink)] text-[var(--ps-bg)] border-transparent"
                        : "bg-[var(--ps-surface)] text-[var(--ps-ink-secondary)] hover:text-[var(--ps-ink)] border-[var(--ps-line)]"
                    }`}
                  >
                    <span>{dom}</span>
                    <span
                      className={`text-[10px] ps-mono ${
                        isSelected ? "opacity-75" : "text-[var(--ps-ink-muted)]"
                      }`}
                    >
                      {count}
                    </span>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="flex items-center gap-2 text-xs ps-mono text-[var(--ps-ink-muted)]">
              <span className="font-semibold text-[var(--ps-ink)]">
                {visibleNodes.length}
              </span>
              <span>files</span>
              <span>·</span>
              <span className="font-semibold text-[var(--ps-ink)]">
                {visibleEdges.length}
              </span>
              <span>dependencies</span>
              <span>·</span>
              <span className="font-semibold text-[var(--ps-ink)]">
                {totalFunctionsCount}
              </span>
              <span>functions</span>
            </div>
          )}

          {/* Right: Calm Monochrome Role Chips */}
          <div className="flex items-center gap-1.5 overflow-x-auto custom-scrollbar py-0.5">
            <span className="text-[var(--ps-ink-muted)] font-medium flex items-center gap-1 pr-1 text-[11px]">
              <Filter size={11} />
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
                  className={`px-2 py-0.5 rounded-md text-[11px] ps-mono transition-colors cursor-pointer flex items-center gap-1.5 border ${
                    isActive
                      ? "bg-[var(--ps-surface)] border-[var(--ps-line-strong)] text-[var(--ps-ink)]"
                      : "bg-transparent border-transparent text-[var(--ps-ink-muted)] opacity-55 hover:opacity-90"
                  }`}
                  title={`Toggle role ${theme.label}`}
                >
                  <span
                    className="w-1.5 h-1.5 rounded-full shrink-0"
                    style={{ backgroundColor: theme.color }}
                  />
                  <span>{theme.label}</span>
                  <span className="text-[10px] text-[var(--ps-ink-muted)]">{count}</span>
                </button>
              );
            })}
            <div className="w-[1px] h-3.5 bg-[var(--ps-line)] mx-0.5 shrink-0" />
            <button
              type="button"
              onClick={selectAllRoles}
              className={`px-2 py-0.5 rounded-md text-[11px] ps-mono transition-colors cursor-pointer flex items-center gap-1 border shrink-0 ${
                selectedRoles.size === availableRoles.length
                  ? "bg-[var(--ps-surface)] border-[var(--ps-line)] text-[var(--ps-ink-secondary)] hover:text-[var(--ps-ink)]"
                  : "ps-btn-contrast border-transparent"
              }`}
              title="Show all roles"
            >
              <span>All</span>
              <span className="text-[10px] opacity-75">({allNodes.length})</span>
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
        <div className="flex-1 flex flex-col items-center justify-center p-8 text-center bg-[var(--ps-bg)]">
          <div className="w-11 h-11 rounded-lg bg-[var(--ps-surface)] border border-[var(--ps-line)] flex items-center justify-center text-[var(--ps-cobalt)] mb-3">
            <Network size={20} />
          </div>
          <h2 className="ps-display text-sm font-semibold text-[var(--ps-ink)]">
            Architecture map unavailable
          </h2>
          <p className="mt-1 text-xs text-[var(--ps-ink-secondary)] max-w-sm">
            Run architecture analysis to inspect repository dependencies and module interactions.
          </p>
          <button
            type="button"
            onClick={startAnalysis}
            disabled={!snapshotId || loading}
            className="mt-4 flex items-center gap-1.5 px-3.5 py-1.5 rounded-md ps-btn-contrast text-xs cursor-pointer disabled:opacity-45"
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
                    className={`rounded-lg border p-2.5 flex flex-col justify-between cursor-pointer select-none bg-[var(--ps-surface)] ${
                      isSelected
                        ? "border-[var(--ps-cobalt)] ring-1 ring-[var(--ps-cobalt)]/35 shadow-sm"
                        : isHovered
                          ? "border-[var(--ps-line-strong)]"
                          : "border-[var(--ps-line)] hover:border-[var(--ps-line-strong)]"
                    }`}
                  >
                    {/* Top Row: Quiet Role Dot Badge & Domain Tag */}
                    <div className="flex items-center justify-between gap-1.5 leading-none">
                      <span
                        className="inline-flex items-center gap-1.5 px-1.5 py-0.5 rounded border text-[10px] ps-mono font-medium truncate"
                        style={{
                          color: "var(--ps-ink-secondary)",
                          backgroundColor: theme.bg,
                          borderColor: theme.border,
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
                          className="flex items-center gap-1 text-[10px] ps-mono font-medium"
                          style={{ color: "var(--ps-cobalt)" }}
                          title="Analyzing file architecture..."
                        >
                          <RefreshCw size={10} className="animate-spin" />
                          <span>AI</span>
                        </span>
                      ) : node.domain ? (
                        <span
                          className="text-[10px] ps-mono text-[var(--ps-ink-muted)] truncate max-w-[95px]"
                          title={`Domain: ${node.domain}`}
                        >
                          {node.domain}
                        </span>
                      ) : null}
                    </div>

                    {/* Middle: File Name */}
                    <div
                      className="ps-mono text-xs font-semibold text-[var(--ps-ink)] truncate leading-normal py-0.5"
                      title={node.relativePath}
                    >
                      {fileName}
                    </div>

                    {/* Bottom: LOC & Functions Stats */}
                    <div className="flex items-center justify-between text-[10px] ps-mono text-[var(--ps-ink-muted)] pt-1.5 border-t border-[var(--ps-line)] leading-none">
                      <span
                        className="flex items-center gap-1"
                        title={`${node.lineCount || 0} Lines of code`}
                      >
                        <FileCode
                          size={11}
                          className="shrink-0 text-[var(--ps-ink-muted)]"
                        />
                        <span>{node.lineCount || 0}L</span>
                      </span>
                      <span
                        className="flex items-center gap-1"
                        title={`${node.functions?.length || 0} Functions`}
                      >
                        <FunctionSquare
                          size={11}
                          className="shrink-0 text-[var(--ps-ink-muted)]"
                        />
                        <span>{node.functions?.length || 0} fn</span>
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* FLOATING CANVAS CONTROLS TOOLBAR */}
            <div className="absolute bottom-5 left-5 flex items-center gap-1 p-1 bg-[var(--ps-surface)] border border-[var(--ps-line-strong)] rounded-lg shadow-lg z-30">
              <button
                type="button"
                onClick={() => setZoom((prev) => Math.min(2.5, prev * 1.15))}
                className="p-1.5 text-[var(--ps-ink-secondary)] hover:text-[var(--ps-ink)] hover:bg-[var(--ps-surface-2)] rounded-md transition-colors cursor-pointer"
                title="Zoom In (+)"
                aria-label="Zoom In"
              >
                <ZoomIn size={14} />
              </button>
              <button
                type="button"
                onClick={() => setZoom((prev) => Math.max(0.25, prev * 0.85))}
                className="p-1.5 text-[var(--ps-ink-secondary)] hover:text-[var(--ps-ink)] hover:bg-[var(--ps-surface-2)] rounded-md transition-colors cursor-pointer"
                title="Zoom Out (-)"
                aria-label="Zoom Out"
              >
                <ZoomOut size={14} />
              </button>
              <button
                type="button"
                onClick={handleResetView}
                className="px-2 py-1 text-xs ps-mono font-medium text-[var(--ps-ink)] hover:bg-[var(--ps-surface-2)] rounded-md cursor-pointer"
                title="Reset View (100%)"
                aria-label="Reset View"
              >
                {Math.round(zoom * 100)}%
              </button>
              <button
                type="button"
                onClick={handleFitView}
                className="p-1.5 text-[var(--ps-ink-secondary)] hover:text-[var(--ps-ink)] hover:bg-[var(--ps-surface-2)] rounded-md transition-colors cursor-pointer"
                title="Fit to Screen"
                aria-label="Fit to Screen"
              >
                <Maximize2 size={14} />
              </button>

              <div className="w-[1px] h-4 bg-[var(--ps-line)] mx-1" />

              {/* Orientation toggle */}
              <button
                type="button"
                onClick={() =>
                  setOrientation((prev) => (prev === "LR" ? "TB" : "LR"))
                }
                className="px-2 py-1 text-xs ps-mono font-medium text-[var(--ps-ink)] hover:bg-[var(--ps-surface-2)] rounded-md cursor-pointer flex items-center gap-1"
                title="Toggle Graph Layout (Horizontal / Vertical)"
                aria-label="Toggle Graph Layout"
              >
                <ArrowDownUp size={13} />
                <span>{orientation === "LR" ? "Horizontal" : "Vertical"}</span>
              </button>

              <div className="w-[1px] h-4 bg-[var(--ps-line)] mx-1" />

              {/* Card Size Scale Toggle */}
              <button
                type="button"
                onClick={() => setCardScale((prev) => (prev === 1 ? 1.15 : 1))}
                className={`px-2 py-1 text-xs ps-mono font-medium rounded-md cursor-pointer transition-colors ${
                  cardScale > 1
                    ? "ps-btn-contrast"
                    : "text-[var(--ps-ink-secondary)] hover:text-[var(--ps-ink)] hover:bg-[var(--ps-surface-2)]"
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
                className="h-full shrink-0 border-l border-[var(--ps-line)] bg-[var(--ps-surface)] flex flex-col z-40 shadow-xl relative"
              >
                {/* Drag Resize Handle on left border of drawer */}
                <div
                  onMouseDown={handleDrawerResizeStart}
                  className={`absolute -left-1.5 top-0 bottom-0 w-3 cursor-col-resize z-50 transition-colors ${
                    isResizingDrawer
                      ? "bg-[var(--ps-cobalt)]"
                      : "hover:bg-[var(--ps-cobalt)]/40"
                  }`}
                  title="Drag to resize Inspector drawer"
                />

                {/* Drawer Header */}
                <div className="p-3.5 border-b border-[var(--ps-line)] flex items-start justify-between gap-3 bg-[var(--ps-inset)]">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 mb-1.5">
                      <span
                        className="inline-flex items-center gap-1.5 px-1.5 py-0.5 rounded border text-[10px] ps-mono font-medium"
                        style={{
                          backgroundColor:
                            ROLE_THEMES[selectedNode.role]?.bg || "var(--ps-surface)",
                          color: "var(--ps-ink-secondary)",
                          borderColor:
                            ROLE_THEMES[selectedNode.role]?.border || "var(--ps-line)",
                        }}
                      >
                        <span
                          className="w-1.5 h-1.5 rounded-full"
                          style={{
                            backgroundColor:
                              ROLE_THEMES[selectedNode.role]?.color ||
                              "var(--ps-ink-muted)",
                          }}
                        />
                        {ROLE_THEMES[selectedNode.role]?.label ||
                          selectedNode.role}
                      </span>
                      {selectedNode.domain && (
                        <span className="px-1.5 py-0.5 rounded text-[10px] ps-mono text-[var(--ps-ink-muted)] bg-[var(--ps-surface)] border border-[var(--ps-line)]">
                          {selectedNode.domain}
                        </span>
                      )}
                    </div>
                    <h2
                      className="ps-mono text-sm font-semibold text-[var(--ps-ink)] truncate"
                      title={selectedNode.relativePath}
                    >
                      {(selectedNode.relativePath || "")
                        .replace(/\\/g, "/")
                        .split("/")
                        .pop()}
                    </h2>
                    <p className="text-[11px] ps-mono text-[var(--ps-ink-muted)] mt-0.5 truncate">
                      {selectedNode.relativePath}
                    </p>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {isAiLoading && (
                      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] ps-mono text-[var(--ps-cobalt)] bg-[var(--ps-surface)] border border-[var(--ps-line)]">
                        <RefreshCw size={10} className="animate-spin" />
                        <span>AI</span>
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => setIsDrawerOpen(false)}
                      className="p-1 rounded text-[var(--ps-ink-muted)] hover:text-[var(--ps-ink)] hover:bg-[var(--ps-surface-2)] cursor-pointer transition-colors"
                      title="Close Inspector"
                      aria-label="Close Inspector"
                    >
                      <X size={15} />
                    </button>
                  </div>
                </div>

                {/* Metrics Stats Grid */}
                <div className="grid grid-cols-4 p-3 gap-2 border-b border-[var(--ps-line)] bg-[var(--ps-surface)] text-center ps-mono">
                  <div className="p-2 rounded-md bg-[var(--ps-inset)] border border-[var(--ps-line)]">
                    <div className="text-[9.5px] font-medium text-[var(--ps-ink-muted)] uppercase tracking-wider">
                      Lines
                    </div>
                    <div className="text-sm font-semibold text-[var(--ps-ink)] mt-0.5">
                      {selectedNode.lineCount || 0}
                    </div>
                  </div>
                  <div className="p-2 rounded-md bg-[var(--ps-inset)] border border-[var(--ps-line)]">
                    <div className="text-[9.5px] font-medium text-[var(--ps-ink-muted)] uppercase tracking-wider">
                      Functions
                    </div>
                    <div className="text-sm font-semibold text-[var(--ps-ink)] mt-0.5">
                      {selectedNode.functions?.length || 0}
                    </div>
                  </div>
                  <div className="p-2 rounded-md bg-[var(--ps-inset)] border border-[var(--ps-line)]">
                    <div className="text-[9.5px] font-medium text-[var(--ps-ink-muted)] uppercase tracking-wider">
                      Calls Out
                    </div>
                    <div
                      className="text-sm font-semibold mt-0.5"
                      style={{ color: "var(--ps-emerald)" }}
                    >
                      {selectedNodeDeps.outgoing.length}
                    </div>
                  </div>
                  <div className="p-2 rounded-md bg-[var(--ps-inset)] border border-[var(--ps-line)]">
                    <div className="text-[9.5px] font-medium text-[var(--ps-ink-muted)] uppercase tracking-wider">
                      Called In
                    </div>
                    <div
                      className="text-sm font-semibold mt-0.5"
                      style={{ color: "var(--ps-cobalt)" }}
                    >
                      {selectedNodeDeps.incoming.length}
                    </div>
                  </div>
                </div>

                {/* Drawer Scrollable Content */}
                <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar">
                  {/* Rotating Loading Spinner for AI Summary */}
                  {isAiLoading && (
                    <div className="p-4 rounded-lg border border-[var(--ps-line)] bg-[var(--ps-inset)] flex items-center justify-center gap-2.5 text-xs text-[var(--ps-ink-secondary)]">
                      <RefreshCw
                        size={14}
                        className="animate-spin shrink-0"
                        style={{ color: "var(--ps-cobalt)" }}
                      />
                      <span className="ps-mono">
                        Analyzing file architecture...
                      </span>
                    </div>
                  )}

                  {/* AI Architectural Summary Block */}
                  {selectedAiSummary && !isAiLoading && (
                    <div className="p-3.5 rounded-lg border border-[var(--ps-line)] bg-[var(--ps-inset)]">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-1.5 text-xs font-semibold text-[var(--ps-ink)]">
                          <Sparkles
                            size={13}
                            style={{ color: "var(--ps-cobalt)" }}
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
                          className="inline-flex items-center gap-1 text-[11px] ps-mono text-[var(--ps-ink-secondary)] hover:text-[var(--ps-ink)] cursor-pointer transition-colors"
                          title="Re-analyze summary"
                        >
                          <RefreshCw size={10} />
                          <span>Re-analyze</span>
                        </button>
                      </div>
                      <p className="text-xs text-[var(--ps-ink-secondary)] leading-relaxed">
                        {selectedAiSummary.fileSummary}
                      </p>
                    </div>
                  )}

                  {aiError &&
                    !isAiLoading &&
                    !selectedAiSummary && (
                      <div
                        className="p-3 rounded-lg border text-xs flex items-center justify-between gap-2"
                        style={{
                          backgroundColor: "color-mix(in srgb, var(--ps-rose) 8%, transparent)",
                          borderColor: "color-mix(in srgb, var(--ps-rose) 25%, transparent)",
                          color: "var(--ps-rose)",
                        }}
                      >
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
                    <h3 className="text-xs font-semibold text-[var(--ps-ink)] flex items-center justify-between mb-2.5">
                      <span className="flex items-center gap-1.5">
                        <FunctionSquare
                          size={13}
                          style={{ color: "var(--ps-cobalt)" }}
                        />
                        <span>
                          Functions &amp; Methods ({selectedNode.functions?.length || 0})
                        </span>
                      </span>
                    </h3>

                    {!selectedNode.functions || selectedNode.functions.length === 0 ? (
                      <div className="p-3 text-center text-xs text-[var(--ps-ink-muted)] border border-dashed border-[var(--ps-line)] rounded-lg">
                        No functions detected in this file.
                      </div>
                    ) : (
                      <div className="rounded-lg border border-[var(--ps-line)] bg-[var(--ps-inset)] divide-y divide-[var(--ps-line)] overflow-hidden">
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
                            selectedAiSummary
                              ?.functionSummaries?.[fn.id] ||
                            selectedAiSummary
                              ?.functionSummaries?.[
                              `${displayName}@L${fn.startLine}`
                            ] ||
                            selectedAiSummary
                              ?.functionSummaries?.[
                              `${displayName} (L${fn.startLine})`
                            ] ||
                            selectedAiSummary
                              ?.functionSummaries?.[fn.name] ||
                            (isArrow
                              ? selectedAiSummary
                                  ?.functionSummaries?.["arrow function"] ||
                                selectedAiSummary
                                  ?.functionSummaries?.["anonymous"]
                              : null);

                          return (
                            <div
                              key={fn.id || idx}
                              className="p-2.5 hover:bg-[var(--ps-surface)]/70 transition-colors"
                            >
                              <div className="flex items-center justify-between gap-2">
                                <div className="flex items-center gap-1.5 min-w-0">
                                  <span className="ps-mono text-xs font-medium text-[var(--ps-ink)] truncate">
                                    {displayName}
                                  </span>
                                  {isArrow && (
                                    <span className="text-[9px] ps-mono px-1 py-0.2 rounded bg-[var(--ps-surface)] text-[var(--ps-ink-muted)] border border-[var(--ps-line)] shrink-0">
                                      =&gt;
                                    </span>
                                  )}
                                </div>
                                <div className="flex items-center gap-1.5 shrink-0">
                                  {fn.exported && (
                                    <span
                                      className="text-[9px] ps-mono px-1.5 py-0.2 rounded border uppercase"
                                      style={{
                                        backgroundColor: "color-mix(in srgb, var(--ps-emerald) 10%, transparent)",
                                        borderColor: "color-mix(in srgb, var(--ps-emerald) 25%, transparent)",
                                        color: "var(--ps-emerald)",
                                      }}
                                    >
                                      exp
                                    </span>
                                  )}
                                  <span className="text-[10px] ps-mono text-[var(--ps-ink-muted)]">
                                    L{fn.startLine}–L{fn.endLine}
                                  </span>
                                </div>
                              </div>

                              {/* AI Explanation for function (only if available) */}
                              {fnAiSummary && (
                                <p className="text-[11px] text-[var(--ps-ink-secondary)] mt-1.5 pl-2.5 border-l border-[var(--ps-line-strong)] leading-relaxed">
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
                  <div className="space-y-3 pt-3 border-t border-[var(--ps-line)]">
                    {/* Outgoing */}
                    <div>
                      <h4 className="text-xs font-semibold text-[var(--ps-ink)] flex items-center gap-1.5 mb-2">
                        <ArrowRight
                          size={13}
                          style={{ color: "var(--ps-emerald)" }}
                        />
                        <span>
                          Outgoing Dependencies ({selectedNodeDeps.outgoing.length})
                        </span>
                      </h4>
                      {selectedNodeDeps.outgoing.length === 0 ? (
                        <p className="text-[11px] text-[var(--ps-ink-muted)] pl-1">
                          No internal source imports.
                        </p>
                      ) : (
                        <div className="space-y-1.5">
                          {selectedNodeDeps.outgoing.map((dep) => (
                            <button
                              type="button"
                              key={dep.id}
                              onClick={() => jumpToNode(dep.id)}
                              className="w-full text-left p-2 rounded-md border border-[var(--ps-line)] bg-[var(--ps-inset)] hover:bg-[var(--ps-surface-2)] hover:border-[var(--ps-line-strong)] transition-colors flex items-center justify-between text-xs ps-mono cursor-pointer"
                              title={`Jump to ${dep.relativePath}`}
                            >
                              <span className="truncate text-[var(--ps-ink)] font-medium">
                                {(dep.relativePath || "")
                                  .replace(/\\/g, "/")
                                  .split("/")
                                  .pop()}
                              </span>
                              <span className="inline-flex items-center gap-1.5 text-[10px] ps-mono uppercase px-1.5 py-0.5 rounded border border-[var(--ps-line)] bg-[var(--ps-surface)] text-[var(--ps-ink-secondary)]">
                                <span
                                  className="w-1.5 h-1.5 rounded-full"
                                  style={{ backgroundColor: ROLE_THEMES[dep.role]?.color || "var(--ps-ink-muted)" }}
                                />
                                {dep.role}
                              </span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Incoming */}
                    <div>
                      <h4 className="text-xs font-semibold text-[var(--ps-ink)] flex items-center gap-1.5 mb-2">
                        <ArrowLeft
                          size={13}
                          style={{ color: "var(--ps-cobalt)" }}
                        />
                        <span>
                          Incoming Dependencies ({selectedNodeDeps.incoming.length})
                        </span>
                      </h4>
                      {selectedNodeDeps.incoming.length === 0 ? (
                        <p className="text-[11px] text-[var(--ps-ink-muted)] pl-1">
                          Not imported by other internal files.
                        </p>
                      ) : (
                        <div className="space-y-1.5">
                          {selectedNodeDeps.incoming.map((dep) => (
                            <button
                              type="button"
                              key={dep.id}
                              onClick={() => jumpToNode(dep.id)}
                              className="w-full text-left p-2 rounded-md border border-[var(--ps-line)] bg-[var(--ps-inset)] hover:bg-[var(--ps-surface-2)] hover:border-[var(--ps-line-strong)] transition-colors flex items-center justify-between text-xs ps-mono cursor-pointer"
                              title={`Jump to ${dep.relativePath}`}
                            >
                              <span className="truncate text-[var(--ps-ink)] font-medium">
                                {(dep.relativePath || "")
                                  .replace(/\\/g, "/")
                                  .split("/")
                                  .pop()}
                              </span>
                              <span className="inline-flex items-center gap-1.5 text-[10px] ps-mono uppercase px-1.5 py-0.5 rounded border border-[var(--ps-line)] bg-[var(--ps-surface)] text-[var(--ps-ink-secondary)]">
                                <span
                                  className="w-1.5 h-1.5 rounded-full"
                                  style={{ backgroundColor: ROLE_THEMES[dep.role]?.color || "var(--ps-ink-muted)" }}
                                />
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
