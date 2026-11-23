import SystemCoverageChart from './SystemCoverageChart.jsx';

export default function SystemTestDimensionsTable({ assessment }) {
  const report = assessment?.presentation;
  const requirements = report?.requirements || assessment?.requirements;
  const tiers = report?.coverage || assessment?.coverage?.tiers || {};
  return <div className="space-y-4">
    <div className="grid sm:grid-cols-2 gap-px bg-[var(--color-border)] border border-[var(--color-border)] rounded-lg overflow-hidden">
      <article className="bg-[var(--color-bg)] p-4">
        <h4 className="text-xs font-medium text-[var(--color-text-secondary)]">Requirement verification</h4>
        <p className="mt-1.5 text-xl font-semibold font-mono tabular-nums text-[var(--color-text)]">{requirements?.status === 'MEASURED' ? `${requirements.verified}/${requirements.total}` : 'Not measured'}</p>
        <p className="mt-1 text-xs text-[var(--color-text-muted)]">Confirmed criteria with reviewed, executed assertions.</p>
      </article>
      <article className="bg-[var(--color-bg)] p-4">
        <h4 className="text-xs font-medium text-[var(--color-text-secondary)]">Observed API endpoints</h4>
        <p className="mt-1.5 text-xl font-semibold font-mono tabular-nums text-[var(--color-text)]">{report?.observations?.apiEndpoints?.observed ?? 'Not captured'}</p>
        <p className="mt-1 text-xs text-[var(--color-text-muted)]">Observed calls do not establish complete API coverage.</p>
      </article>
    </div>
    <div className="grid gap-4 lg:grid-cols-2">{['frontend', 'backend'].map(tier => <SystemCoverageChart key={tier} tier={tier} measurement={tiers[tier] || { status: 'NOT_MEASURED' }} />)}</div>
  </div>;
}
