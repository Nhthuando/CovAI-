import { Plus, FolderPlus } from "lucide-react";

export function AddProjectDashedCard({ onAddProject, className = "" }) {
  return (
    <button
      type="button"
      onClick={onAddProject}
      className={`rounded-[var(--radius-lg)] border-2 border-dashed border-[var(--ud-border)] hover:border-[var(--color-primary)] hover:bg-[var(--ud-surface-2)]/40 p-6 flex flex-col items-center justify-center text-center transition-all cursor-pointer min-h-[300px] group ${className}`}
    >
      <div className="w-10 h-10 rounded-full bg-[var(--ud-surface-2)] border border-[var(--ud-border)] group-hover:border-[var(--color-primary)] flex items-center justify-center text-[var(--ud-text-muted)] group-hover:text-[var(--color-primary)] transition-colors mb-3">
        <Plus size={18} />
      </div>

      <div className="text-sm font-semibold text-[var(--ud-text)] group-hover:text-[var(--color-primary)] transition-colors">
        Import or Upload Project
      </div>

      <p className="text-xs text-[var(--ud-text-muted)] mt-1.5 max-w-[200px] leading-relaxed">
        Upload a ZIP archive or connect a GitHub repository to analyze multi-tier quality.
      </p>

      <span className="mt-4 px-2.5 py-1 rounded text-xs font-mono font-medium text-[var(--ud-text)] bg-[var(--ud-surface-2)] border border-[var(--ud-border)] group-hover:border-[var(--color-primary)]">
        + Add Workspace
      </span>
    </button>
  );
}

export default AddProjectDashedCard;

