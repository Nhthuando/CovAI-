import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Download, FileText, Braces, FolderArchive, X, Loader2 } from "lucide-react";
import Button from "../common/Button";
import { getProjectSnapshotsApi } from "../../services/project.service";
import { downloadProjectExportApi } from "../../services/export.service";
import { useToast } from "./ToastContext";

const formats = [
  { id: "pdf", label: "Analysis report", extension: "PDF", icon: FileText, description: "A formatted report with coverage, quality, test results and analysis details. Ready to share or print." },
  { id: "json", label: "Analysis data", extension: "JSON", icon: Braces, description: "Complete structured results, including coverage functions, control-flow graphs and test history." },
  { id: "zip", label: "Project source", extension: "ZIP", icon: FolderArchive, description: "Source files and tests from this snapshot. Dependencies, caches and credential files are excluded." },
];

export default function ProjectExportDialog({ project, initialSnapshotId, onClose }) {
  const dialogRef = useRef(null);
  const requestRef = useRef(null);
  const initialSnapshotRef = useRef(initialSnapshotId);
  const { showToast } = useToast();
  const [snapshots, setSnapshots] = useState([]);
  const [snapshotId, setSnapshotId] = useState("");
  const [format, setFormat] = useState("pdf");
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);

  useEffect(() => {
    const trigger = document.activeElement;
    const dialog = dialogRef.current;
    dialog.showModal();
    return () => {
      requestRef.current?.abort();
      dialog.close();
      trigger?.focus();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    getProjectSnapshotsApi(project.id).then((response) => {
      if (cancelled) return;
      const rows = response.data || [];
      setSnapshots(rows);
      setSnapshotId(rows.some((row) => row.id === initialSnapshotRef.current) ? initialSnapshotRef.current : rows[0]?.id || "");
      if (!rows.length) setError("No snapshots are available yet. Import a project before exporting.");
    }).catch((err) => { if (!cancelled) setError(err.message || "Could not load snapshots."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [project.id, reload]);

  const handleExport = async (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (requestRef.current || !snapshotId || loading) return;
    setExporting(true); setError("");
    const controller = new AbortController();
    requestRef.current = controller;
    try {
      const filename = await downloadProjectExportApi(project.id, { snapshotId, format, signal: controller.signal });
      showToast({ type: "success", title: "Export downloaded", message: filename });
      onClose();
    } catch (err) {
      if (err.name !== "AbortError" && !controller.signal.aborted) setError(err instanceof TypeError ? "Connection interrupted while preparing the download. Please try again." : err.message);
    } finally {
      if (requestRef.current === controller) requestRef.current = null;
      if (!controller.signal.aborted) setExporting(false);
    }
  };

  return createPortal(
    <dialog
      ref={dialogRef}
      aria-labelledby="project-export-title"
      aria-describedby="project-export-description"
      onCancel={(event) => { event.preventDefault(); onClose(); }}
      onKeyDown={(event) => {
        if (event.key !== "Tab") return;
        const controls = [...dialogRef.current.querySelectorAll("button, input, select, [href], [tabindex]")]
          .filter((element) => !element.matches(":disabled") && element.tabIndex >= 0);
        const first = controls[0];
        const last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }}
      onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}
      className="m-auto w-[calc(100%-32px)] max-w-[560px] max-h-[calc(100dvh-40px)] overflow-y-auto rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text)] p-0 shadow-xl backdrop:bg-black/50"
    >
      <form onSubmit={handleExport} className="p-5 sm:p-7">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 id="project-export-title" className="text-lg font-semibold">Export project</h2>
            <p className="mt-1 text-sm text-[var(--color-text-secondary)] truncate" title={project.name}>{project.name}</p>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close export dialog"><X size={17} /></Button>
        </div>
        <p id="project-export-description" className="mt-4 text-xs leading-relaxed text-[var(--color-text-muted)]">
          Choose a snapshot and download format. Reports use its saved analysis results.
        </p>
        <label htmlFor="export-snapshot" className="block mt-5 mb-2 text-xs font-medium">Snapshot</label>
        <select
          id="export-snapshot"
          value={snapshotId}
          onChange={(event) => setSnapshotId(event.target.value)}
          disabled={loading || exporting || !snapshots.length}
          className="w-full h-10 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-xs focus-visible:outline-2 focus-visible:outline-[var(--color-focus)] disabled:opacity-60"
        >
          {!snapshots.length && <option value="">{loading ? "Loading snapshots..." : "No snapshots available"}</option>}
          {snapshots.map((snapshot) => (
            <option key={snapshot.id} value={snapshot.id}>
              {snapshot.label || snapshot.id}{snapshot.isCurrent ? " (Latest)" : ""} - {new Date(snapshot.createdAt).toLocaleString()}
            </option>
          ))}
        </select>
        <fieldset disabled={exporting} className="mt-5 space-y-2">
          <legend className="mb-2 text-xs font-medium">Download format</legend>
          {formats.map(({ id, label, extension, icon: Icon, description }) => (
            <label key={id} className={`flex items-start gap-3 p-3.5 rounded-[var(--radius-md)] border cursor-pointer transition-colors ${format === id ? "border-[var(--color-primary)] bg-[var(--color-surface)]" : "border-[var(--color-border)] hover:bg-[var(--color-surface)]"}`}>
              <input type="radio" name="export-format" value={id} checked={format === id} onChange={() => setFormat(id)} className="mt-1 shrink-0 accent-[var(--color-primary)]" />
              <Icon size={18} className="mt-0.5 shrink-0 text-[var(--color-text-secondary)]" />
              <span className="flex-1 min-w-0">
                <span className="flex items-center justify-between gap-2 text-sm font-medium">
                  {label}<span className="font-mono text-[10px] text-[var(--color-text-muted)]">.{extension.toLowerCase()}</span>
                </span>
                <span className="block mt-1 text-xs leading-relaxed text-[var(--color-text-muted)]">{description}</span>
              </span>
            </label>
          ))}
        </fieldset>
        {format === "pdf" && <p className="mt-3 text-[11px] leading-relaxed text-[var(--color-text-muted)]">A4 layout, Vietnamese font support, snapshot metadata and numbered pages. Missing analysis is clearly labeled.</p>}
        {error && <div role="alert" className="mt-4 text-xs leading-relaxed text-[var(--color-danger)]">{error}
          {!snapshots.length && !loading && <button type="button" onClick={() => { setError(""); setLoading(true); setReload((value) => value + 1); }} className="ml-2 underline cursor-pointer">Retry</button>}
        </div>}
        <div role="status" aria-live="polite" className="mt-4 text-xs text-[var(--color-text-muted)]">
          {exporting && <span className="flex items-center gap-2"><Loader2 size={13} className="animate-spin" />Preparing your {format.toUpperCase()} download...</span>}
        </div>
        <div className="flex justify-end gap-2 mt-5 pt-4 border-t border-[var(--color-border)]">
          <Button variant="secondary" size="sm" onClick={onClose}>{exporting ? "Cancel download" : "Cancel"}</Button>
          <Button type="submit" size="sm" icon={Download} loading={exporting} disabled={loading || !snapshotId}>
            Download {format.toUpperCase()}
          </Button>
        </div>
      </form>
    </dialog>, document.body,
  );
}
