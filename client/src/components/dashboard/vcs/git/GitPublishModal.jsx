import { useState } from "react";
import { createPortal } from "react-dom";
import { Globe, Lock, UploadCloud, X } from "lucide-react";
import Button from "../../../common/Button";
import VcsInlineBanner from "../shared/VcsInlineBanner";
import { validateGithubRepoName } from "../../../../../../shared/gitProtocol.js";

export default function GitPublishModal({
  isOpen,
  defaultName = "",
  defaultBranch = "main",
  loading = false,
  onClose,
  onSubmit,
}) {
  const [name, setName] = useState(() =>
    (defaultName || "covai-project").replace(/[^A-Za-z0-9._-]+/g, "-"),
  );
  const [description, setDescription] = useState("");
  const [isPrivate, setIsPrivate] = useState(true);
  const [branch, setBranch] = useState(defaultBranch || "main");
  const [initialCommitMessage, setInitialCommitMessage] = useState(
    "feat: initial commit from CovAI",
  );
  const [error, setError] = useState("");

  if (!isOpen) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validateGithubRepoName(name)) {
      setError(
        "Repository name may only contain letters, numbers, dots, underscores, and hyphens.",
      );
      return;
    }
    setError("");
    try {
      await onSubmit?.({
        name: name.trim(),
        description: description.trim(),
        isPrivate,
        defaultBranch: branch.trim() || "main",
        initialCommitMessage:
          initialCommitMessage.trim() || "feat: initial commit from CovAI",
      });
    } catch (err) {
      setError(err?.message || "Failed to publish repository to GitHub");
    }
  };

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-[90] flex items-center justify-center p-4 bg-black/75"
      onClick={!loading ? onClose : undefined}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface)] text-[var(--color-text)] shadow-2xl overflow-hidden"
      >
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-[var(--color-border)]">
          <div className="flex items-center gap-2">
            <UploadCloud size={16} className="text-[var(--color-primary)]" />
            <h3 className="text-sm font-semibold">Publish to GitHub</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="p-1 rounded text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-secondary)] cursor-pointer"
          >
            <X size={14} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-3.5 text-xs">
          {error && <VcsInlineBanner tone="danger" title={error} />}

          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wider text-[var(--color-text-muted)] mb-1">
              Repository Name *
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="my-project"
              required
              className="w-full h-9 px-3 rounded-md bg-[var(--color-surface-secondary)] border border-[var(--color-border)] focus:border-[var(--color-primary)] outline-none font-mono text-xs text-[var(--color-text)]"
            />
          </div>

          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wider text-[var(--color-text-muted)] mb-1">
              Description
            </label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional repository description"
              className="w-full h-9 px-3 rounded-md bg-[var(--color-surface-secondary)] border border-[var(--color-border)] focus:border-[var(--color-primary)] outline-none text-xs text-[var(--color-text)]"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-semibold uppercase tracking-wider text-[var(--color-text-muted)] mb-1">
                Visibility
              </label>
              <div className="grid grid-cols-2 gap-1.5">
                <button
                  type="button"
                  onClick={() => setIsPrivate(true)}
                  className={`h-9 px-2.5 rounded-md border flex items-center justify-center gap-1.5 cursor-pointer transition-colors duration-150 ${
                    isPrivate
                      ? "bg-[var(--color-primary)]/12 border-[var(--color-primary)] text-[var(--color-text)] font-semibold"
                      : "bg-[var(--color-surface-secondary)] border-[var(--color-border)] text-[var(--color-text-muted)]"
                  }`}
                >
                  <Lock size={12} />
                  <span>Private</span>
                </button>
                <button
                  type="button"
                  onClick={() => setIsPrivate(false)}
                  className={`h-9 px-2.5 rounded-md border flex items-center justify-center gap-1.5 cursor-pointer transition-colors duration-150 ${
                    !isPrivate
                      ? "bg-[var(--color-primary)]/12 border-[var(--color-primary)] text-[var(--color-text)] font-semibold"
                      : "bg-[var(--color-surface-secondary)] border-[var(--color-border)] text-[var(--color-text-muted)]"
                  }`}
                >
                  <Globe size={12} />
                  <span>Public</span>
                </button>
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-semibold uppercase tracking-wider text-[var(--color-text-muted)] mb-1">
                Default Branch
              </label>
              <input
                type="text"
                value={branch}
                onChange={(e) => setBranch(e.target.value)}
                className="w-full h-9 px-3 rounded-md bg-[var(--color-surface-secondary)] border border-[var(--color-border)] focus:border-[var(--color-primary)] outline-none font-mono text-xs text-[var(--color-text)]"
              />
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wider text-[var(--color-text-muted)] mb-1">
              Initial Commit Message (if no commits yet)
            </label>
            <input
              type="text"
              value={initialCommitMessage}
              onChange={(e) => setInitialCommitMessage(e.target.value)}
              className="w-full h-9 px-3 rounded-md bg-[var(--color-surface-secondary)] border border-[var(--color-border)] focus:border-[var(--color-primary)] outline-none font-mono text-xs text-[var(--color-text)]"
            />
          </div>

          <div className="pt-2 flex items-center justify-end gap-2 border-t border-[var(--color-border)]">
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={loading}
              onClick={onClose}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              variant="primary"
              icon={UploadCloud}
              loading={loading}
            >
              Publish Repository
            </Button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
}
