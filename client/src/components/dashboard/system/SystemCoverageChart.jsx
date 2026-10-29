const metrics = ['lines', 'branches', 'functions', 'statements'];

export default function SystemCoverageChart({ tier, measurement, scope }) {
  const color = tier === 'frontend' ? 'var(--color-primary)' : '#28b4a4';
  return <article className="min-w-0 rounded-[var(--radius-md)] border border-[var(--color-border)] p-4 sm:p-5">
    <div className="flex flex-wrap items-center justify-between gap-2"><h4 className="font-semibold capitalize">{tier} coverage</h4><span className="rounded bg-[var(--color-surface-secondary)] px-2 py-1 text-[10px] font-medium text-[var(--color-text-secondary)]">{measurement.status}</span></div>
    {scope && <p className="mt-2 font-mono text-[11px] break-all text-[var(--color-text-muted)]">{[scope.root, scope.sourceDirectory].filter(part => part !== '.').join('/') || 'Application package root'}</p>}
    <div className="mt-5 space-y-4">{metrics.map(metric => {
      const value = measurement.counters?.[metric];
      const measured = value && Number.isFinite(value.pct);
      return <div key={metric}>
        <div className="mb-2 flex items-baseline justify-between gap-3 text-xs"><span className="capitalize text-[var(--color-text-secondary)]">{metric}</span><span className="tabular-nums font-semibold">{measured ? `${value.pct}%` : 'Not measured'}{value && <span className="ml-2 text-[10px] font-normal text-[var(--color-text-muted)]">{value.covered}/{value.total}</span>}</span></div>
        <div role={measured ? 'meter' : undefined} aria-label={`${tier} ${metric} coverage`} aria-valuemin={measured ? 0 : undefined} aria-valuemax={measured ? 100 : undefined} aria-valuenow={measured ? value.pct : undefined} aria-valuetext={measured ? `${value.covered} of ${value.total} covered` : undefined} className="h-2 overflow-hidden rounded-full bg-[var(--color-surface-secondary)]">
          {measured && <div className="h-full rounded-full" style={{width:`${Math.max(0, Math.min(100,value.pct))}%`,backgroundColor:color}} />}
        </div>
      </div>;
    })}</div>
    <div className="mt-5 border-t border-[var(--color-border)] pt-3 text-[11px] leading-relaxed text-[var(--color-text-muted)]">
      {measurement.scope && <p>{measurement.scope.instrumentedFiles}/{measurement.scope.eligibleFiles} eligible files instrumented</p>}
      {measurement.status === 'PARTIAL' && <p>Bars represent the measured subset only.</p>}
      {!!measurement.reasonCodes?.length && <p className="mt-1 break-words">{measurement.reasonCodes.join(', ')}</p>}
    </div>
  </article>;
}
