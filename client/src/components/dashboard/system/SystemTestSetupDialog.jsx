import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  ChevronRight,
  Database,
  FileCode2,
  Loader2,
  Lock,
  Monitor,
  RotateCcw,
  Server,
  X,
} from 'lucide-react';
import { Button } from '../../ui/button.jsx';
import { useProjectAccess } from '../../../hooks/useProjectAccess';
import { systemEvidenceRequest } from '../../../services/systemTest.service.js';
import ExternalServicesPanel from './ExternalServicesPanel.jsx';

const buttonMotion = 'transition-colors duration-150 active:scale-[0.98] focus-visible:ring-2 focus-visible:ring-[var(--color-focus)]/40';
const warningTone = 'bg-amber-500/10 text-amber-400 border border-amber-500/20';
const errorTone = 'bg-rose-500/10 text-rose-400 border border-rose-500/20';

const databaseEngineLabel = {
  mysql: 'MySQL',
  postgres: 'PostgreSQL',
  sqlite: 'SQLite',
  mongodb: 'MongoDB',
  none: 'Not needed',
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
  focusServiceId,
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
  const [editorOpen, setEditorOpen] = useState(false);
  const [configText, setConfigText] = useState('');
  const [reviewed, setReviewed] = useState(false);

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
      setEditorOpen(false);
      onChanged?.();
      await load();
    } catch (err) {
      setError(failureMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const forgetKeys = async (removeLegacyFiles = false) => {
    setSaving(true);
    setError('');
    try {
      await systemEvidenceRequest(snapshotId, 'setup/environment', {
        method: 'DELETE',
        data: {
          expectedWorkspaceRevision: report.workspaceRevision,
          ...(removeLegacyFiles && { removeLegacyFiles: true }),
        },
      });
      onChanged?.();
      await load();
    } catch (err) {
      setError(err.response?.data?.message || 'Could not remove test keys. Try again.');
    } finally {
      setSaving(false);
    }
  };

  const otherVariables = report?.environment.filter(row => row.status !== 'MANAGED' && !row.provider) ?? [];
  const managed = report?.environment.filter(row => row.status === 'MANAGED') ?? [];
  const canEditStartup = Boolean(report && report.status !== 'UNSUPPORTED');
  const canEditKeys = access.can('evidence.approve');
  const needsKeys = report?.externalServices?.some(service => ['NEEDS_CONFIG', 'HARDCODED'].includes(service.status));
  const statusLabel = report?.status === 'UNSUPPORTED' ? 'Unsupported stack'
    : needsKeys ? 'Needs keys'
    : report?.ready ? 'Ready' : 'Action required';
  const runtimeAvailable = ['AVAILABLE', 'NOT_REQUIRED'].includes(report?.docker?.status);
  const runtimeReason = report?.docker?.status === 'UNAVAILABLE' ? 'Start Docker' : 'Runtime unchecked';
  const legacyFiles = report?.secrets?.legacyFiles ?? [];
  const services = report?.services;
  // "." means the package sits at the repository root; show that in words.
  const folderLabel = directory => (directory === '.' ? 'Root folder' : directory);
  const apiOnly = services?.topology === 'API application';
  const appTiles = [
    { Icon: Monitor, label: 'Frontend', value: apiOnly || !services?.frontend ? 'None (API only)' : folderLabel(services.frontend) },
    { Icon: Server, label: 'Backend', value: services?.backend ? folderLabel(services.backend) : 'Not detected' },
    { Icon: Database, label: 'Database', value: databaseEngineLabel[services?.database] || services?.database || 'Not needed' },
  ];

  return (
    <dialog
      ref={dialog}
      aria-labelledby="system-setup-heading"
      onCancel={(event) => {
        event.preventDefault();
        if (!saving) onClose();
      }}
      className="m-auto max-h-[90vh] w-[min(920px,94vw)] overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] p-0 text-[var(--color-text)] backdrop:bg-black/65 font-sans"
    >
      <div className="flex max-h-[90vh] flex-col">
        {/* Header */}
        <header className="flex items-center justify-between gap-4 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-6 py-4">
          <div className="flex min-w-0 flex-wrap items-center gap-2.5">
            <h2 id="system-setup-heading" className="text-base font-semibold">Test setup</h2>
            {!loading && report && (
              <span className={`inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[11px] font-medium ${statusLabel === 'Ready'
                ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                : warningTone}`}>
                <span className={`size-1.5 rounded-full ${statusLabel === 'Ready' ? 'bg-emerald-500' : 'bg-amber-500'}`} />
                {statusLabel}
              </span>
            )}
          </div>
          <Button type="button" variant="ghost" size="icon-sm" aria-label="Close" disabled={saving} onClick={onClose} className={buttonMotion}>
            <X />
          </Button>
        </header>

        {/* Scrollable Body */}
        <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
          {error && (
            <div
              role="alert"
              className={`flex items-start gap-2.5 rounded-lg px-4 py-3 text-xs ${errorTone}`}
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
                {/* Setup problems */}
                {!report.ready && (
                  <div role="alert" className={`flex items-start gap-2 rounded-lg px-3 py-2 text-xs ${warningTone}`}>
                    <AlertCircle size={15} className="mt-0.5 shrink-0" />
                    {report.issues.length ? (
                      <ul className="space-y-1">
                        {report.issues.map((item, index) => (
                          <li key={`${item.code}:${index}`}>{item.message}</li>
                        ))}
                      </ul>
                    ) : <span>{statusLabel}</span>}
                  </div>
                )}
                {runtimeMessage && (
                  <p role="alert" className={`rounded-md px-3 py-2 text-xs ${errorTone}`}>
                    Last run couldn't start. Check the items below, then run again.
                  </p>
                )}

                {/* App */}
                <section className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-sm font-semibold">App</h3>
                    {canEditStartup && (
                      <Button type="button" variant="ghost" size="sm" aria-expanded={editorOpen} onClick={() => setEditorOpen(open => !open)} className={buttonMotion}>
                        {editorOpen ? 'Done editing' : 'Edit'}
                      </Button>
                    )}
                  </div>
                  <dl className="grid divide-y divide-[var(--color-border)] rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] text-xs sm:grid-cols-3 sm:divide-x sm:divide-y-0">
                    {appTiles.map(({ Icon, label, value }) => (
                      <div key={label} className="min-w-0 p-3">
                        <dt className="flex items-center gap-1.5 text-[var(--color-text-muted)]">
                          <Icon size={14} aria-hidden="true" /> {label}
                        </dt>
                        <dd className="mt-1 break-words font-mono tabular-nums">{value}</dd>
                        {label === 'Database' && (
                          <dd className="mt-1 flex items-center gap-1.5 text-[11px] text-[var(--color-text-muted)]">
                            <span className={`size-1.5 shrink-0 rounded-full ${runtimeAvailable ? 'bg-emerald-500' : 'bg-amber-500'}`} aria-hidden="true" />
                            {runtimeAvailable ? 'Runtime available' : runtimeReason}
                          </dd>
                        )}
                      </div>
                    ))}
                  </dl>
                  {!!(report.packages.length || managed.length) && (
                    <details className="group rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] text-xs">
                      <summary className="flex cursor-pointer list-none items-center justify-between px-3 py-2 font-medium text-[var(--color-text-secondary)]">
                        Details
                        <ChevronRight size={14} className="transition-transform duration-150 group-open:rotate-90" />
                      </summary>
                      {!!report.packages.length && (
                        <div className="border-t border-[var(--color-border)]">
                          <h4 className="px-4 py-2 font-medium">Detected packages</h4>
                          <ul className="divide-y divide-[var(--color-border)] border-t border-[var(--color-border)] bg-[var(--color-bg)]">
                            {report.packages.map((pkg) => (
                              <li
                                key={pkg.directory}
                                className="flex flex-wrap items-center justify-between gap-2 px-4 py-2"
                              >
                                <code className="font-mono tabular-nums text-[11px] text-[var(--color-text)]">
                                  {pkg.directory === '.'
                                    ? 'package.json'
                                    : `${pkg.directory}/package.json`}
                                </code>
                                <div className="flex flex-wrap items-center gap-1.5">
                                  {pkg.startScripts.length ? (
                                    pkg.startScripts.map((script) => (
                                      <span
                                        key={script}
                                        className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-1.5 py-0.5 font-mono tabular-nums text-[10px] text-[var(--color-text-secondary)]"
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
                        </div>
                      )}
                      {!!managed.length && (
                        <div>
                          <h4 className="border-t border-[var(--color-border)] px-4 py-2 font-medium">Automatically managed settings</h4>
                          <div className="border-t border-[var(--color-border)] bg-[var(--color-bg)] px-4 py-3">
                            <p className="mb-2 text-[11px] text-[var(--color-text-muted)]">
                              Provided automatically by CovAI for isolated
                              containers and local test ports:
                            </p>
                            <ul className="flex flex-wrap gap-1.5">
                              {managed.map((row) => (
                                <li
                                  key={`${row.envFile}:${row.name}`}
                                  className="inline-flex items-center gap-1.5 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 font-mono tabular-nums text-[11px] text-[var(--color-text)]"
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
                        </div>
                      )}
                    </details>
                  )}
                </section>

                {/* Section 3: Review startup setup */}
                {canEditStartup && editorOpen && (
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
                          . Add credentials under Keys.
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
                            className={`rounded-md text-xs text-[var(--color-text-secondary)] underline hover:text-[var(--color-text)] cursor-pointer ${buttonMotion}`}
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
                        className="h-3.5 w-3.5 rounded-md accent-[var(--color-primary)] cursor-pointer"
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
                        className={`rounded-md bg-[var(--color-primary)] px-3.5 py-1.5 text-xs font-semibold text-[var(--color-primary-foreground)] hover:opacity-90 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${buttonMotion}`}
                      >
                        {saving ? 'Saving setup...' : 'Apply startup setup'}
                      </button>
                      <button
                        type="button"
                        disabled={saving || !access.can('ai.use')}
                        onClick={onGenerate}
                        className={`rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3.5 py-1.5 text-xs font-medium text-[var(--color-text)] hover:bg-[var(--color-surface-secondary)] cursor-pointer disabled:opacity-40 ${buttonMotion}`}
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

                {/* Keys */}
                <ExternalServicesPanel
                  snapshotId={snapshotId}
                  revision={report.workspaceRevision}
                  services={report.externalServices ?? []}
                  otherVariables={otherVariables}
                  secrets={report.secrets}
                  focusServiceId={focusServiceId}
                  canEdit={canEditKeys}
                  disabled={saving}
                  onSaved={async () => { onChanged?.(); await load(); }}
                  onForget={() => forgetKeys()}
                />
                {!!legacyFiles.length && (
                  <div role="alert" className={`flex flex-wrap items-center justify-between gap-2 rounded-lg px-3 py-2 text-xs ${warningTone}`}>
                    <p className="min-w-0 break-words">
                      Keys from an older version are saved on disk: <code className="font-mono tabular-nums">{legacyFiles.join(', ')}</code>
                    </p>
                    {canEditKeys && (
                      <Button type="button" size="sm" variant="secondary" disabled={saving} onClick={() => forgetKeys(true)} className={buttonMotion}>
                        Delete from disk
                      </Button>
                    )}
                  </div>
                )}
              </>
            )
          )}
        </div>

        {/* Footer */}
        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--color-border)] bg-[var(--color-surface)] px-6 py-3.5">
          <p className="flex items-center gap-1.5 text-xs text-[var(--color-text-muted)]">
            <Lock size={13} className="shrink-0" aria-hidden="true" /> Keys stay in memory for this session only. Never saved to disk.
          </p>
          <div className="ml-auto flex items-center gap-2">
            <Button type="button" size="sm" variant="secondary" disabled={loading || saving} onClick={load} className={buttonMotion}>
              <RotateCcw /> Check again
            </Button>
            <Button type="button" size="sm" disabled={saving} onClick={onClose} className={buttonMotion}>Done</Button>
          </div>
        </footer>
      </div>
    </dialog>
  );
}
