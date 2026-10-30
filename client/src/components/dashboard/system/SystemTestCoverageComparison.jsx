const labels = { lines: 'Lines', branches: 'Branches', functions: 'Functions', statements: 'Statements' };
const percentage = value => Number.isFinite(value) ? `${value.toFixed(2)}%` : 'Not measured';

export default function SystemTestCoverageComparison({ changes }) {
  const tiers = Object.entries(changes || {}).filter(([, metrics]) => Object.keys(metrics || {}).length);
  if (!tiers.length) return null;
  return <div className="space-y-3">
    <p className="text-xs font-medium text-[var(--color-text-secondary)]">Measured coverage: existing tests vs AI additions</p>
    <div className="grid gap-3 lg:grid-cols-2">{tiers.map(([tier, metrics]) => <div key={tier} className="overflow-x-auto rounded-[var(--radius-sm)] border border-[var(--color-border)] p-3">
      <table className="w-full text-xs tabular-nums">
        <caption className="pb-3 text-left font-semibold">{tier === 'frontend' ? 'Frontend' : 'Backend'} coverage</caption>
        <thead><tr className="text-[var(--color-text-muted)]"><th scope="col" className="pb-2 text-left font-normal">Metric</th><th scope="col" className="pb-2 text-right font-normal">Before</th><th scope="col" className="pb-2 text-right font-normal">After</th><th scope="col" className="pb-2 pl-3 text-right font-normal">Change (pp)</th></tr></thead>
        <tbody>{Object.entries(labels).filter(([metric]) => metrics[metric]).map(([metric, label]) => {
          const value = metrics[metric];
          const delta = value.percentagePoints;
          return <tr key={metric} className="border-t border-[var(--color-border)]"><th scope="row" className="py-2 text-left font-normal">{label}</th><td className="py-2 text-right">{percentage(value.before)}</td><td className="py-2 text-right">{percentage(value.after)}</td><td className={`py-2 pl-3 text-right ${delta > 0 ? 'text-[var(--color-success)]' : delta < 0 ? 'text-[var(--color-warning)]' : 'text-[var(--color-text-muted)]'}`}>{Number.isFinite(delta) ? `${delta > 0 ? '+' : ''}${delta.toFixed(2)}` : '—'}</td></tr>;
        })}</tbody>
      </table>
    </div>)}</div>
    <p className="text-[11px] text-[var(--color-text-muted)]">pp = percentage points. Coverage records code execution; it does not prove complete business correctness.</p>
  </div>;
}
