import React from "react";

/**
 * Base Skeleton component adhering to COVAI_FRONTEND_AGENT_RULES.md
 * Uses design tokens (var(--color-surface-secondary)) and smooth pulse animations.
 */
export function Skeleton({
  className = "",
  width,
  height,
  rounded = "rounded-[var(--radius-md)]",
  style = {},
  ...props
}) {
  return (
    <div
      className={`animate-pulse bg-[var(--color-surface-secondary)] ${rounded} ${className}`}
      style={{
        width,
        height,
        ...style,
      }}
      aria-hidden="true"
      {...props}
    />
  );
}

/**
 * ProjectsLoadingSkeleton for ProjectSelectionPage
 * Mirrors both Grid and List layouts with exact dimensions.
 */
export function ProjectGridSkeleton({ count = 6, viewMode = "grid" }) {
  if (viewMode === "list") {
    return (
      <div className="flex flex-col gap-2" aria-label="Loading projects list">
        {Array.from({ length: count }).map((_, i) => (
          <div
            key={i}
            className="flex items-center justify-between p-3 rounded-[var(--radius-md)] bg-[var(--color-surface)] border border-[var(--color-border)] h-[58px]"
          >
            <div className="flex items-center gap-3">
              <Skeleton className="w-8 h-8 rounded-[var(--radius-md)] shrink-0" />
              <div className="flex flex-col gap-1.5">
                <Skeleton className="h-3.5 w-36 rounded-[var(--radius-sm)]" />
                <Skeleton className="h-2.5 w-24 rounded-[var(--radius-sm)]" />
              </div>
            </div>
            <div className="flex items-center gap-4">
              <Skeleton className="h-3 w-20 rounded-[var(--radius-sm)] hidden sm:block" />
              <div className="flex items-center gap-1.5">
                <Skeleton className="w-6 h-6 rounded-[var(--radius-sm)]" />
                <Skeleton className="w-6 h-6 rounded-[var(--radius-sm)]" />
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div
      className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4"
      aria-label="Loading projects grid"
    >
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="p-4 rounded-[var(--radius-lg)] bg-[var(--color-surface)] border border-[var(--color-border)] flex flex-col justify-between h-[168px]"
        >
          <div>
            {/* Top Row: Icon + Badge + Favorite/Action placeholders */}
            <div className="flex items-start justify-between gap-3 mb-3">
              <div className="flex items-center gap-2">
                <Skeleton className="w-8 h-8 rounded-[var(--radius-md)] shrink-0" />
                <Skeleton className="w-14 h-5 rounded-full" />
              </div>
              <div className="flex items-center gap-1">
                <Skeleton className="w-6 h-6 rounded-[var(--radius-sm)]" />
                <Skeleton className="w-6 h-6 rounded-[var(--radius-sm)]" />
              </div>
            </div>

            {/* Project Title Placeholder */}
            <Skeleton className="h-4 w-3/4 mb-2.5 rounded-[var(--radius-sm)]" />

            {/* Branch Badge Placeholder */}
            <Skeleton className="h-4 w-16 rounded-[var(--radius-sm)]" />
          </div>

          {/* Footer: Date and Open link */}
          <div className="pt-3 mt-4 border-t border-[var(--color-border)] flex items-center justify-between">
            <Skeleton className="h-3 w-20 rounded-[var(--radius-sm)]" />
            <Skeleton className="h-3 w-12 rounded-[var(--radius-sm)]" />
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * FileTreeSkeleton for Sidebar explorer
 * Mirrors VS Code directory tree with realistic indentation & icon placeholders.
 */
export function FileTreeSkeleton({ rows = 9 }) {
  // Pre-configured hierarchical structure (depth, isFolder, width)
  const treeNodes = [
    { depth: 0, isFolder: true, width: "w-24" },
    { depth: 1, isFolder: true, width: "w-20" },
    { depth: 2, isFolder: false, width: "w-28" },
    { depth: 2, isFolder: false, width: "w-24" },
    { depth: 1, isFolder: false, width: "w-32" },
    { depth: 1, isFolder: false, width: "w-20" },
    { depth: 0, isFolder: true, width: "w-28" },
    { depth: 1, isFolder: false, width: "w-24" },
    { depth: 0, isFolder: false, width: "w-20" },
    { depth: 0, isFolder: false, width: "w-26" },
    { depth: 0, isFolder: false, width: "w-16" },
    { depth: 0, isFolder: false, width: "w-22" },
  ].slice(0, rows);

  return (
    <div className="py-1 select-none" aria-label="Loading workspace file tree">
      {treeNodes.map((item, index) => (
        <div
          key={index}
          className="flex items-center gap-1.5 h-7 px-2"
          style={{ paddingLeft: `${item.depth * 14 + 14}px` }}
        >
          {/* Chevron/folder/file marker placeholder */}
          <Skeleton
            className={`shrink-0 rounded-[var(--radius-sm)] ${
              item.isFolder ? "w-3.5 h-3.5" : "w-3 h-3 ml-0.5"
            }`}
          />
          {/* Filename placeholder with varying widths */}
          <Skeleton
            className={`h-3 rounded-[var(--radius-sm)] ${item.width}`}
          />
        </div>
      ))}
    </div>
  );
}

/**
 * EditorCodeSkeleton for Monaco Editor loading state
 * Shows left gutter with line numbers and indented code lines.
 */
export function EditorCodeSkeleton({ lines = 22 }) {
  // Mock varying indentation and widths to look like real code
  const codeStructure = [
    { indent: 0, width: "w-44" }, // import ...
    { indent: 0, width: "w-56" }, // import ...
    { indent: 0, width: "w-36" }, // import ...
    { indent: 0, width: "w-0" }, // empty line
    { indent: 0, width: "w-48" }, // export function ...
    { indent: 1, width: "w-32" }, // const [state] = ...
    { indent: 1, width: "w-40" }, // const config = ...
    { indent: 1, width: "w-0" }, // empty line
    { indent: 1, width: "w-36" }, // useEffect(() => {
    { indent: 2, width: "w-64" }, // const data = await ...
    { indent: 2, width: "w-48" }, // handleResult(data);
    { indent: 1, width: "w-16" }, // }, []);
    { indent: 1, width: "w-0" }, // empty line
    { indent: 1, width: "w-28" }, // return (
    { indent: 2, width: "w-52" }, // <div className="...">
    { indent: 3, width: "w-40" }, // <Header title="..." />
    { indent: 3, width: "w-60" }, // <Content items={data} />
    { indent: 2, width: "w-20" }, // </div>
    { indent: 1, width: "w-12" }, // );
    { indent: 0, width: "w-8" }, // }
    { indent: 0, width: "w-0" }, // empty line
    { indent: 0, width: "w-32" }, // export default Component;
  ].slice(0, lines);

  return (
    <div
      className="w-full h-full flex flex-col bg-[var(--color-bg)] select-none overflow-hidden"
      aria-label="Loading file contents"
    >
      {/* Top hint bar */}
      <div className="h-7 border-b border-[var(--color-border)] px-4 flex items-center justify-between text-[11px] text-[var(--color-text-muted)] bg-[var(--color-surface)] shrink-0">
        <div className="flex items-center gap-2">
          <Skeleton className="w-2.5 h-2.5 rounded-full" />
          <span>Reading file buffer...</span>
        </div>
        <Skeleton className="w-16 h-3 rounded-[var(--radius-sm)]" />
      </div>

      {/* Editor body with line gutter */}
      <div className="flex-1 flex overflow-hidden pt-2">
        {/* Line Numbers Gutter */}
        <div className="w-12 shrink-0 flex flex-col items-end pr-3 border-r border-[var(--color-border)] select-none font-mono text-[11px] text-[var(--color-text-muted)] opacity-40">
          {codeStructure.map((_, idx) => (
            <div key={idx} className="h-5 leading-5">
              {idx + 1}
            </div>
          ))}
        </div>

        {/* Code Content Area */}
        <div className="flex-1 flex flex-col pl-3">
          {codeStructure.map((item, idx) => (
            <div
              key={idx}
              className="h-5 flex items-center"
              style={{ paddingLeft: `${item.indent * 18}px` }}
            >
              {item.width !== "w-0" && (
                <Skeleton
                  className={`h-3 rounded-[var(--radius-sm)] ${item.width}`}
                />
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * CoverageDashboardSkeleton for CoverageTypeDashboard
 * Mirrors metric cards, summary section, and detailed file rows.
 */
export function CoverageDashboardSkeleton() {
  return (
    <div
      className="space-y-4 select-none pb-8"
      aria-label="Loading coverage analysis"
    >
      {/* 4 Metric Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="p-4 rounded-[var(--radius-lg)] bg-[var(--color-surface)] border border-[var(--color-border)] flex flex-col justify-between h-[104px]"
          >
            <div className="flex items-center justify-between">
              <Skeleton className="h-3 w-20 rounded-[var(--radius-sm)]" />
              <Skeleton className="w-4 h-4 rounded-full" />
            </div>
            <div className="flex items-baseline justify-between mt-2">
              <Skeleton className="h-7 w-16 rounded-[var(--radius-sm)]" />
              <Skeleton className="h-3 w-12 rounded-[var(--radius-sm)]" />
            </div>
            <Skeleton className="h-1.5 w-full rounded-full mt-2" />
          </div>
        ))}
      </div>

      {/* Main Analysis Overview Card */}
      <div className="p-5 rounded-[var(--radius-lg)] bg-[var(--color-surface)] border border-[var(--color-border)]">
        <div className="flex items-center justify-between pb-4 mb-4 border-b border-[var(--color-border)]">
          <div className="flex items-center gap-2.5">
            <Skeleton className="w-4 h-4 rounded-[var(--radius-sm)]" />
            <Skeleton className="h-4 w-36 rounded-[var(--radius-sm)]" />
          </div>
          <div className="flex items-center gap-2">
            <Skeleton className="h-6 w-20 rounded-[var(--radius-sm)]" />
            <Skeleton className="h-6 w-16 rounded-[var(--radius-sm)]" />
          </div>
        </div>

        {/* Visual progress bars or distribution placeholders */}
        <div className="space-y-3 pt-1">
          <div className="flex items-center justify-between">
            <Skeleton className="h-3 w-28 rounded-[var(--radius-sm)]" />
            <Skeleton className="h-3 w-10 rounded-[var(--radius-sm)]" />
          </div>
          <Skeleton className="h-2.5 w-full rounded-full" />

          <div className="flex items-center justify-between pt-2">
            <Skeleton className="h-3 w-32 rounded-[var(--radius-sm)]" />
            <Skeleton className="h-3 w-10 rounded-[var(--radius-sm)]" />
          </div>
          <Skeleton className="h-2.5 w-full rounded-full" />
        </div>
      </div>

      {/* File List Table Skeleton */}
      <div className="rounded-[var(--radius-lg)] bg-[var(--color-surface)] border border-[var(--color-border)] overflow-hidden">
        {/* Table Header */}
        <div className="px-4 py-3 bg-[var(--color-surface-secondary)] border-b border-[var(--color-border)] flex items-center justify-between">
          <Skeleton className="h-3 w-28 rounded-[var(--radius-sm)]" />
          <div className="flex items-center gap-6">
            <Skeleton className="h-3 w-16 rounded-[var(--radius-sm)] hidden sm:block" />
            <Skeleton className="h-3 w-12 rounded-[var(--radius-sm)]" />
          </div>
        </div>

        {/* Table Rows */}
        <div className="divide-y divide-[var(--color-border)]">
          {Array.from({ length: 5 }).map((_, i) => (
            <div
              key={i}
              className="px-4 py-3 flex items-center justify-between h-[48px]"
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <Skeleton className="w-3.5 h-3.5 rounded-[var(--radius-sm)] shrink-0" />
                <Skeleton
                  className={`h-3 rounded-[var(--radius-sm)] ${
                    i % 2 === 0 ? "w-48 sm:w-64" : "w-36 sm:w-48"
                  }`}
                />
              </div>
              <div className="flex items-center gap-4 sm:gap-6 shrink-0">
                <Skeleton className="h-2 w-20 rounded-full hidden sm:block" />
                <Skeleton className="h-3 w-10 rounded-[var(--radius-sm)]" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * SnapshotsListSkeleton for Version Hub checkpoints
 */
export function SnapshotsListSkeleton({ count = 3 }) {
  return (
    <div
      className="flex flex-col gap-3 select-none"
      aria-label="Loading snapshot checkpoints"
    >
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="rounded-[var(--radius-lg)] p-4 sm:p-5 bg-[var(--color-surface)] border border-[var(--color-border)] flex flex-col justify-between"
        >
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-3">
            <div className="flex items-center gap-3">
              <Skeleton className="w-8 h-8 rounded-[var(--radius-md)] shrink-0" />
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center gap-2">
                  <Skeleton className="h-4 w-32 rounded-[var(--radius-sm)]" />
                  <Skeleton className="h-4 w-14 rounded-full" />
                </div>
                <Skeleton className="h-3 w-48 rounded-[var(--radius-sm)]" />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Skeleton className="h-7 w-20 rounded-[var(--radius-md)]" />
              <Skeleton className="h-7 w-7 rounded-[var(--radius-md)]" />
            </div>
          </div>
          <div className="pt-3 border-t border-[var(--color-border)] flex items-center justify-between">
            <Skeleton className="h-3 w-28 rounded-[var(--radius-sm)]" />
            <Skeleton className="h-3 w-20 rounded-[var(--radius-sm)]" />
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * JobsListSkeleton for Pipeline and Job Queue executions
 */
export function JobsListSkeleton({ count = 3 }) {
  return (
    <div
      className="flex flex-col gap-3 select-none"
      aria-label="Loading pipeline jobs"
    >
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="rounded-[var(--radius-lg)] p-4 sm:p-5 bg-[var(--color-surface)] border border-[var(--color-border)] flex flex-col"
        >
          <div className="flex flex-col md:flex-row md:items-start justify-between gap-4 mb-3">
            <div className="flex items-center gap-3">
              <Skeleton className="w-9 h-9 rounded-[var(--radius-md)] shrink-0" />
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center gap-2">
                  <Skeleton className="h-4 w-36 rounded-[var(--radius-sm)]" />
                  <Skeleton className="h-4 w-16 rounded-full" />
                </div>
                <Skeleton className="h-3 w-40 rounded-[var(--radius-sm)]" />
              </div>
            </div>
            <div className="flex items-center gap-2 self-end md:self-auto">
              <Skeleton className="h-7 w-24 rounded-[var(--radius-md)]" />
            </div>
          </div>
          <Skeleton className="h-1.5 w-full rounded-full my-2" />
          <div className="pt-2 flex items-center justify-between">
            <Skeleton className="h-3 w-28 rounded-[var(--radius-sm)]" />
            <Skeleton className="h-3 w-16 rounded-[var(--radius-sm)]" />
          </div>
        </div>
      ))}
    </div>
  );
}
