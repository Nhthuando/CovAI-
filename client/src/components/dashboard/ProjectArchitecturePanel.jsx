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
  route: "#60a5fa", controller: "#38bdf8", service: "#a78bfa", middleware: "#f59e0b",
  component: "#34d399", page: "#2dd4bf", model: "#f472b6", utility: "#94a3b8",
  config: "#fb7185", validator: "#facc15", test: "#64748b", unknown: "#94a3b8",
};

const STATUS_COPY = {
  QUEUED: "Queued", RUNNING: "Mapping project", SUCCESS: "Completed", FAILED: "Failed", CANCELED: "Canceled",
};

const compactName = (value, limit = 24) => value.length > limit ? `${value.slice(0, limit - 1)}…` : value;

function ArchitectureMap({ analysis, selectedNodeId, onSelectNode, roleFilter }) {
  const graph = analysis?.graph || { nodes: [], edges: [] };
  const layers = analysis?.architecture?.layers || [];
  const visibleLayers = layers
    .map((layer) => ({ ...layer, fileIds: layer.fileIds.filter((id) => {
      const node = graph.nodes.find((item) => item.id === id);
      return !roleFilter || node?.role === roleFilter;
    }) }))
    .filter((layer) => layer.fileIds.length > 0);

  const layout = useMemo(() => {
    const positions = new Map();
    const rendered = [];
    const columnWidth = Math.max(210, Math.floor(920 / Math.max(visibleLayers.length, 1)));
    visibleLayers.forEach((layer, layerIndex) => {
      layer.fileIds.slice(0, 7).forEach((id, nodeIndex) => {
        const node = graph.nodes.find((item) => item.id === id);
        if (!node) return;
        const point = { x: 25 + layerIndex * columnWidth, y: 75 + nodeIndex * 55 };
        positions.set(id, point);
        rendered.push({ ...node, ...point });
      });
    });
    return { positions, rendered, width: Math.max(920, visibleLayers.length * columnWidth + 30) };
  }, [graph.nodes, visibleLayers]);

  const visibleEdges = graph.edges.filter((edge) => layout.positions.has(edge.from) && layout.positions.has(edge.to));
  if (layout.rendered.length === 0) return <p className="p-6 text-sm text-slate-400">No modules match the selected filter.</p>;

  return (
    <div className="overflow-auto rounded-lg border border-slate-800 bg-[#0d1117]">
      <svg viewBox={`0 0 ${layout.width} 500`} className="min-w-[920px] w-full" role="img" aria-label="Project module dependency diagram">
        <defs>
          <marker id="architecture-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#475569" />
          </marker>
        </defs>
        {visibleLayers.map((layer, index) => (
          <g key={layer.id}>
            <rect x={13 + index * Math.max(210, Math.floor(920 / Math.max(visibleLayers.length, 1)))} y="18" width="190" height="455" rx="10" fill="rgba(30,41,59,.38)" stroke="#334155" />
            <text x={28 + index * Math.max(210, Math.floor(920 / Math.max(visibleLayers.length, 1)))} y="46" fill="#cbd5e1" fontSize="13" fontWeight="600">{layer.label}</text>
            <text x={28 + index * Math.max(210, Math.floor(920 / Math.max(visibleLayers.length, 1)))} y="63" fill="#64748b" fontSize="10">{layer.fileIds.length} module{layer.fileIds.length === 1 ? "" : "s"}</text>
          </g>
        ))}
        {visibleEdges.map((edge) => {
          const from = layout.positions.get(edge.from);
          const to = layout.positions.get(edge.to);
          return <line key={edge.id} x1={from.x + 172} y1={from.y + 18} x2={to.x} y2={to.y + 18} stroke="#475569" strokeWidth="1.2" markerEnd="url(#architecture-arrow)" />;
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
              onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") onSelectNode(node.id); }}
              className="cursor-pointer outline-none"
            >
              <rect x={node.x} y={node.y} width="172" height="36" rx="6" fill={selected ? "#312e81" : "#172033"} stroke={selected ? "#a78bfa" : color} strokeWidth={selected ? "2" : "1"} />
              <circle cx={node.x + 12} cy={node.y + 18} r="4" fill={color} />
              <text x={node.x + 22} y={node.y + 16} fill="#e2e8f0" fontSize="10.5">{compactName(node.relativePath)}</text>
              <text x={node.x + 22} y={node.y + 28} fill="#94a3b8" fontSize="9">{node.role} · {node.functions.length} function{node.functions.length === 1 ? "" : "s"}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function ControlFlowDiagram({ functionRecord }) {
  const graph = functionRecord?.controlFlow;
  if (!graph?.nodes?.length) return <p className="text-sm text-slate-400">Select a function to see its algorithm/control-flow graph.</p>;
  const positions = new Map(graph.nodes.map((node, index) => [node.id, { x: 28 + (index % 5) * 150, y: 30 + Math.floor(index / 5) * 78 }]));
  return (
    <svg viewBox="0 0 780 260" className="w-full min-w-[640px]" role="img" aria-label={`Control flow diagram for ${functionRecord.name}`}>
      <defs><marker id="cfg-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0 L10 5 L0 10 z" fill="#64748b" /></marker></defs>
      {graph.edges.map((edge, index) => {
        const from = positions.get(edge.from); const to = positions.get(edge.to);
        if (!from || !to) return null;
        return <line key={`${edge.from}-${edge.to}-${index}`} x1={from.x + 108} y1={from.y + 20} x2={to.x} y2={to.y + 20} stroke="#64748b" markerEnd="url(#cfg-arrow)" />;
      })}
      {graph.nodes.map((node) => {
        const point = positions.get(node.id);
        const color = node.type === "condition" ? "#f59e0b" : node.type === "return" ? "#34d399" : "#60a5fa";
        return <g key={node.id}><rect x={point.x} y={point.y} width="108" height="40" rx="6" fill="#172033" stroke={color} /><text x={point.x + 9} y={point.y + 17} fill="#e2e8f0" fontSize="10">{node.type}</text><text x={point.x + 9} y={point.y + 31} fill="#94a3b8" fontSize="9">line {node.line ?? "—"}</text></g>;
      })}
    </svg>
  );
}

export default function ProjectArchitecturePanel({ projectId }) {
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
      setSnapshotId((current) => nextSnapshots.some((item) => item.id === current) ? current : (nextSnapshots[0]?.id || ""));
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
      const response = await getProjectStructureAnalysisApi(projectId, snapshotId);
      setAnalysis(response.data);
      setSelectedNodeId((current) => current || response.data?.graph?.nodes?.[0]?.id || "");
      setSelectedFunctionId((current) => current || response.data?.functions?.[0]?.id || "");
      setError("");
    } catch (requestError) {
      if (/Architecture analysis not found/i.test(requestError.message)) setAnalysis(null);
      else setError(requestError.message || "Could not load architecture analysis.");
    } finally {
      setLoading(false);
    }
  }, [projectId, snapshotId]);

  useEffect(() => { loadSnapshots(); }, [loadSnapshots]);
  useEffect(() => { loadAnalysis(); }, [loadAnalysis]);

  useEffect(() => {
    if (!job || !["QUEUED", "RUNNING"].includes(job.status) || !projectId) return undefined;
    const poll = async () => {
      try {
        const response = await getProjectJobsApi(projectId);
        const updated = (response.jobs || []).find((item) => item.id === job.id);
        if (!updated) return;
        setJob(updated);
        if (updated.status === "SUCCESS") loadAnalysis();
        if (updated.status === "FAILED") setError(updated.errorMessage || "Architecture analysis failed.");
      } catch { /* Job Queue remains available if optional polling fails. */ }
    };
    poll();
    const timer = window.setInterval(poll, 2500);
    return () => window.clearInterval(timer);
  }, [job, loadAnalysis, projectId]);

  const startAnalysis = async () => {
    if (!projectId) return;
    setLoading(true);
    try {
      const response = await runProjectStructureAnalysisApi(projectId, snapshotId || undefined);
      setJob(response.job || response.data?.job || null);
      setError("");
    } catch (requestError) {
      setError(requestError.message || "Could not start architecture analysis.");
    } finally {
      setLoading(false);
    }
  };

  const selectedNode = analysis?.graph?.nodes?.find((node) => node.id === selectedNodeId);
  const selectedFunction = analysis?.functions?.find((item) => item.id === selectedFunctionId);
  const roles = [...new Set(analysis?.graph?.nodes?.map((node) => node.role) || [])].sort();
  const status = job?.status || (analysis ? "SUCCESS" : null);

  if (!projectId) return <section className="p-8 text-sm text-slate-400">Select a project to explore its architecture.</section>;

  return (
    <section className="h-full overflow-y-auto p-5 text-slate-200" style={{ background: "var(--ide-bg)" }}>
      <header className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div><div className="mb-1 flex items-center gap-2 text-xs text-slate-400"><Network size={14} /> Project / Architecture</div><h1 className="text-2xl font-semibold">Understand this project at a glance</h1><p className="mt-1 max-w-2xl text-sm text-slate-400">Static analysis maps source modules, dependencies, entry flows, and function algorithms without executing repository code.</p></div>
        <div className="flex flex-wrap items-center gap-2">
          <select aria-label="Architecture snapshot" value={snapshotId} onChange={(event) => setSnapshotId(event.target.value)} className="rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm">
            {snapshots.map((snapshot) => <option value={snapshot.id} key={snapshot.id}>{snapshot.commitSha || snapshot.checksum || snapshot.id}</option>)}
          </select>
          <button onClick={loadAnalysis} disabled={loading} className="rounded border border-slate-700 p-2 text-slate-300 hover:bg-slate-800 disabled:opacity-50" aria-label="Refresh architecture"><RefreshCw size={16} /></button>
          <button onClick={startAnalysis} disabled={loading || !snapshotId || ["QUEUED", "RUNNING"].includes(status)} className="flex items-center gap-2 rounded bg-violet-600 px-3 py-2 text-sm font-medium text-white hover:bg-violet-500 disabled:opacity-50"><Play size={15} />{analysis ? "Re-analyze" : "Analyze architecture"}</button>
        </div>
      </header>

      {status && <div className={`mb-4 inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs ${status === "FAILED" ? "border-red-800 bg-red-950/30 text-red-200" : "border-slate-700 bg-slate-900 text-slate-300"}`}><CircleDot size={13} />{STATUS_COPY[status] || status}{job?.progress != null && status !== "SUCCESS" ? ` · ${job.progress}%` : ""}</div>}
      {error && <div className="mb-4 flex gap-2 rounded border border-amber-700 bg-amber-950/30 p-3 text-sm text-amber-200"><AlertTriangle size={17} className="shrink-0" />{error}</div>}

      {!analysis && !loading && (
        <div className="rounded-xl border border-dashed border-slate-700 bg-slate-900/50 p-8 text-center"><Network className="mx-auto mb-3 text-violet-300" size={32} /><h2 className="font-medium">Architecture map is not available yet</h2><p className="mx-auto mt-2 max-w-lg text-sm text-slate-400">Analyze this snapshot to discover modules, dependencies, request/screen flows, and control-flow graphs for each function.</p></div>
      )}

      {analysis && <>
        <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          {[["Source files", analysis.summary.totalFiles], ["Functions", analysis.summary.totalFunctions], ["Exports", analysis.summary.exportedFunctionCount], ["Dependencies", analysis.graph.edges.length], ["External packages", analysis.summary.externalDependencies.length]].map(([label, value]) => <div className="rounded-lg border border-slate-800 bg-slate-900 p-3" key={label}><div className="text-xs text-slate-400">{label}</div><div className="mt-1 text-xl font-semibold">{value}</div></div>)}
        </div>
        <div className="mb-4 flex flex-wrap items-center gap-2 border-b border-slate-800 pb-3">
          {[{ id: "map", label: "Module map", icon: Network }, { id: "flows", label: "Feature flows", icon: Workflow }, { id: "algorithms", label: "Algorithms", icon: GitBranch }].map((item) => { const Icon = item.icon; return <button key={item.id} onClick={() => setMode(item.id)} className={`flex items-center gap-2 rounded px-3 py-2 text-sm ${mode === item.id ? "bg-violet-500/15 text-violet-200" : "text-slate-400 hover:bg-slate-800"}`}><Icon size={15} />{item.label}</button>; })}
          {mode === "map" && <select aria-label="Filter modules by role" value={roleFilter} onChange={(event) => setRoleFilter(event.target.value)} className="ml-auto rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-xs"><option value="">All roles</option>{roles.map((role) => <option value={role} key={role}>{role}</option>)}</select>}
        </div>
        {mode === "map" && <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_290px]"><ArchitectureMap analysis={analysis} selectedNodeId={selectedNodeId} onSelectNode={setSelectedNodeId} roleFilter={roleFilter} /><aside className="rounded-lg border border-slate-800 bg-slate-900 p-4"><h2 className="mb-3 text-sm font-semibold">Module inspector</h2>{selectedNode ? <><div className="mb-2 flex items-center gap-2"><span className="h-2 w-2 rounded-full" style={{ background: ROLE_COLORS[selectedNode.role] || ROLE_COLORS.unknown }} /><span className="rounded bg-slate-800 px-2 py-0.5 text-xs">{selectedNode.role}</span></div><p className="break-all font-mono text-xs text-slate-200">{selectedNode.relativePath}</p><p className="mt-3 text-xs text-slate-400">{selectedNode.functions.length} function(s), {selectedNode.imports.length} direct dependency(ies), {selectedNode.importedBy.length} dependent(s).</p><div className="mt-4"><div className="mb-1 text-xs font-medium text-slate-300">Exports</div>{selectedNode.functions.filter((item) => item.exported).slice(0, 6).map((item) => <button onClick={() => { setSelectedFunctionId(item.id); setMode("algorithms"); }} className="block py-1 font-mono text-xs text-violet-300 hover:text-violet-200" key={item.id}>{item.name}</button>)}</div></> : <p className="text-sm text-slate-400">Select a module on the map.</p>}</aside></div>}
        {mode === "flows" && <div className="grid gap-4 lg:grid-cols-2">{analysis.architecture.flows.length ? analysis.architecture.flows.map((flow) => <article className="rounded-lg border border-slate-800 bg-slate-900 p-4" key={flow.id}><div className="mb-2 flex items-center gap-2 text-violet-200"><Route size={16} /><h2 className="font-medium">{flow.title}</h2></div><p className="mb-3 text-sm text-slate-400">{flow.summary}</p><ol className="space-y-2">{flow.files.map((file, index) => <li className="flex items-center gap-2 text-xs" key={file}><span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-800 text-slate-300">{index + 1}</span><ChevronRight size={13} className="text-slate-600" /><button onClick={() => { const node = analysis.graph.nodes.find((item) => item.relativePath === file); if (node) { setSelectedNodeId(node.id); setMode("map"); } }} className="font-mono text-slate-300 hover:text-violet-200">{file}</button></li>)}</ol></article>) : <p className="rounded border border-slate-800 bg-slate-900 p-4 text-sm text-slate-400">No static entry flow was detected. Files named main, index, or App and route/page modules are used as flow entry points.</p>}</div>}
        {mode === "algorithms" && <div className="grid gap-4 xl:grid-cols-[250px_minmax(0,1fr)]"><div className="max-h-[420px] overflow-auto rounded-lg border border-slate-800 bg-slate-900 p-2">{analysis.functions.map((item) => <button key={item.id} onClick={() => setSelectedFunctionId(item.id)} className={`block w-full rounded px-3 py-2 text-left ${selectedFunctionId === item.id ? "bg-violet-500/15" : "hover:bg-slate-800"}`}><span className="block truncate font-mono text-xs text-slate-200">{item.label || item.name}</span><span className="block truncate text-[11px] text-slate-500">{item.filePath}:{item.startLine}</span></button>)}</div><div className="overflow-auto rounded-lg border border-slate-800 bg-[#0d1117] p-4"><h2 className="mb-1 font-medium">{selectedFunction?.label || selectedFunction?.name || "Function control flow"}</h2><p className="mb-4 text-xs text-slate-400">A static control-flow graph: conditions, loops, returns, and statements.</p><ControlFlowDiagram functionRecord={selectedFunction} /></div></div>}
        <div className="mt-5 rounded-lg border border-violet-900/60 bg-violet-950/20 p-4"><div className="mb-1 flex items-center gap-2 text-sm font-medium text-violet-100"><CheckCircle2 size={16} /> Onboarding summary</div><p className="text-sm text-slate-300">{analysis.architecture.onboarding.summary}</p><p className="mt-2 text-xs text-slate-400">Start here: {analysis.architecture.onboarding.startHere.join(" → ") || "No conventional entry point detected."}</p><p className="mt-2 text-xs text-slate-500">{analysis.architecture.onboarding.disclaimer}</p></div>
      </>}
    </section>
  );
}
