import { Skeleton } from "../../common/Skeleton.jsx";
import { Badge } from "../../ui/badge.jsx";
import { Card } from "../../ui/card.jsx";
import { CategoryBar } from "../../ui/tremor.jsx";

const relativeTime = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

function formatRunTime(timestamp) {
  const date = Date.parse(timestamp);
  if (!Number.isFinite(date)) return "";

  const minutes = Math.round((date - Date.now()) / 60_000);
  if (Math.abs(minutes) < 1) return "Just now";
  if (Math.abs(minutes) < 60) return relativeTime.format(minutes, "minute");
  if (Math.abs(minutes) < 1440) return relativeTime.format(Math.round(minutes / 60), "hour");
  return relativeTime.format(Math.round(minutes / 1440), "day");
}

function KpiCard({ label, value, detail, percent, color, loading }) {
  return (
    <Card className="gap-1 px-3 py-3 sm:px-4">
      <h2 className="text-xs font-medium text-[var(--color-text-muted)]">{label}</h2>
      {loading ? (
        <>
          <Skeleton className="my-1 h-6 w-14" />
          <Skeleton className="my-0.5 h-3 w-24 max-w-full" />
        </>
      ) : (
        <>
          <div className="flex min-h-8 items-center text-xl font-semibold tabular-nums">{value}</div>
          <p className="text-xs text-[var(--color-text-muted)]">{detail}</p>
          {percent != null && (
            <CategoryBar
              className="mt-1 h-1"
              segments={[
                { label, value: percent, color },
                { label: "Remaining", value: 100 - percent, color: "neutral" },
              ]}
            />
          )}
        </>
      )}
    </Card>
  );
}

export default function SystemKpiCards({ telemetry, summary, executionMode, loading }) {
  const { hasRun, hasCodeCoverage, codeLinesPct, passRate, passedScenarios, totalScenarios,
    durationMs, coveredCases, totalCases, totalSpecs, failedScenarios, flakyScenarios } = telemetry;
  const percent = hasCodeCoverage ? codeLinesPct : passRate;
  const casePercent = totalCases ? Math.min(100, (coveredCases / totalCases) * 100) : 0;
  const lastRunTime = formatRunTime(summary?.runStartedAt);
  const runMode = (summary?.executionMode || executionMode) === "frontend" ? "Frontend" : "Full stack";
  const isLoading = loading && !summary;

  let status = <Badge>Not run</Badge>;
  if (hasRun) {
    if (failedScenarios > 0) {
      status = <Badge variant="danger" className="text-[var(--color-danger)]">{failedScenarios} failed</Badge>;
    } else if (flakyScenarios > 0) {
      status = <Badge variant="warning" className="text-[color:color-mix(in_srgb,var(--color-text)_65%,#f59e0b)]">{flakyScenarios} flaky</Badge>;
    } else {
      status = <Badge variant="success" className="text-[color:color-mix(in_srgb,var(--color-text)_65%,#10b981)]">All passed</Badge>;
    }
  }

  return (
    <div className="grid grid-cols-3 gap-2 sm:gap-4" aria-busy={isLoading}>
      <KpiCard
        label={hasCodeCoverage ? "Measured coverage" : "Pass rate"}
        value={hasCodeCoverage || hasRun ? `${hasCodeCoverage ? percent.toFixed(1) : percent}%` : "—"}
        detail={hasRun ? `${passedScenarios} of ${totalScenarios} passed · ${(durationMs / 1000).toFixed(1)}s` : "Not run yet"}
        percent={hasCodeCoverage || hasRun ? Math.min(100, Math.max(0, percent)) : null}
        color={percent >= 80 ? "success" : percent >= 50 ? "warning" : "primary"}
        loading={isLoading}
      />
      <KpiCard
        label="Case coverage"
        value={`${coveredCases}/${totalCases}`}
        detail={`${totalSpecs} ${totalSpecs === 1 ? "spec file" : "spec files"}`}
        percent={casePercent}
        color="primary"
        loading={isLoading}
      />
      <KpiCard
        label="Last run"
        value={status}
        detail={lastRunTime ? `${lastRunTime} · ${runMode}` : runMode}
        loading={isLoading}
      />
    </div>
  );
}
