import { useState } from 'react';
import { downloadSystemAssessmentPdf } from '../../../services/systemTest.service.js';
import SystemTestReportCharts from './SystemTestReportCharts.jsx';
import SystemTestDimensionsTable from './SystemTestDimensionsTable.jsx';
import SystemTestScenarioLibrary from './SystemTestScenarioLibrary.jsx';
import { formatReportDate } from './systemReportModel.js';
import SystemTestCoverageComparison from './SystemTestCoverageComparison.jsx';

export default function SystemTestReportView({ assessment, snapshotId, onBack }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const report = assessment?.presentation;
  const download = async () => {
    setBusy(true); setError('');
    try { await downloadSystemAssessmentPdf(snapshotId, assessment.id); }
    catch { setError('Could not export PDF. Try again.'); }
    finally { setBusy(false); }
  };
  const print = async () => {
    setError('');
    try {
      await Promise.all([...document.images].map(image => image.decode ? image.decode() : Promise.resolve()));
      window.print();
    } catch { setError('Could not load report images. Wait for captured evidence to load, then try Print view again.'); }
  };
  const exportJson = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = `system-test-${assessment.id}.json`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return <div className="mx-auto max-w-6xl space-y-6 p-4 text-[var(--color-text)] sm:p-8">
    <style>{`@media print { .system-report-actions { display:none!important; } body { background:white!important; } }`}</style>
    <div className="system-report-actions flex flex-wrap items-center justify-between gap-3"><button type="button" onClick={onBack} className="text-sm underline">Back to tests</button><div className="flex gap-4 text-sm"><button type="button" disabled={busy || !report} onClick={download}>{busy ? 'Exporting...' : 'Download PDF'}</button><button type="button" disabled={!report} onClick={exportJson}>Export JSON</button><button type="button" onClick={print}>Print view</button></div></div>
    {error && <p role="alert" className="text-sm text-rose-600">{error} <button type="button" className="underline" onClick={download}>Retry</button></p>}
    <header className="border-b border-[var(--color-border)] pb-6"><p className="text-xs font-semibold uppercase tracking-widest text-[var(--color-primary)]">CovAI / System Test</p><h1 className="mt-2 text-3xl font-semibold tracking-tight">Execution report</h1><p className="mt-3 break-all text-xs text-[var(--color-text-muted)]">Assessment {assessment?.id || 'Not selected'} / {assessment?.executionMode === 'full' ? 'Full Stack' : 'Frontend'} / {formatReportDate(assessment?.createdAt)}</p>{report && <p className="mt-2 break-all font-mono text-[10px] text-[var(--color-text-muted)]">Source {report.identity.sourceHash} / Tests {report.identity.testHash}</p>}</header>
    {!report ? <p>No completed assessment is available for this selection. Run the selected tests first.</p> : <>
      <div className="grid gap-4 sm:grid-cols-3">{[['Passed scenarios', `${report.execution.passed}/${report.execution.selected}`], ['Repeat evidence', `${report.stability.completedRuns}/${report.stability.requiredRuns} runs / ${report.stability.status.replaceAll('_', ' ').toLowerCase()}`], ['Suite quality', report.qualityScore.status === 'CALCULATED' ? `${report.qualityScore.value}/100` : 'Not calculated']].map(([label, value]) => <article key={label} className="rounded-xl bg-[var(--color-surface-secondary)] p-5"><h2 className="text-xs text-[var(--color-text-muted)]">{label}</h2><p className="mt-2 text-xl font-semibold tabular-nums">{value}</p></article>)}</div>
      <p className="break-all text-xs text-[var(--color-text-muted)]">Snapshot: {report.identity.snapshotId} / Test version: {report.identity.suiteVersionId || 'Not recorded'} / Runtime: {Number.isFinite(report.execution.elapsedMs) ? `${(report.execution.elapsedMs / 1000).toFixed(1)}s` : 'Not measured'}</p>
      {report.qualityScore.status === 'CALCULATED' && <details className="text-xs"><summary className="cursor-pointer">How the quality score is calculated</summary><p className="mt-2">Requirements (40), assertion strength (25), repeat stability (20), captured evidence (15).</p><dl className="mt-2 space-y-1">{Object.entries(report.qualityScore.components || {}).map(([key,value]) => <div key={key} className="flex max-w-xs justify-between gap-4"><dt className="capitalize">{key}</dt><dd>{Number(value).toFixed(1)}</dd></div>)}</dl></details>}
      <SystemTestReportCharts report={report} />
      <SystemTestDimensionsTable assessment={{ presentation: report }} />
      {report.comparison?.comparable && <SystemTestCoverageComparison changes={report.comparison.coverageChanges} />}
      <section><h2 className="mb-4 text-lg font-semibold">Scenario evidence</h2><SystemTestScenarioLibrary presentation={report} /></section>
      <section><h2 className="mb-3 text-lg font-semibold">Next actions</h2>{report.gaps.length ? <ul className="space-y-3 text-sm">{report.gaps.map((gap, index) => <li key={gap.id || index} className="border-l-2 border-amber-500 pl-3"><p>{gap.description}</p><p className="mt-1 text-xs text-[var(--color-text-muted)]">{gap.nextAction || gap.filePath || gap.criterionId}</p></li>)}</ul> : <p className="text-sm text-[var(--color-text-muted)]">No findings recorded. This does not prove complete business coverage.</p>}</section>
      <footer className="border-t border-[var(--color-border)] pt-4 text-xs text-[var(--color-text-muted)]">{report.limitations.map((item, index) => <p key={index} className="mt-1">{item}</p>)}</footer>
    </>}
  </div>;
}
