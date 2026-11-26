import { useCallback, useEffect, useState } from "react";
import {
  CheckCircle2,
  Clock,
  ExternalLink,
  GitPullRequest,
  Plus,
  RefreshCw,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import Button from "../../../common/Button";
import { gitService } from "../../../../services/git.service";
import { formatRelativeTime } from "../../../../services/vcsUiHelpers";

export default function GitPullRequestsPanel({
  projectId,
  repoUrl,
  currentBranch = "main",
  defaultBranch = "main",
  branches = [],
  canRemoteWrite = false,
  disabledReason = "",
  onLog,
  onNotice,
}) {
  const [stateFilter, setStateFilter] = useState("open");
  const [pulls, setPulls] = useState([]);
  const [checks, setChecks] = useState(null);
  const [loading, setLoading] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [head, setHead] = useState(currentBranch || "main");
  const [base, setBase] = useState(defaultBranch || "main");
  const [draft, setDraft] = useState(false);

  const loadData = useCallback(async () => {
    if (!projectId || !repoUrl) return;
    setLoading(true);
    try {
      const [prRes, checkRes] = await Promise.all([
        gitService.listPullRequests(projectId, { state: stateFilter }),
        gitService.getCommitChecks(projectId, "HEAD").catch(() => null),
      ]);
      setPulls(prRes?.data || []);
      setChecks(checkRes?.data || null);
    } catch (err) {
      onNotice?.("error", err?.message || "Failed to load Pull Requests");
    } finally {
      setLoading(false);
    }
  }, [projectId, repoUrl, stateFilter, onNotice]);

  useEffect(() => {
    if (!projectId || !repoUrl) return undefined;
    let active = true;
    Promise.all([
      gitService.listPullRequests(projectId, { state: stateFilter }),
      gitService.getCommitChecks(projectId, "HEAD").catch(() => null),
    ])
      .then(([prRes, checkRes]) => {
        if (!active) return;
        setPulls(prRes?.data || []);
        setChecks(checkRes?.data || null);
      })
      .catch((err) => {
        if (!active) return;
        onNotice?.("error", err?.message || "Failed to load Pull Requests");
      });
    return () => {
      active = false;
    };
  }, [projectId, repoUrl, stateFilter, onNotice]);

  const handleCreatePr = async (e) => {
    e.preventDefault();
    if (!title.trim() || creating) return;
    setCreating(true);
    try {
      const res = await gitService.createPullRequest(projectId, {
        title: title.trim(),
        body,
        head: head.trim(),
        base: base.trim(),
        draft,
      });
      onLog?.(`gh pr create #${res?.data?.number}: ${res?.data?.title}`);
      onNotice?.("success", `Pull Request #${res?.data?.number} created on GitHub`);
      setShowCreate(false);
      setTitle("");
      setBody("");
      setDraft(false);
      await loadData();
    } catch (err) {
      onNotice?.("error", err?.message || "Failed to create Pull Request");
    } finally {
      setCreating(false);
    }
  };

  if (!repoUrl) {
    return (
      <div className="flex flex-col items-center justify-center p-10 text-center border border-dashed border-[var(--color-border)] rounded-lg bg-[var(--color-surface)]">
        <GitPullRequest size={26} className="text-[var(--color-text-muted)] mb-2 opacity-60" />
        <p className="text-sm font-semibold text-[var(--color-text)]">
          Repository is not linked to GitHub
        </p>
        <p className="text-xs text-[var(--color-text-muted)] mt-1 max-w-md">
          Publish this repository to GitHub or configure an origin URL to manage Pull Requests and inspect GitHub Actions CI checks.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* CI Checks Summary Card */}
      {checks && (
        <div className="p-3.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            {checks.overallState === "success" ? (
              <CheckCircle2 size={16} className="text-emerald-400 shrink-0" />
            ) : checks.overallState === "failure" ? (
              <XCircle size={16} className="text-rose-400 shrink-0" />
            ) : (
              <Clock size={16} className="text-amber-400 shrink-0" />
            )}
            <div>
              <div className="text-xs font-semibold text-[var(--color-text)] flex items-center gap-2">
                <span>GitHub CI Checks</span>
                <span className="px-1.5 py-0.5 rounded text-[10px] font-mono uppercase bg-[var(--color-surface-secondary)] border border-[var(--color-border)]">
                  {checks.overallState}
                </span>
              </div>
              <p className="text-[11px] text-[var(--color-text-muted)] font-mono">
                Ref: {checks.ref?.slice(0, 7)} · {checks.totalChecks} check run(s)
              </p>
            </div>
          </div>
          {checks.checkRuns?.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {checks.checkRuns.slice(0, 4).map((run) => (
                <a
                  key={run.id}
                  href={run.htmlUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-mono bg-[var(--color-bg)] border border-[var(--color-border)] hover:border-[var(--color-primary)] text-[var(--color-text-secondary)]"
                >
                  <ShieldCheck size={11} />
                  <span>{run.name}</span>
                  <span className="text-[10px] text-[var(--color-text-muted)]">
                    ({run.conclusion || run.status})
                  </span>
                </a>
              ))}
            </div>
          )}
        </div>
      )}

      {/* PR Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1 p-0.5 rounded-md bg-[var(--color-surface-secondary)] border border-[var(--color-border)]">
          {["open", "closed", "all"].map((st) => (
            <button
              key={st}
              type="button"
              onClick={() => setStateFilter(st)}
              className={`px-2.5 py-1 rounded text-xs font-medium capitalize cursor-pointer transition-colors duration-150 ${
                stateFilter === st
                  ? "bg-[var(--color-surface)] text-[var(--color-text)] border border-[var(--color-border)]"
                  : "text-[var(--color-text-muted)] hover:text-[var(--color-text)] border border-transparent"
              }`}
            >
              {st}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="secondary"
            icon={RefreshCw}
            loading={loading}
            onClick={loadData}
          >
            Refresh
          </Button>
          <Button
            size="sm"
            variant="primary"
            icon={Plus}
            disabled={!canRemoteWrite}
            title={!canRemoteWrite ? disabledReason : "Create Pull Request"}
            onClick={() => {
              setHead(currentBranch || "main");
              setBase(defaultBranch || "main");
              setShowCreate((v) => !v);
            }}
          >
            New Pull Request
          </Button>
        </div>
      </div>

      {/* Create PR Form */}
      {showCreate && (
        <form
          onSubmit={handleCreatePr}
          className="p-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] space-y-3 text-xs"
        >
          <div className="font-semibold text-[var(--color-text)]">
            Open Pull Request on GitHub
          </div>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Pull Request title"
            required
            className="w-full h-9 px-3 rounded-md bg-[var(--color-surface-secondary)] border border-[var(--color-border)] focus:border-[var(--color-primary)] outline-none text-xs text-[var(--color-text)]"
          />
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Describe what changed..."
            rows={3}
            className="w-full p-2.5 rounded-md bg-[var(--color-surface-secondary)] border border-[var(--color-border)] focus:border-[var(--color-primary)] outline-none text-xs text-[var(--color-text)] resize-y"
          />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-wider text-[var(--color-text-muted)] mb-1">
                Compare (Head Branch)
              </label>
              <select
                value={head}
                onChange={(e) => setHead(e.target.value)}
                className="w-full h-8 px-2.5 rounded-md bg-[var(--color-surface-secondary)] border border-[var(--color-border)] font-mono text-xs text-[var(--color-text)]"
              >
                {branches.map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-wider text-[var(--color-text-muted)] mb-1">
                Into (Base Branch)
              </label>
              <input
                type="text"
                value={base}
                onChange={(e) => setBase(e.target.value)}
                className="w-full h-8 px-2.5 rounded-md bg-[var(--color-surface-secondary)] border border-[var(--color-border)] font-mono text-xs text-[var(--color-text)]"
              />
            </div>
          </div>
          <div className="flex items-center justify-between pt-1">
            <label className="inline-flex items-center gap-2 text-xs text-[var(--color-text-secondary)] cursor-pointer">
              <input
                type="checkbox"
                checked={draft}
                onChange={(e) => setDraft(e.target.checked)}
              />
              <span>Create as Draft PR</span>
            </label>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => setShowCreate(false)}
              >
                Cancel
              </Button>
              <Button type="submit" size="sm" variant="primary" loading={creating}>
                Create PR
              </Button>
            </div>
          </div>
        </form>
      )}

      {/* PR List */}
      {pulls.length === 0 ? (
        <div className="p-8 text-center border border-dashed border-[var(--color-border)] rounded-lg bg-[var(--color-surface)] text-xs text-[var(--color-text-muted)]">
          No {stateFilter} Pull Requests found for this repository.
        </div>
      ) : (
        <div className="border border-[var(--color-border)] rounded-lg bg-[var(--color-surface)] divide-y divide-[var(--color-border)]">
          {pulls.map((pr) => (
            <div
              key={pr.id}
              className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 hover:bg-[var(--color-surface-secondary)]/50 transition-colors duration-150"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-mono text-xs font-semibold tabular-nums text-[var(--color-primary)]">
                    #{pr.number}
                  </span>
                  <span className="text-xs font-semibold text-[var(--color-text)] truncate">
                    {pr.title}
                  </span>
                  {pr.draft && (
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-[var(--color-surface-secondary)] border border-[var(--color-border)] text-[var(--color-text-muted)]">
                      Draft
                    </span>
                  )}
                  <span
                    className={`px-1.5 py-0.5 rounded text-[10px] font-mono uppercase border ${
                      pr.mergedAt
                        ? "bg-indigo-500/10 text-indigo-400 border-indigo-500/20"
                        : pr.state === "open"
                          ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                          : "bg-rose-500/10 text-rose-400 border-rose-500/20"
                    }`}
                  >
                    {pr.mergedAt ? "merged" : pr.state}
                  </span>
                </div>
                <div className="flex items-center gap-2 mt-1 text-[11px] text-[var(--color-text-muted)] font-mono">
                  <span>
                    {pr.headRef} → {pr.baseRef}
                  </span>
                  <span>·</span>
                  <span>by {pr.author || "unknown"}</span>
                  <span>·</span>
                  <span>{formatRelativeTime(pr.updatedAt || pr.createdAt)}</span>
                </div>
              </div>

              <a
                href={pr.htmlUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] hover:border-[var(--color-primary)] text-xs font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-text)]"
              >
                <span>GitHub</span>
                <ExternalLink size={11} />
              </a>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
