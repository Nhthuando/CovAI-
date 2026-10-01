/* eslint-disable react-hooks/set-state-in-effect -- async API synchronization initializes snapshot-bound server state. */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  CircleDot,
  GitBranch,
  Network,
  Play,
  RefreshCw,
  Route,
  Workflow,
} from "lucide-react";
import {
  getProjectSnapshotsApi,
  getProjectStructureAnalysisApi,
  runProjectStructureAnalysisApi,
} from "../../services/project.service";
import { getProjectJobsApi } from "../../services/job.service";

const ROLE_COLORS = {
  route: "#3b82f6",
  controller: "#0ea5e9",
  service: "#8b5cf6",
  middleware: "#f59e0b",
  component: "#10b981",
  page: "#14b8a6",
  model: "#ec4899",
  utility: "#64748b",
  config: "#f43f5e",
  validator: "#eab308",
  test: "#64748b",
  unknown: "#94a3b8",
};

const STATUS_COPY = {
  QUEUED: "Queued",
  RUNNING: "Mapping project",
  SUCCESS: "Completed",
  FAILED: "Failed",
  CANCELED: "Canceled",
};

const compactName = (value, limit = 24) =>
  value.length > limit ? `${value.slice(0, limit - 1)}…` : value;

function ArchitectureMap({
  analysis,
  selectedNodeId,
  onSelectNode,
  roleFilter,
}) {
  const graph = analysis?.graph || { nodes: [], edges: [] };
  const layers = analysis?.architecture?.layers || [];
  const visibleLayers = layers
    .map((layer) => ({
      ...layer,
      fileIds: layer.fileIds.filter((id) => {
        const node = graph.nodes.find((item) => item.id === id);
        return !roleFilter || node?.role === roleFilter;
      }),
    }))
    .filter((layer) => layer.fileIds.length > 0);

  const layout = useMemo(() => {
    const positions = new Map();
    const rendered = [];
    const columnWidth = Math.max(
      210,
      Math.floor(920 / Math.max(visibleLayers.length, 1)),
    );
    visibleLayers.forEach((layer, layerIndex) => {
      layer.fileIds.slice(0, 7).forEach((id, nodeIndex) => {
        const node = graph.nodes.find((item) => item.id === id);
        if (!node) return;
        const point = {
          x: 25 + layerIndex * columnWidth,
          y: 75 + nodeIndex * 55,
        };
        positions.set(id, point);
        rendered.push({ ...node, ...point });
      });
    });
    return {
      positions,
      rendered,
      width: Math.max(920, visibleLayers.length * columnWidth + 30),
    };
  }, [graph.nodes, visibleLayers]);

  const visibleEdges = graph.edges.filter(
    (edge) => layout.positions.has(edge.from) && layout.positions.has(edge.to),
  );
  if (layout.rendered.length === 0)
    return (
      <p className="p-6 text-xs text-[var(--color-text-muted)] text-center">
        No modules match the selected filter.
      </p>
    );

  return (
    <div className="overflow-auto rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-2">
      <svg
        viewBox={`0 0 ${layout.width} 500`}
        className="min-w-[920px] w-full"
        role="img"
        aria-label="Project module dependency diagram"
      >
        <defs>
          <marker
            id="architecture-arrow"
            viewBox="0 0 10 10"
            refX="8"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--color-text-muted)" />
          </marker>
        </defs>
        {visibleLayers.map((layer, index) => (
          <g key={layer.id}>
            <rect
              x={
                13 +
                index *
                  Math.max(
                    210,
                    Math.floor(920 / Math.max(visibleLayers.length, 1)),
                  )
              }
              y="18"
              width="190"
              height="455"
              rx="8"
              fill="var(--color-surface-secondary)"
              stroke="var(--color-border)"
            />
            <text
              x={
                28 +
                index *
                  Math.max(
                    210,
                    Math.floor(920 / Math.max(visibleLayers.length, 1)),
                  )
              }
              y="46"
              fill="var(--color-text)"
              fontSize="12"
              fontWeight="600"
            >
              {layer.label}
            </text>
            <text
              x={
                28 +
                index *
                  Math.max(
                    210,
                    Math.floor(920 / Math.max(visibleLayers.length, 1)),
                  )
              }
              y="63"
              fill="var(--color-text-muted)"
              fontSize="10"
              fontFamily="var(--font-mono)"
            >
              {layer.fileIds.length} module
              {layer.fileIds.length === 1 ? "" : "s"}
            </text>
          </g>
        ))}
        {visibleEdges.map((edge) => {
          const from = layout.positions.get(edge.from);
          const to = layout.positions.get(edge.to);
          return (
            <line
              key={edge.id}
              x1={from.x + 172}
              y1={from.y + 18}
              x2={to.x}
              y2={to.y + 18}
              stroke="var(--color-border)"
              strokeWidth="1.2"
              markerEnd="url(#architecture-arrow)"
            />
          );
        })}
        {layout.rendered.map((node) => {
          const selected = node.id === selectedNodeId;
          const color = ROLE_COLORS[node.role] || ROLE_COLORS.unknown;
          return (
            <g
              key={node.id}
              tabIndex="0"
              role="button"
              aria-label={`Inspect ${node.relativePath}`}
              onClick={() => onSelectNode(node.id)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ")
                  onSelectNode(node.id);
              }}
              className="cursor-pointer outline-none"
            >
              <rect
                x={node.x}
                y={node.y}
                width="172"
                height="36"
                rx="6"
                fill={
                  selected
                    ? "var(--color-surface-secondary)"
                    : "var(--color-surface)"
                }
                stroke={
                  selected ? "var(--color-primary)" : "var(--color-border)"
                }
                strokeWidth={selected ? "2" : "1"}
              />
              <circle cx={node.x + 12} cy={node.y + 18} r="4" fill={color} />
              <text
                x={node.x + 22}
                y={node.y + 16}
                fill={selected ? "var(--color-primary)" : "var(--color-text)"}
                fontSize="10.5"
                fontWeight={selected ? "600" : "500"}
                fontFamily="var(--font-mono)"
              >
                {compactName(node.relativePath)}
              </text>
              <text
                x={node.x + 22}
                y={node.y + 28}
                fill="var(--color-text-muted)"
                fontSize="9"
              >
                {node.role} · {node.functions.length} fn
                {node.functions.length === 1 ? "" : "s"}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function ControlFlowDiagram({ functionRecord }) {
  const graph = functionRecord?.controlFlow;
  if (!graph?.nodes?.length)
    return (
      <p className="text-xs text-[var(--color-text-muted)] p-4 text-center">
        Select a function to see its algorithm/control-flow graph.
      </p>
    );
  const positions = new Map(
    graph.nodes.map((node, index) => [
      node.id,
      { x: 28 + (index % 5) * 150, y: 30 + Math.floor(index / 5) * 78 },
    ]),
  );
  return (
    <svg
      viewBox="0 0 780 260"
      className="w-full min-w-[640px]"
      role="img"
      aria-label={`Control flow diagram for ${functionRecord.name}`}
    >
      <defs>
        <marker
          id="cfg-arrow"
          viewBox="0 0 10 10"
          refX="8"
          refY="5"
          markerWidth="6"
          markerHeight="6"
          orient="auto"
        >
          <path d="M0 0 L10 5 L0 10 z" fill="var(--color-text-muted)" />
        </marker>
      </defs>
      {graph.edges.map((edge, index) => {
        const from = positions.get(edge.from);
        const to = positions.get(edge.to);
        if (!from || !to) return null;
        return (
          <line
            key={`${edge.from}-${edge.to}-${index}`}
            x1={from.x + 108}
            y1={from.y + 20}
            x2={to.x}
            y2={to.y + 20}
            stroke="var(--color-border)"
            markerEnd="url(#cfg-arrow)"
          />
        );
      })}
      {graph.nodes.map((node) => {
        const point = positions.get(node.id);
        const color =
          node.type === "condition"
            ? "#f59e0b"
            : node.type === "return"
              ? "#16a34a"
              : "#2563eb";
        return (
          <g key={node.id}>
            <rect
              x={point.x}
              y={point.y}
              width="108"
              height="40"
              rx="6"
              fill="var(--color-surface)"
              stroke={color}
              strokeWidth="1.5"
            />
            <text
              x={point.x + 9}
              y={point.y + 17}
              fill="var(--color-text)"
              fontSize="10"
              fontWeight="600"
            >
              {node.type}
            </text>
            <text
              x={point.x + 9}
              y={point.y + 31}
              fill="var(--color-text-muted)"
              fontSize="9"
              fontFamily="var(--font-mono)"
            >
              line {node.line ?? "—"}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export default function ProjectArchitecturePanel({ projectId, initialFile }) {
  const [snapshots, setSnapshots] = useState([]);
  const [snapshotId, setSnapshotId] = useState("");
  const [analysis, setAnalysis] = useState(null);
  const [job, setJob] = useState(null);
  const [selectedNodeId, setSelectedNodeId] = useState("");
  const [selectedFunctionId, setSelectedFunctionId] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [mode, setMode] = useState("map");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const loadSnapshots = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    try {
      const response = await getProjectSnapshotsApi(projectId);
      const nextSnapshots = response.data || [];
      setSnapshots(nextSnapshots);
      setSnapshotId((current) =>
        nextSnapshots.some((item) => item.id === current)
          ? current
          : nextSnapshots[0]?.id || "",
      );
      setError("");
    } catch (requestError) {
      setError(requestError.message || "Could not load project snapshots.");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  const loadAnalysis = useCallback(async () => {
    if (!projectId || !snapshotId) return;
    setLoading(true);
    try {
      const response = await getProjectStructureAnalysisApi(
        projectId,
        snapshotId,
      );
      setAnalysis(response.data);
      setSelectedNodeId((current) => {
        if (initialFile && response.data?.graph?.nodes) {
          const matched = response.data.graph.nodes.find(n => n.relativePath === initialFile || n.id === initialFile);
          if (matched) return matched.id;
        }
        return current || response.data?.graph?.nodes?.[0]?.id || "";
      });
      setSelectedFunctionId(
        (current) => current || response.data?.functions?.[0]?.id || "",
      );
      setError("");
    } catch (requestError) {
      if (/Architecture analysis not found/i.test(requestError.message))
        setAnalysis(null);
      else
        setError(
          requestError.message || "Could not load architecture analysis.",
        );
    } finally {
      setLoading(false);
    }
  }, [projectId, snapshotId]);

  useEffect(() => {
    loadSnapshots();
  }, [loadSnapshots]);
  useEffect(() => {
    loadAnalysis();
  }, [loadAnalysis]);

  useEffect(() => {
    if (initialFile && analysis?.graph?.nodes) {
      const matched = analysis.graph.nodes.find(n => n.relativePath === initialFile || n.id === initialFile);
      if (matched) setSelectedNodeId(matched.id);
    }
  }, [initialFile, analysis]);

  useEffect(() => {
    if (!job || !["QUEUED", "RUNNING"].includes(job.status) || !projectId)
      return undefined;
    const poll = async () => {
      try {
        const response = await getProjectJobsApi(projectId);
        const updated = (response.jobs || []).find(
          (item) => item.id === job.id,
        );
        if (!updated) return;
        setJob(updated);
        if (updated.status === "SUCCESS") loadAnalysis();
        if (updated.status === "FAILED")
          setError(updated.errorMessage || "Architecture analysis failed.");
      } catch {
        /* Job Queue remains available if optional polling fails. */
      }
    };
    poll();
    const timer = window.setInterval(poll, 2500);
    return () => window.clearInterval(timer);
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
    } catch (requestError) {
      setError(
        requestError.message || "Could not start architecture analysis.",
      );
    } finally {
      setLoading(false);
    }
  };

  const selectedNode = analysis?.graph?.nodes?.find(
    (node) => node.id === selectedNodeId,
  );
  const selectedFunction = analysis?.functions?.find(
    (item) => item.id === selectedFunctionId,
  );
  const roles = [
    ...new Set(analysis?.graph?.nodes?.map((node) => node.role) || []),
  ].sort();
  const status = job?.status || (analysis ? "SUCCESS" : null);

  if (!projectId)
    return (
      <section className="p-8 text-xs text-[var(--color-text-muted)] text-center">
        Select a project to explore its architecture.
      </section>
    );

  return (
    <section className="h-full overflow-y-auto p-5 sm:p-6 bg-[var(--color-bg)] text-[var(--color-text)] font-sans">
      <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="mb-1.5 flex items-center gap-1.5 text-xs text-[var(--color-text-muted)] font-mono">
            <Network size={14} className="text-[var(--color-primary)]" />
            <span>Project</span>
            <span>/</span>
            <span className="text-[var(--color-text-secondary)] font-medium">
              Architecture
            </span>
          </div>
          <h1 className="text-xl sm:text-2xl font-bold text-[var(--color-text)] tracking-tight">
            Understand this project at a glance
          </h1>
          <p className="mt-1 max-w-2xl text-xs sm:text-sm text-[var(--color-text-secondary)] leading-relaxed">
            Static analysis maps source modules, dependencies, entry flows, and
            function algorithms without executing repository code.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label="Architecture snapshot"
            value={snapshotId}
            onChange={(event) => setSnapshotId(event.target.value)}
            className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)] px-3 py-1.5 text-xs font-mono focus:border-[var(--color-primary)] outline-none"
          >
            {snapshots.map((snapshot) => (
              <option value={snapshot.id} key={snapshot.id}>
                {snapshot.commitSha || snapshot.checksum || snapshot.id}
              </option>
            ))}
          </select>
          <button
            onClick={loadAnalysis}
            disabled={loading}
            className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-2 text-[var(--color-text-secondary)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-secondary)] transition-colors cursor-pointer disabled:opacity-50"
            aria-label="Refresh architecture"
            title="Refresh architecture"
          >
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
          </button>
          <button
            onClick={startAnalysis}
            disabled={
              loading || !snapshotId || ["QUEUED", "RUNNING"].includes(status)
            }
            className="flex items-center gap-2 rounded-[var(--radius-md)] bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] px-3.5 py-1.5 text-xs font-semibold text-white transition-colors cursor-pointer disabled:opacity-50 shadow-sm"
          >
            <Play size={13} fill="currentColor" />
            {analysis ? "Re-analyze" : "Analyze architecture"}
          </button>
        </div>
      </header>

      {status && (
        <div
          className={`mb-4 inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-mono ${
            status === "FAILED"
              ? "border-[var(--color-danger)]/30 bg-[var(--color-danger)]/10 text-[var(--color-danger)]"
              : status === "SUCCESS"
                ? "border-[var(--color-success)]/30 bg-[var(--color-success)]/10 text-[var(--color-success)]"
                : "border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-secondary)]"
          }`}
        >
          <CircleDot
            size={12}
            className={status === "RUNNING" ? "animate-pulse" : ""}
          />
          <span className="font-medium">{STATUS_COPY[status] || status}</span>
          {job?.progress != null && status !== "SUCCESS"
            ? ` · ${job.progress}%`
            : ""}
        </div>
      )}
      {error && (
        <div className="mb-4 flex items-center gap-2 rounded-[var(--radius-md)] border border-[var(--color-danger)]/30 bg-[var(--color-danger)]/10 p-3 text-xs text-[var(--color-danger)]">
          <AlertTriangle size={15} className="shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {!analysis && !loading && (
        <div className="rounded-[var(--radius-lg)] border border-dashed border-[var(--color-border)] bg-[var(--color-surface)] p-10 text-center">
          <Network
            className="mx-auto mb-3 text-[var(--color-primary)]"
            size={32}
          />
          <h2 className="text-sm font-semibold text-[var(--color-text)]">
            Architecture map is not available yet
          </h2>
          <p className="mx-auto mt-1 max-w-lg text-xs text-[var(--color-text-secondary)]">
            Analyze this snapshot to discover modules, dependencies,
            request/screen flows, and control-flow graphs for each function.
          </p>
        </div>
      )}

      {analysis && (
        <>
          <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            {[
              ["Source files", analysis.summary.totalFiles],
              ["Functions", analysis.summary.totalFunctions],
              ["Exports", analysis.summary.exportedFunctionCount],
              ["Dependencies", analysis.graph.edges.length],
              [
                "External packages",
                analysis.summary.externalDependencies.length,
              ],
            ].map(([label, value]) => (
              <div
                className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3.5 transition-colors"
                key={label}
              >
                <div className="text-xs font-medium text-[var(--color-text-secondary)]">
                  {label}
                </div>
                <div className="mt-1 text-2xl font-bold font-mono text-[var(--color-text)]">
                  {value}
                </div>
              </div>
            ))}
          </div>

          <div className="mb-4 flex flex-wrap items-center gap-2 border-b border-[var(--color-border)] pb-3">
            {[
              { id: "map", label: "Module map", icon: Network },
              { id: "flows", label: "Feature flows", icon: Workflow },
              { id: "algorithms", label: "Algorithms", icon: GitBranch },
            ].map((item) => {
              const Icon = item.icon;
              const isActive = mode === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => setMode(item.id)}
                  className={`flex items-center gap-2 rounded-[var(--radius-md)] px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer ${
                    isActive
                      ? "bg-[var(--color-primary)]/10 text-[var(--color-primary)] border border-[var(--color-primary)]/30 font-semibold"
                      : "text-[var(--color-text-secondary)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-secondary)]"
                  }`}
                >
                  <Icon size={14} />
                  {item.label}
                </button>
              );
            })}
            {mode === "map" && (
              <select
                aria-label="Filter modules by role"
                value={roleFilter}
                onChange={(event) => setRoleFilter(event.target.value)}
                className="ml-auto rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)] px-2.5 py-1.5 text-xs focus:border-[var(--color-primary)] outline-none"
              >
                <option value="">All roles</option>
                {roles.map((role) => (
                  <option value={role} key={role}>
                    {role}
                  </option>
                ))}
              </select>
            )}
          </div>

          {mode === "map" && (
            <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
              <ArchitectureMap
                analysis={analysis}
                selectedNodeId={selectedNodeId}
                onSelectNode={setSelectedNodeId}
                roleFilter={roleFilter}
              />
              <aside className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 flex flex-col">
                <h2 className="mb-3 text-xs font-bold uppercase tracking-wider text-[var(--color-text)]">
                  Module inspector
                </h2>
                {selectedNode ? (
                  <>
                    <div className="mb-2 flex items-center gap-2">
                      <span
                        className="h-2 w-2 rounded-full flex-shrink-0"
                        style={{
                          background:
                            ROLE_COLORS[selectedNode.role] ||
                            ROLE_COLORS.unknown,
                        }}
                      />
                      <span className="rounded-[var(--radius-sm)] bg-[var(--color-surface-secondary)] border border-[var(--color-border)] px-2 py-0.5 text-xs font-mono text-[var(--color-text-secondary)]">
                        {selectedNode.role}
                      </span>
                    </div>
                    <p className="break-all font-mono text-xs font-semibold text-[var(--color-text)]">
                      {selectedNode.relativePath}
                    </p>
                    <p className="mt-2 text-xs text-[var(--color-text-secondary)]">
                      {selectedNode.functions.length} function(s),{" "}
                      {selectedNode.imports.length} direct dependency(ies),{" "}
                      {selectedNode.importedBy.length} dependent(s).
                    </p>
                    <div className="mt-4 pt-3 border-t border-[var(--color-border)]">
                      <div className="mb-1 text-xs font-semibold text-[var(--color-text)]">
                        Exports
                      </div>
                      {selectedNode.functions.filter((item) => item.exported)
                        .length === 0 ? (
                        <p className="text-xs text-[var(--color-text-muted)] italic">
                          No exported functions
                        </p>
                      ) : (
                        selectedNode.functions
                          .filter((item) => item.exported)
                          .slice(0, 6)
                          .map((item) => (
                            <button
                              onClick={() => {
                                setSelectedFunctionId(item.id);
                                setMode("algorithms");
                              }}
                              className="block py-1 font-mono text-xs text-[var(--color-primary)] hover:underline text-left cursor-pointer"
                              key={item.id}
                            >
                              {item.name}
                            </button>
                          ))
                      )}
                    </div>
                  </>
                ) : (
                  <p className="text-xs text-[var(--color-text-muted)] italic">
                    Select a module on the map to inspect.
                  </p>
                )}
              </aside>
            </div>
          )}

          {mode === "flows" && (
            <div className="grid gap-4 lg:grid-cols-2">
              {analysis.architecture.flows.length ? (
                analysis.architecture.flows.map((flow) => (
                  <article
                    className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4"
                    key={flow.id}
                  >
                    <div className="mb-2 flex items-center gap-2 text-[var(--color-primary)]">
                      <Route size={16} />
                      <h2 className="font-semibold text-sm text-[var(--color-text)]">
                        {flow.title}
                      </h2>
                    </div>
                    <p className="mb-3 text-xs text-[var(--color-text-secondary)] leading-relaxed">
                      {flow.summary}
                    </p>
                    <ol className="space-y-2">
                      {flow.files.map((file, index) => (
                        <li
                          className="flex items-center gap-2 text-xs"
                          key={file}
                        >
                          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--color-surface-secondary)] border border-[var(--color-border)] font-mono text-[11px] text-[var(--color-text-secondary)]">
                            {index + 1}
                          </span>
                          <ChevronRight
                            size={12}
                            className="text-[var(--color-text-muted)]"
                          />
                          <button
                            onClick={() => {
                              const node = analysis.graph.nodes.find(
                                (item) => item.relativePath === file,
                              );
                              if (node) {
                                setSelectedNodeId(node.id);
                                setMode("map");
                              }
                            }}
                            className="font-mono text-xs text-[var(--color-text)] hover:text-[var(--color-primary)] transition-colors cursor-pointer text-left"
                          >
                            {file}
                          </button>
                        </li>
                      ))}
                    </ol>
                  </article>
                ))
              ) : (
                <p className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 text-xs text-[var(--color-text-secondary)]">
                  No static entry flow was detected. Files named main, index, or
                  App and route/page modules are used as flow entry points.
                </p>
              )}
            </div>
          )}

          {mode === "algorithms" && (
            <div className="grid gap-4 xl:grid-cols-[260px_minmax(0,1fr)]">
              <div className="max-h-[460px] overflow-auto rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-2 custom-scrollbar">
                {analysis.functions.map((item) => {
                  const isCur = selectedFunctionId === item.id;
                  return (
                    <button
                      key={item.id}
                      onClick={() => setSelectedFunctionId(item.id)}
                      className={`block w-full rounded-[var(--radius-sm)] px-2.5 py-2 text-left transition-colors cursor-pointer ${
                        isCur
                          ? "bg-[var(--color-primary)]/10 text-[var(--color-primary)] font-medium border border-[var(--color-primary)]/30"
                          : "hover:bg-[var(--color-surface-secondary)] text-[var(--color-text)] border border-transparent"
                      }`}
                    >
                      <span
                        className={`block truncate font-mono text-xs ${isCur ? "text-[var(--color-primary)] font-semibold" : "text-[var(--color-text)]"}`}
                      >
                        {item.label || item.name}
                      </span>
                      <span className="block truncate text-[10px] text-[var(--color-text-muted)] mt-0.5 font-mono">
                        {item.filePath}:{item.startLine}
                      </span>
                    </button>
                  );
                })}
              </div>
              <div className="overflow-auto rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
                <h2 className="mb-1 text-sm font-semibold text-[var(--color-text)]">
                  {selectedFunction?.label ||
                    selectedFunction?.name ||
                    "Function control flow"}
                </h2>
                <p className="mb-4 text-xs text-[var(--color-text-secondary)]">
                  A static control-flow graph: conditions, loops, returns, and
                  statements.
                </p>
                <ControlFlowDiagram functionRecord={selectedFunction} />
              </div>
            </div>
          )}

          <div className="mt-5 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-secondary)] p-4">
            <div className="mb-1.5 flex items-center gap-2 text-xs font-bold text-[var(--color-text)]">
              <CheckCircle2 size={15} className="text-[var(--color-success)]" />
              <span>Onboarding summary</span>
            </div>
            <p className="text-xs text-[var(--color-text)] leading-relaxed">
              {analysis.architecture.onboarding.summary}
            </p>
            <p className="mt-2 text-xs text-[var(--color-text-secondary)] font-mono">
              Start here:{" "}
              {analysis.architecture.onboarding.startHere.join(" → ") ||
                "No conventional entry point detected."}
            </p>
            {analysis.architecture.onboarding.disclaimer && (
              <p className="mt-2 text-[11px] text-[var(--color-text-muted)] italic">
                {analysis.architecture.onboarding.disclaimer}
              </p>
            )}
          </div>
        </>
      )}
    </section>
  );
}
