import SystemCoverageChart from './SystemCoverageChart.jsx';

export default function SystemTestDimensionsTable({ assessment }) {
  const report = assessment?.presentation;
  const requirements = report?.requirements || assessment?.requirements;
  const tiers = report?.coverage || assessment?.coverage?.tiers || {};
  return <div className="space-y-4">
    <div className="grid sm:grid-cols-2 gap-px bg-[var(--color-border)] border border-[var(--color-border)] rounded-lg overflow-hidden">
      <article className="bg-[var(--color-bg)] p-4">
        <h4 className="text-xs font-medium text-[var(--color-text-secondary)]">Requirement verification</h4>
        {requirements?.status === 'MEASURED'
          ? <p className="mt-2 text-xl font-medium font-mono tabular-nums text-[var(--color-text)]">{`${requirements.verified}/${requirements.total}`}</p>
          : <p className="mt-2 text-sm text-[var(--color-text-secondary)]">Not measured yet</p>}
        <p className="mt-1 text-xs text-[var(--color-text-muted)]">Confirmed requirements with reviewed, executed assertions</p>
      </article>
      <article className="bg-[var(--color-bg)] p-4">
        <h4 className="text-xs font-medium text-[var(--color-text-secondary)]">Observed API endpoints</h4>
        {Number.isFinite(report?.observations?.apiEndpoints?.observed)
          ? <p className="mt-2 text-xl font-medium font-mono tabular-nums text-[var(--color-text)]">{report.observations.apiEndpoints.observed}</p>
          : <p className="mt-2 text-sm text-[var(--color-text-secondary)]">Not captured</p>}
        <p className="mt-1 text-xs text-[var(--color-text-muted)]">Calls seen during the run, not full API coverage</p>
      </article>
    </div>
    <div className="grid gap-4 lg:grid-cols-2">{['frontend', 'backend'].map(tier => <SystemCoverageChart key={tier} tier={tier} measurement={tiers[tier] || { status: 'NOT_MEASURED' }} />)}</div>
  </div>;
}
