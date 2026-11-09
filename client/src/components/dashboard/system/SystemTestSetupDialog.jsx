import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  ChevronRight,
  Download,
  FileCode2,
  Loader2,
  RotateCcw,
  Settings2,
  X,
} from 'lucide-react';
import { useProjectAccess } from '../../../hooks/useProjectAccess';
import { systemEvidenceRequest } from '../../../services/systemTest.service.js';

const statusLabel = {
  MISSING: 'Required to start',
  PRESENT: 'Present · not validated',
  MAY_BE_NEEDED: 'May be needed',
  MANAGED: 'Managed by CovAI',
};

const statusBadgeStyle = {
  MISSING:
    'border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300',
  PRESENT:
    'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  MAY_BE_NEEDED:
    'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300',
};

const databaseEngineLabel = {
  mysql: 'MySQL',
  postgres: 'PostgreSQL',
  sqlite: 'SQLite',
  mongodb: 'MongoDB',
};

const failureMessage = (error) =>
  error.response?.data?.message ||
  error.message ||
  'Could not check project setup.';

export default function SystemTestSetupDialog({
  projectId,
  snapshotId,
  onClose,
  onChanged,
  onStatus,
  onReady,
  onGenerate,
  runtimeMessage,
}) {
  const dialog = useRef(null);
  const request = useRef(null);
  const edited = useRef(false);
  const readyCallback = useRef(onReady);
  useEffect(() => { readyCallback.current = onReady; }, [onReady]);
  const access = useProjectAccess(projectId);

  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [configEdited, setConfigEdited] = useState(false);
  const [configText, setConfigText] = useState('');
  const [reviewed, setReviewed] = useState(false);
  const [environmentValues, setEnvironmentValues] = useState({});

  const load = useCallback(async () => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    setError('');
    setReviewed(false);
    try {
      const data = await systemEvidenceRequest(snapshotId, 'setup', {
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      setReport(data);
      onStatus?.(data);
      if (data.ready) readyCallback.current?.(data);
      if (!edited.current) {
        setConfigText(
          data.candidateConfig
            ? JSON.stringify(data.candidateConfig, null, 2)
            : ''
        );
      }
    } catch (err) {
      if (!controller.signal.aborted) setError(failureMessage(err));
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [snapshotId, onStatus]);

  useEffect(() => {
    const element = dialog.current;
    const previous = document.activeElement;
    element.showModal();
    Promise.resolve().then(load);
    return () => {
      request.current?.abort();
      element.close();
      previous?.focus();
    };
  }, [load]);

  const apply = async () => {
    let config;
    try {
      config = JSON.parse(configText);
    } catch {
      setError(
        'Startup setup must be valid JSON. Review the configuration and try again.'
      );
      return;
    }
    setSaving(true);
    setError('');
    try {
      await systemEvidenceRequest(snapshotId, 'setup/apply', {
        method: 'POST',
        data: {
          config,
          reviewed,
          expectedWorkspaceRevision: report.workspaceRevision,
          expectedSourceHash: report.sourceHash,
          expectedSetupHash: report.setupHash,
        },
      });
      edited.current = false;
      setConfigEdited(false);
      onChanged?.();
      await load();
    } catch (err) {
      setError(failureMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const downloadTemplate = () => {
    const groups = new Map();
    for (const row of report.environment.filter(
      (item) => item.status !== 'MANAGED'
    )) {
      if (!groups.has(row.envFile)) groups.set(row.envFile, new Set());
      groups.get(row.envFile).add(row.name);
    }
    const content = [...groups]
      .map(
        ([file, names]) =>
          `# ${file}\n${[...names].map((name) => `${name}=`).join('\n')}`
      )
      .join('\n\n');
    const url = URL.createObjectURL(
      new Blob([content], { type: 'text/plain' })
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = 'system-test-env-template.txt';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const saveEnvironment = async () => {
    const variables=report.environment.filter(row=>row.required && row.status!=='MANAGED' && environmentValues[`${row.envFile}:${row.name}`]?.trim()).map(row=>({envFile:row.envFile,name:row.name,value:environmentValues[`${row.envFile}:${row.name}`]}));
    if(!variables.length)return;
    setSaving(true);setError('');
    try {
      await systemEvidenceRequest(snapshotId,'setup/environment',{method:'POST',data:{expectedWorkspaceRevision:report.workspaceRevision,variables}});
      setEnvironmentValues({});
      await load();
    } catch(err) {setError(failureMessage(err));}
    finally {setSaving(false);}
  };

  const external =
    report?.environment.filter((row) => row.status !== 'MANAGED') || [];
  const managed =
    report?.environment.filter((row) => row.status === 'MANAGED') || [];
  const showSetupEditor =
    Boolean(report) &&
    report.status !== 'UNSUPPORTED' &&
    (!report.candidateConfig || report.issues.some(issue=>['INVALID_SETUP','START_SCRIPT_REQUIRED','SCHEMA_REQUIRED','SETUP_REQUIRED'].includes(issue.code)) || configEdited);

  const dockerStatusLabel =
    report?.docker.status === 'AVAILABLE'
      ? 'Available'
      : report?.docker.status === 'NOT_REQUIRED'
      ? 'Not required'
      : report?.docker.status === 'UNAVAILABLE'
      ? 'Start Docker Desktop on the server'
      : 'Not checked';

  return (
    <dialog
      ref={dialog}
      aria-labelledby="system-setup-heading"
      onCancel={(event) => {
        event.preventDefault();
        if (!saving) onClose();
      }}
      className="m-auto max-h-[90vh] w-[min(920px,94vw)] overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] p-0 text-[var(--color-text)] shadow-2xl backdrop:bg-black/65 font-sans"
    >
      <div className="flex max-h-[90vh] flex-col">
        {/* Header */}
        <header className="flex items-start justify-between gap-4 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-6 py-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2.5">
              <h2
                id="system-setup-heading"
                className="text-base font-semibold tracking-tight text-[var(--color-text)]"
              >
                System Test setup
              </h2>
              {!loading && report && (
                <span
                  className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[11px] font-medium ${
                    report.ready
                      ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                      : 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300'
                  }`}
                >
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${
                      report.ready ? 'bg-emerald-500' : 'bg-amber-500'
                    }`}
                  />
                  {report.ready
                    ? report.configured
                      ? 'Ready · Configured'
                      : 'Ready · Auto-detected'
                    : report.status === 'UNSUPPORTED'
                    ? 'Unsupported stack'
                    : 'Action required'}
                </span>
              )}
            </div>
            <p className="mt-1 text-xs text-[var(--color-text-muted)]">
              Check startup services and test credentials before running.
            </p>
          </div>
          <button
            type="button"
            disabled={saving}
            onClick={onClose}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-2.5 text-xs font-medium text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-secondary)] hover:text-[var(--color-text)] transition-colors cursor-pointer disabled:opacity-50"
          >
            <X size={14} />
            <span>Close</span>
          </button>
        </header>

        {/* Scrollable Body */}
        <div className="flex-1 space-y-6 overflow-y-auto px-6 py-5">
          {error && (
            <div
              role="alert"
              className="flex items-start gap-2.5 rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-xs text-rose-700 dark:text-rose-300"
            >
              <AlertCircle size={15} className="mt-0.5 shrink-0" />
              <span className="leading-5">{error}</span>
            </div>
          )}

          {loading ? (
            <div
              role="status"
              className="flex items-center justify-center gap-2.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] py-12 text-xs text-[var(--color-text-secondary)]"
            >
              <Loader2 size={16} className="animate-spin text-[var(--color-primary)]" />
              <span>Checking project setup...</span>
            </div>
          ) : (
            report && (
              <>
                {/* Readiness Summary Callout */}
                <section
                  className={`rounded-lg border border-l-4 px-4 py-3.5 ${
                    report.ready
                      ? 'border-[var(--color-border)] border-l-emerald-500 bg-[var(--color-surface)]'
                      : 'border-amber-500/30 border-l-amber-500 bg-amber-500/[0.04]'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    {report.ready ? (
                      <CheckCircle2
                        size={16}
                        className="mt-0.5 shrink-0 text-emerald-600 dark:text-emerald-400"
                      />
                    ) : (
                      <AlertCircle
                        size={16}
                        className="mt-0.5 shrink-0 text-amber-600 dark:text-amber-400"
                      />
                    )}
                    <div className="min-w-0 flex-1">
                      <h3 className="text-xs font-semibold text-[var(--color-text)]">
                        {report.ready
                          ? 'Startup checks passed'
                          : report.status === 'UNSUPPORTED'
                          ? 'Runtime adapter required'
                          : 'Setup needs attention'}
                      </h3>
                      {report.issues.length > 0 && (
                        <ul className="mt-1.5 space-y-1 text-xs leading-5 text-[var(--color-text-secondary)]">
                          {report.issues.map((item, index) => (
                            <li key={`${item.code}:${index}`}>{item.message}</li>
                          ))}
                        </ul>
                      )}
                      {report.ready && (
                        <p className="mt-1 text-xs leading-5 text-[var(--color-text-secondary)]">
                          {report.configured
                            ? 'You can return to the scenarios and run tests. Application startup and provider validity are checked during the run.'
                            : 'Startup services were resolved automatically from the repository. You can run tests directly without manual configuration, or customize the setup below.'}
                        </p>
                      )}
                    </div>
                  </div>
                </section>

                {/* Section 1: Application services */}
                <section className="space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-secondary)]">
                        Application services
                      </h3>
                      {report.services && (
                        <span className="rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--color-text-muted)]">
                          {report.configured
                            ? '.covai/system-test.json'
                            : 'Auto-detected'}
                        </span>
                      )}
                    </div>
                    {report.status !== 'UNSUPPORTED' &&
                      (report.configured || report.candidateConfig) && (
                        <button
                          type="button"
                          onClick={() => setConfigEdited((prev) => !prev)}
                          className="inline-flex items-center gap-1.5 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1 text-xs font-medium text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-secondary)] hover:text-[var(--color-text)] transition-colors cursor-pointer"
                        >
                          <Settings2 size={12} />
                          <span>
                            {configEdited
                              ? 'Hide setup editor'
                              : 'Edit startup setup'}
                          </span>
                        </button>
                      )}
                  </div>

                  <div className="overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]">
                    {report.services ? (
                      <dl className="grid grid-cols-1 divide-y divide-[var(--color-border)] text-xs sm:grid-cols-3 sm:divide-x sm:divide-y-0">
                        <div className="p-3.5">
                          <dt className="text-[11px] font-medium text-[var(--color-text-muted)]">
                            Frontend directory
                          </dt>
                          <dd className="mt-1 flex items-center gap-1.5 font-mono font-medium text-[var(--color-text)]">
                            <span>{report.services.frontend}</span>
                          </dd>
                          <p className="mt-1 text-[11px] text-[var(--color-text-muted)]">
                            {report.services.topology}
                          </p>
                        </div>

                        <div className="p-3.5">
                          <dt className="text-[11px] font-medium text-[var(--color-text-muted)]">
                            Backend service
                          </dt>
                          <dd className="mt-1 font-mono font-medium text-[var(--color-text)]">
                            {report.services.backend}
                          </dd>
                          <p className="mt-1 text-[11px] text-[var(--color-text-muted)]">
                            Readiness:{' '}
                            <code className="font-mono text-[var(--color-text-secondary)]">
                              {report.services.healthPath || '/'}
                            </code>
                          </p>
                        </div>

                        <div className="p-3.5">
                          <dt className="text-[11px] font-medium text-[var(--color-text-muted)]">
                            Isolated data &amp; runtime
                          </dt>
                          <dd className="mt-1 font-medium text-[var(--color-text)]">
                            {databaseEngineLabel[report.services.database] ||
                              report.services.database}
                            {report.services.redis ? ' + Redis' : ''}
                          </dd>
                          <p className="mt-1 flex items-center gap-1.5 text-[11px] text-[var(--color-text-muted)]">
                            <span
                              className={`h-1.5 w-1.5 rounded-full ${
                                report.docker.status === 'AVAILABLE'
                                  ? 'bg-emerald-500'
                                  : report.docker.status === 'UNAVAILABLE'
                                  ? 'bg-amber-500'
                                  : 'bg-slate-400'
                              }`}
                            />
                            <span>Docker: {dockerStatusLabel}</span>
                          </p>
                        </div>
                      </dl>
                    ) : (
                      <div className="px-4 py-3.5 text-xs text-[var(--color-text-secondary)]">
                        Choose a startup setup for the detected application.
                      </div>
                    )}

                    {!!report.packages.length && (
                      <details className="group border-t border-[var(--color-border)] bg-[var(--color-bg)]/50 text-xs">
                        <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-2.5 font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-text)] select-none">
                          <span>
                            Detected packages ({report.packages.length})
                          </span>
                          <ChevronRight
                            size={14}
                            className="transition-transform duration-150 group-open:rotate-90 text-[var(--color-text-muted)]"
                          />
                        </summary>
                        <ul className="divide-y divide-[var(--color-border)] border-t border-[var(--color-border)] bg-[var(--color-bg)]">
                          {report.packages.map((pkg) => (
                            <li
                              key={pkg.directory}
                              className="flex flex-wrap items-center justify-between gap-2 px-4 py-2"
                            >
                              <code className="font-mono text-[11px] text-[var(--color-text)]">
                                {pkg.directory === '.'
                                  ? 'package.json'
                                  : `${pkg.directory}/package.json`}
                              </code>
                              <div className="flex flex-wrap items-center gap-1.5">
                                {pkg.startScripts.length ? (
                                  pkg.startScripts.map((script) => (
                                    <span
                                      key={script}
                                      className="rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--color-text-secondary)]"
                                    >
                                      npm run {script}
                                    </span>
                                  ))
                                ) : (
                                  <span className="text-[11px] text-[var(--color-text-muted)]">
                                    No supported start script
                                  </span>
                                )}
                              </div>
                            </li>
                          ))}
                        </ul>
                      </details>
                    )}
                  </div>
                </section>

                {/* Section 2: Test environment */}
                <section className="space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-secondary)]">
                        Test environment
                      </h3>
                      <span className="rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--color-text-muted)]">
                        {external.length
                          ? `${external.length} external`
                          : '0 external'}
                      </span>
                    </div>
                    {!!external.length && (
                      <button
                        type="button"
                        onClick={downloadTemplate}
                        className="inline-flex items-center gap-1.5 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1 text-xs font-medium text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-secondary)] hover:text-[var(--color-text)] transition-colors cursor-pointer"
                      >
                        <Download size={12} />
                        <span>Download variable template</span>
                      </button>
                    )}
                  </div>

                  <p className="text-xs leading-5 text-[var(--color-text-secondary)]">
                    Add test or sandbox values to the listed{' '}
                    <code className="rounded bg-[var(--color-surface-secondary)] px-1 py-0.5 font-mono text-[11px]">
                      .env.test
                    </code>{' '}
                    file in the imported project, or enter required values below.
                    Saved values are never returned here or sent to setup AI.
                  </p>

                  <div className="overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]">
                    {external.length ? (
                      <div className="max-h-72 overflow-auto">
                        <table className="w-full min-w-[580px] border-collapse text-left text-xs">
                          <thead className="sticky top-0 border-b border-[var(--color-border)] bg-[var(--color-surface-secondary)] text-[11px] font-semibold text-[var(--color-text-secondary)]">
                            <tr>
                              {[
                                'Variable / purpose',
                                'Service',
                                'Status',
                                'Where to configure',
                              ].map((title) => (
                                <th
                                  key={title}
                                  scope="col"
                                  className="px-4 py-2.5 font-medium"
                                >
                                  {title}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-[var(--color-border)] bg-[var(--color-bg)]">
                            {external.map((row) => (
                              <tr
                                key={`${row.envFile}:${row.name}`}
                                className="align-top"
                              >
                                <th
                                  scope="row"
                                  className="max-w-xs px-4 py-3 font-normal"
                                >
                                  <code className="break-all font-mono text-xs font-semibold text-[var(--color-text)]">
                                    {row.name}
                                  </code>
                                  {row.sourceFiles?.length > 0 && (
                                    <p className="mt-0.5 font-mono text-[10px] text-[var(--color-text-muted)]">
                                      {row.sourceFiles.join(', ')}
                                    </p>
                                  )}
                                  {row.required && (
                                    <p className="mt-1 text-[11px] text-[var(--color-text-secondary)]">
                                      {row.purpose}
                                    </p>
                                  )}
                                </th>
                                <td className="px-4 py-3 text-[var(--color-text-secondary)]">
                                  {row.service}
                                </td>
                                <td className="px-4 py-3">
                                  <span
                                    className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-medium ${
                                      statusBadgeStyle[row.status] ||
                                      statusBadgeStyle.MAY_BE_NEEDED
                                    }`}
                                  >
                                    {statusLabel[row.status]}
                                  </span>
                                </td>
                                <td className="px-4 py-3">
                                  <code className="break-all font-mono text-[11px] font-medium text-[var(--color-text)]">
                                    {row.envFile}
                                  </code>
                                  <p className="mt-0.5 text-[11px] text-[var(--color-text-muted)]">
                                    {row.guidance}
                                  </p>
                                  {row.required && access.can('evidence.approve') && <input type="password" autoComplete="new-password" aria-label={`Test value for ${row.name} in ${row.envFile}`} value={environmentValues[`${row.envFile}:${row.name}`] || ''} disabled={saving} onChange={event=>setEnvironmentValues(values=>({...values,[`${row.envFile}:${row.name}`]:event.target.value}))} placeholder="Enter test or sandbox value" className="mt-2 w-full rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1.5 text-xs" />}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2.5 px-4 py-3 text-xs text-[var(--color-text-secondary)]">
                        <CheckCircle2
                          size={14}
                          className="shrink-0 text-emerald-600 dark:text-emerald-400"
                        />
                        <span>
                          No external credential requirements were found in the
                          inspected source.
                        </span>
                      </div>
                    )}

                    {!!managed.length && (
                      <details className="group border-t border-[var(--color-border)] bg-[var(--color-bg)]/50 text-xs">
                        <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-2.5 font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-text)] select-none">
                          <span>
                            Automatically managed settings ({managed.length})
                          </span>
                          <ChevronRight
                            size={14}
                            className="transition-transform duration-150 group-open:rotate-90 text-[var(--color-text-muted)]"
                          />
                        </summary>
                        <div className="border-t border-[var(--color-border)] bg-[var(--color-bg)] px-4 py-3">
                          <p className="mb-2 text-[11px] text-[var(--color-text-muted)]">
                            Provided automatically by CovAI for isolated
                            containers and local test ports:
                          </p>
                          <ul className="flex flex-wrap gap-1.5">
                            {managed.map((row) => (
                              <li
                                key={`${row.envFile}:${row.name}`}
                                className="inline-flex items-center gap-1.5 rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 font-mono text-[11px] text-[var(--color-text)]"
                                title={`${row.envFile} — isolated runtime value`}
                              >
                                <code>{row.name}</code>
                                <span className="text-[10px] font-sans text-[var(--color-text-muted)]">
                                  isolated
                                </span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      </details>
                    )}
                  </div>
                  {Object.values(environmentValues).some(value=>value.trim()) && <button type="button" disabled={loading || saving || !access.can('evidence.approve')} onClick={saveEnvironment} className="rounded-md bg-[var(--color-primary)] px-3 py-2 text-xs font-medium text-white disabled:opacity-40">{saving?'Saving test values...':'Save test environment'}</button>}
                </section>

                {/* Section 3: Review startup setup */}
                {showSetupEditor && (
                  <section className="space-y-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <h3 className="flex items-center gap-1.5 text-xs font-semibold text-[var(--color-text)]">
                          <FileCode2 size={14} className="text-[var(--color-text-muted)]" />
                          <span>Review startup setup</span>
                        </h3>
                        <p className="mt-0.5 text-xs text-[var(--color-text-secondary)]">
                          Apply detected paths to pin configuration in{' '}
                          <code className="font-mono text-[11px]">
                            .covai/system-test.json
                          </code>
                          . Put credentials in{' '}
                          <code className="font-mono text-[11px]">
                            .env.test
                          </code>
                          , never in this JSON.
                        </p>
                      </div>
                      {report.candidateConfig &&
                        configText !==
                          JSON.stringify(report.candidateConfig, null, 2) && (
                          <button
                            type="button"
                            onClick={() => {
                              edited.current = false;
                              setConfigText(
                                JSON.stringify(report.candidateConfig, null, 2)
                              );
                              setReviewed(false);
                            }}
                            className="text-xs text-[var(--color-text-secondary)] underline hover:text-[var(--color-text)] cursor-pointer"
                          >
                            Reset to detected
                          </button>
                        )}
                    </div>

                    <details open>
                      <summary className="cursor-pointer text-xs font-medium text-[var(--color-text-secondary)] select-none">
                        Startup configuration JSON
                      </summary>
                      <textarea
                        aria-label="Startup configuration JSON"
                        rows={8}
                        value={configText}
                        onChange={(event) => {
                          edited.current = true;
                          setConfigEdited(true);
                          setConfigText(event.target.value);
                          setReviewed(false);
                        }}
                        placeholder={'{\n  "frontend": { "directory": "client" },\n  "backend": { "directory": "server", "healthPath": "/api/health" },\n  "database": { "engine": "mysql", "initSql": ".covai/generated-schema.sql" }\n}'}
                        className="mt-2 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] p-3 font-mono text-xs leading-5 text-[var(--color-text)] focus:border-[var(--color-primary)] focus:outline-none"
                      />
                    </details>

                    <label className="flex cursor-pointer items-center gap-2.5 text-xs text-[var(--color-text-secondary)] select-none">
                      <input
                        type="checkbox"
                        checked={reviewed}
                        onChange={(event) => setReviewed(event.target.checked)}
                        className="h-3.5 w-3.5 rounded accent-[var(--color-primary)] cursor-pointer"
                      />
                      <span>
                        I reviewed the startup directories, services and schema
                        paths.
                      </span>
                    </label>

                    <div className="flex flex-wrap items-center gap-2.5 pt-1">
                      <button
                        type="button"
                        disabled={
                          saving ||
                          !reviewed ||
                          !configText.trim() ||
                          !access.can('evidence.approve')
                        }
                        onClick={apply}
                        className="rounded-md bg-[var(--color-primary)] px-3.5 py-1.5 text-xs font-semibold text-[var(--color-primary-foreground)] hover:opacity-90 transition-opacity cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        {saving ? 'Saving setup...' : 'Apply startup setup'}
                      </button>
                      <button
                        type="button"
                        disabled={saving || !access.can('ai.use')}
                        onClick={onGenerate}
                        className="rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3.5 py-1.5 text-xs font-medium text-[var(--color-text)] hover:bg-[var(--color-surface-secondary)] transition-colors cursor-pointer disabled:opacity-40"
                      >
                        Generate test and setup draft
                      </button>
                    </div>

                    {!access.can('evidence.approve') && (
                      <p className="text-xs text-[var(--color-text-muted)]">
                        Evidence approval permission is required to change
                        startup setup.
                      </p>
                    )}
                  </section>
                )}

                {runtimeMessage && (
                  <details className="group rounded-lg border border-rose-500/30 bg-rose-500/[0.04] px-4 py-3 text-xs">
                    <summary className="flex cursor-pointer list-none items-center justify-between font-medium text-rose-700 dark:text-rose-300 select-none">
                      <span>Last execution message</span>
                      <ChevronRight
                        size={14}
                        className="transition-transform duration-150 group-open:rotate-90"
                      />
                    </summary>
                    <p className="mt-2 leading-5 text-[var(--color-text-secondary)]">
                      The previous run could not start or complete. Review the
                      requirements above; if they are present, inspect the job
                      log for provider or application errors.
                    </p>
                  </details>
                )}

                <details className="group rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]/50 px-4 py-2.5 text-xs text-[var(--color-text-muted)]">
                  <summary className="flex cursor-pointer list-none items-center justify-between font-medium select-none hover:text-[var(--color-text-secondary)]">
                    <span>What these checks cover</span>
                    <ChevronRight
                      size={14}
                      className="transition-transform duration-150 group-open:rotate-90"
                    />
                  </summary>
                  <div className="mt-2 space-y-1.5 border-t border-[var(--color-border)] pt-2 leading-5">
                    {report.limitations.map((item) => (
                      <p key={item}>{item}</p>
                    ))}
                  </div>
                </details>
              </>
            )
          )}
        </div>

        {/* Footer */}
        <footer className="flex items-center justify-between gap-3 border-t border-[var(--color-border)] bg-[var(--color-surface)] px-6 py-3.5">
          <span className="text-[11px] text-[var(--color-text-muted)]">
            Static preflight · Secrets in .env.test stay local to the test runner
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={loading || saving}
              onClick={load}
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 text-xs font-medium text-[var(--color-text)] hover:bg-[var(--color-surface-secondary)] transition-colors cursor-pointer disabled:opacity-40"
            >
              <RotateCcw size={13} />
              <span>Check again</span>
            </button>
          </div>
        </footer>
      </div>
    </dialog>
  );
}
