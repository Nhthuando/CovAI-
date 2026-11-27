const metrics = ['lines', 'branches', 'functions', 'statements'];
// MEASURED -> Measured, NOT_MEASURED -> Not measured
const statusLabel = status => String(status || 'NOT_MEASURED').replaceAll('_', ' ').toLowerCase().replace(/^./, c => c.toUpperCase());

export default function SystemCoverageChart({ tier, measurement, scope }) {
  const color = tier === 'frontend' ? 'var(--color-primary)' : '#2dd4bf';
  return <article className="min-w-0 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] p-4">
    <div className="flex flex-wrap items-center justify-between gap-2"><h4 className="text-xs font-medium text-[var(--color-text)]">{tier === 'frontend' ? 'Frontend' : 'Backend'} coverage</h4><span className="rounded-md bg-[var(--color-surface)] border border-[var(--color-border)] px-2 py-0.5 text-[11px] text-[var(--color-text-secondary)]">{statusLabel(measurement.status)}</span></div>
    {scope && <p className="mt-2 font-mono text-[11px] break-all text-[var(--color-text-muted)]">{[scope.root, scope.sourceDirectory].filter(part => part !== '.').join('/') || 'Application package root'}</p>}
    <div className="mt-4 space-y-3.5">{metrics.map(metric => {
      const value = measurement.counters?.[metric];
      const measured = value && Number.isFinite(value.pct);
      return <div key={metric}>
        <div className="mb-1.5 flex items-baseline justify-between gap-3 text-xs"><span className="capitalize text-[var(--color-text-secondary)]">{metric}</span><span className="font-mono tabular-nums font-medium text-[var(--color-text)]">{measured ? `${value.pct}%` : 'Not measured'}{value && <span className="ml-2 text-[11px] font-normal text-[var(--color-text-muted)]">{value.covered}/{value.total}</span>}</span></div>
        <div role={measured ? 'meter' : undefined} aria-label={`${tier} ${metric} coverage`} aria-valuemin={measured ? 0 : undefined} aria-valuemax={measured ? 100 : undefined} aria-valuenow={measured ? value.pct : undefined} aria-valuetext={measured ? `${value.covered} of ${value.total} covered` : undefined} className="h-1.5 overflow-hidden rounded-sm bg-[var(--color-surface-secondary)]">
          {measured && <div className="h-full rounded-sm transition-colors duration-300" style={{width:`${Math.max(0, Math.min(100,value.pct))}%`,backgroundColor:color, opacity: 0.8}} />}
        </div>
      </div>;
    })}</div>
    <div className="mt-4 border-t border-[var(--color-border)] pt-3 text-[11px] leading-relaxed text-[var(--color-text-muted)]">
      {measurement.scope && <p className="font-mono tabular-nums">{measurement.scope.instrumentedFiles}/{measurement.scope.eligibleFiles} eligible files instrumented</p>}
      {measurement.status === 'PARTIAL' && <p>Bars show the measured files only</p>}
      {!!measurement.reasonCodes?.length && <p className="mt-1 break-words">{measurement.reasonCodes.join(', ')}</p>}
    </div>
  </article>;
}
