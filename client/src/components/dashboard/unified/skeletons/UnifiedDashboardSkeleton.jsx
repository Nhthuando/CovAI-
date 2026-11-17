import { Skeleton } from "../../../common/Skeleton.jsx";

export function UnifiedDashboardSkeleton() {
  return (
    <div className="w-full space-y-6 animate-pulse">
      {/* Zone 1: Header Skeleton */}
      <div className="flex flex-wrap items-center justify-between gap-4 p-4 rounded-[var(--radius-lg)] border border-[var(--ud-border)] bg-[var(--ud-surface)]">
        <div className="flex items-center gap-3">
          <Skeleton className="h-6 w-44" />
          <Skeleton className="h-7 w-32 rounded-md" />
          <Skeleton className="h-4 w-24" />
        </div>
        <div className="flex items-center gap-3">
          <Skeleton className="h-7 w-36 rounded-md" />
          <Skeleton className="h-8 w-28 rounded-md" />
          <Skeleton className="h-8 w-28 rounded-md" />
        </div>
      </div>

      {/* Zone 2: 4 Executive KPI Cards */}
      <div className="grid grid-cols-12 gap-4">
        {[1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className="col-span-12 sm:col-span-6 xl:col-span-3 rounded-[var(--radius-lg)] border border-[var(--ud-border)] bg-[var(--ud-surface)] p-4 min-h-[140px] flex flex-col justify-between"
          >
            <div className="flex items-center justify-between">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-4 w-4 rounded-full" />
            </div>
            <div className="space-y-2 my-2">
              <Skeleton className="h-7 w-20" />
              <Skeleton className="h-3 w-36" />
            </div>
            <Skeleton className="h-3 w-full" />
          </div>
        ))}
      </div>

      {/* Zone 3: Test Pyramid & 3 Pillar Cards */}
      <div className="grid grid-cols-12 gap-4">
        <div className="col-span-12 xl:col-span-4 rounded-[var(--radius-lg)] border border-[var(--ud-border)] bg-[var(--ud-surface)] p-5 min-h-[300px]">
          <Skeleton className="h-5 w-40 mb-4" />
          <Skeleton className="h-48 w-full rounded-md" />
        </div>
        <div className="col-span-12 xl:col-span-8 grid grid-cols-1 md:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="rounded-[var(--radius-lg)] border border-[var(--ud-border)] bg-[var(--ud-surface)] p-4 min-h-[300px] flex flex-col justify-between"
            >
              <div className="space-y-2">
                <Skeleton className="h-5 w-28" />
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-20 w-full mt-4" />
              </div>
              <Skeleton className="h-8 w-full mt-4" />
            </div>
          ))}
        </div>
      </div>

      {/* Zone 4: Unified Analysis Tabs (Tab Bar + Action Alert Strip + Full-Width Matrix) */}
      <div className="space-y-4">
        {/* Tab switcher skeleton */}
        <div className="flex items-center justify-between border-b border-[var(--ud-border)] pb-3">
          <div className="flex items-center gap-2">
            <Skeleton className="h-8 w-44 rounded-md" />
            <Skeleton className="h-8 w-48 rounded-md" />
          </div>
          <Skeleton className="h-4 w-32" />
        </div>

        {/* Action Alert Strip skeleton */}
        <div className="rounded-[var(--radius-md)] border border-[var(--ud-border)] bg-[var(--ud-surface)] p-3 space-y-2.5">
          <div className="flex items-center justify-between">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-3 w-28" />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-24 w-full rounded-md" />
            ))}
          </div>
        </div>

        {/* Full-width Matrix skeleton */}
        <div className="rounded-[var(--radius-lg)] border border-[var(--ud-border)] bg-[var(--ud-surface)] p-5 min-h-[300px]">
          <div className="flex items-center justify-between mb-4">
            <Skeleton className="h-5 w-52" />
            <div className="flex items-center gap-2">
              <Skeleton className="h-7 w-40 rounded-md" />
              <Skeleton className="h-7 w-32 rounded-md" />
            </div>
          </div>
          <Skeleton className="h-56 w-full rounded-md" />
        </div>
      </div>
    </div>
  );
}

export default UnifiedDashboardSkeleton;
