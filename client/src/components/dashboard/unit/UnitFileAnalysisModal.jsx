import React, { useEffect, useState } from "react";
import { X, GitBranch, Network, Calculator, FlaskConical, ExternalLink, Loader2, Code2 } from "lucide-react";
import { getFileCoverage } from "../../../services/coverage.service.js";
import FileBranchCFGView from "../FileBranchCFGView.jsx";
import FileFunctionCallGraphView from "../FileFunctionCallGraphView.jsx";
import CFGCalculator from "../CFGCalculator.jsx";

export default function UnitFileAnalysisModal({
  isOpen,
  onClose,
  snapshotId,
  file,
  testSuites = [],
  onOpenFile,
  onOpenSimulation,
  onSuggestTestcase,
}) {
  const [subTab, setSubTab] = useState("cfg");
  const [fileCoverage, setFileCoverage] = useState(null);
  const [loading, setLoading] = useState(false);

  const filePath = file?.filePath || "";

  useEffect(() => {
    if (!isOpen || !snapshotId || !filePath) return;
    let cancelled = false;
    setLoading(true);
    getFileCoverage(snapshotId, filePath)
      .then((res) => {
        if (!cancelled) setFileCoverage(res?.data || res || null);
      })
      .catch(() => {
        if (!cancelled) setFileCoverage(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen, snapshotId, filePath]);

  if (!isOpen || !file) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 font-sans">
      <div className="w-full max-w-5xl rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)] overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="px-5 py-3 border-b border-[var(--color-border)] flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-7 h-7 rounded-md bg-[var(--color-surface-secondary)] border border-[var(--color-border)] flex items-center justify-center text-[var(--color-primary)] shrink-0">
              <GitBranch size={15} />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-semibold m-0 truncate">
                Unit Logic & Control-Flow Analysis
              </h3>
              <p className="text-[11px] font-mono text-[var(--color-text-muted)] truncate m-0">
                {filePath}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {onOpenSimulation && (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onOpenSimulation(filePath);
                }}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-[var(--color-border)] bg-[var(--color-surface-secondary)] hover:bg-[var(--color-surface-hover)] text-xs font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-text)] transition-colors cursor-pointer"
              >
                <FlaskConical size={13} className="text-[var(--color-primary)]" />
                <span>Simulation Studio</span>
              </button>
            )}
            {onOpenFile && (
              <button
                type="button"
                onClick={() => onOpenFile(filePath)}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-[var(--color-border)] bg-[var(--color-surface-secondary)] hover:bg-[var(--color-surface-hover)] text-xs font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-text)] transition-colors cursor-pointer"
              >
                <ExternalLink size={12} />
                <span>Open in Editor</span>
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-md text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-secondary)] transition-colors cursor-pointer"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Sub-navigation */}
        <div className="px-5 border-b border-[var(--color-border)] bg-[var(--color-bg)]/40 flex items-center gap-4 text-xs">
          {[
            { id: "cfg", label: "Branch CFG & Paths", icon: GitBranch },
            { id: "callgraph", label: "Function Call Graph", icon: Network },
            { id: "complexity", label: "Cyclomatic Calculator", icon: Calculator },
          ].map((tab) => {
            const Icon = tab.icon;
            const active = subTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setSubTab(tab.id)}
                className={`inline-flex items-center gap-1.5 py-2.5 border-b-2 -mb-px font-medium transition-colors cursor-pointer ${
                  active
                    ? "border-[var(--color-primary)] text-[var(--color-text)] font-semibold"
                    : "border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
                }`}
              >
                <Icon size={13} />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        {/* Body */}
        <div className="p-5 overflow-y-auto flex-1 bg-[var(--color-bg)]">
          {loading && subTab !== "complexity" ? (
            <div className="h-56 flex items-center justify-center gap-2 text-xs text-[var(--color-text-muted)]">
              <Loader2 size={15} className="animate-spin" />
              <span>Loading AST & branch coverage details...</span>
            </div>
          ) : subTab === "cfg" ? (
            <FileBranchCFGView
              filePath={filePath}
              fileCoverage={fileCoverage || file}
              onOpenFile={onOpenFile}
              onSuggestTestcase={onSuggestTestcase}
            />
          ) : subTab === "callgraph" ? (
            <FileFunctionCallGraphView
              filePath={filePath}
              fileCoverage={fileCoverage || file}
              testSuites={testSuites}
              onOpenFile={onOpenFile}
              onSuggestTestcase={onSuggestTestcase}
            />
          ) : (
            <CFGCalculator />
          )}
        </div>
      </div>
    </div>
  );
}
