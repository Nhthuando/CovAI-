import { useEffect, useMemo, useState } from "react";
import { getProjectSnapshotsApi, getProjectTreeApi } from "../../services/project.service";

const flattenFiles = (nodes, output = []) => {
  nodes.forEach((node) => {
    if (node.type === "file") output.push(node);
    if (node.children) flattenFiles(node.children, output);
  });
  return output;
};

export default function ProjectArchitecturePanel({ projectId }) {
  const [snapshots, setSnapshots] = useState([]);
  const [snapshotId, setSnapshotId] = useState("");
  const [tree, setTree] = useState([]);
  const [error, setError] = useState("");
  const files = useMemo(() => flattenFiles(tree), [tree]);

  useEffect(() => {
    if (!projectId) return undefined;
    let cancelled = false;
    Promise.all([getProjectSnapshotsApi(projectId), getProjectTreeApi(projectId)])
      .then(([snapshotResponse, treeResponse]) => {
        if (cancelled) return;
        const nextSnapshots = snapshotResponse.data || [];
        setSnapshots(nextSnapshots);
        setSnapshotId((current) => current || nextSnapshots[0]?.id || "");
        setTree(treeResponse.data || []);
        setError("");
      })
      .catch((requestError) => { if (!cancelled) setError(requestError.message); });
    return () => { cancelled = true; };
  }, [projectId]);

  if (!projectId) return <section className="p-8 text-sm text-slate-400">Select a project to view its architecture.</section>;

  return (
    <section className="w-full h-full overflow-y-auto p-8 text-slate-200" style={{ background: "var(--ide-bg)" }}>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div><h1 className="text-2xl font-semibold">Project Architecture</h1><p className="text-sm text-slate-400">Snapshot-bound source inventory and hierarchy.</p></div>
        <select aria-label="Architecture snapshot" value={snapshotId} onChange={(event) => setSnapshotId(event.target.value)} className="rounded bg-slate-800 p-2 text-sm">
          {snapshots.map((snapshot) => <option value={snapshot.id} key={snapshot.id}>{snapshot.commitSha || snapshot.checksum || snapshot.id}</option>)}
        </select>
      </div>
      {error && <p className="rounded border border-amber-700 bg-amber-950/30 p-3 text-sm text-amber-200">{error}</p>}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 mb-6">
        {[['Snapshots', snapshots.length], ['Source files', files.length], ['Folders', tree.filter((node) => node.type === 'folder').length]].map(([label, value]) => <div className="rounded border border-slate-700 bg-slate-900 p-3" key={label}><div className="text-xs text-slate-400">{label}</div><div className="text-lg font-semibold">{value}</div></div>)}
      </div>
      <div className="rounded border border-slate-800 bg-slate-900 p-4">
        <h2 className="mb-3 font-medium">Source inventory</h2>
        {files.length === 0 ? <p className="text-sm text-slate-400">No extracted source files are available for this snapshot.</p> : files.map((file) => <div className="flex items-center justify-between border-b border-slate-800 py-2 text-sm last:border-b-0" key={file.id || file.path}><span className="font-mono">{file.path || file.id}</span><span className="text-xs text-slate-400">{file.lang || file.language || file.type}</span></div>)}
      </div>
    </section>
  );
}
