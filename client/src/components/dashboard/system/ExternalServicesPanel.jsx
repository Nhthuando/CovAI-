import { useEffect, useRef, useState } from 'react';
import {
  Activity, AlertTriangle, Check, CheckCircle2, ClipboardPaste, Cloud, Copy, CreditCard,
  Database, Download, ExternalLink, Eye, EyeOff, FileWarning, KeyRound, Mail,
  Map as MapIcon, MessageSquare, Plug, Radio, Search, Settings2, Sparkles,
} from 'lucide-react';
import { Button } from '../../ui/button.jsx';
import { Input } from '../../ui/input.jsx';
import { systemEvidenceRequest } from '../../../services/systemTest.service.js';
import { useToast } from '../ToastContext.jsx';
import EnvImportDialog from './EnvImportDialog.jsx';

const icons = {
  payments: [CreditCard, 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'],
  email: [Mail, 'bg-sky-500/10 text-sky-400 border border-sky-500/20'],
  sms: [MessageSquare, 'bg-teal-500/10 text-teal-400 border border-teal-500/20'],
  ai: [Sparkles, 'bg-violet-500/10 text-violet-400 border border-violet-500/20'],
  storage: [Cloud, 'bg-blue-500/10 text-blue-400 border border-blue-500/20'],
  auth: [KeyRound, 'bg-amber-500/10 text-amber-400 border border-amber-500/20'],
  maps: [MapIcon, 'bg-lime-500/10 text-lime-400 border border-lime-500/20'],
  search: [Search, 'bg-indigo-500/10 text-indigo-400 border border-indigo-500/20'],
  realtime: [Radio, 'bg-fuchsia-500/10 text-fuchsia-400 border border-fuchsia-500/20'],
  monitoring: [Activity, 'bg-rose-500/10 text-rose-400 border border-rose-500/20'],
  database: [Database, 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/20'],
};

const statuses = {
  READY: ['Ready', CheckCircle2, 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'],
  NEEDS_CONFIG: ['Needs test key', AlertTriangle, 'bg-amber-500/10 text-amber-400 border border-amber-500/20'],
  HARDCODED: ['Key in source code', FileWarning, 'bg-rose-500/10 text-rose-400 border border-rose-500/20'],
  OPTIONAL: ['Optional', null, 'border border-[var(--color-border)] bg-[var(--color-surface-secondary)] text-[var(--color-text-secondary)]'],
};

const chip = 'rounded-md border border-[var(--color-border)] bg-[var(--color-surface-secondary)] px-1.5 py-0.5 font-mono tabular-nums text-[11px] break-all';
const variableKey = row => `${row.envFile}:${row.name}`;
const featureLabel = feature => `${feature.method} ${feature.path}`;

function KeyField({ row, helper, value, rejected, disabled, canEdit, onChange }) {
  const [visible, setVisible] = useState(false);
  const saved = row.status === 'PRESENT';
  return <div className="space-y-1.5">
    <label className="block space-y-1.5">
      <span className="flex flex-wrap items-center justify-between gap-1 text-xs">
        <code className="break-all font-medium" title={row.envFile}>{row.name}</code>
        {saved && <span className="inline-flex items-center gap-1 rounded-md bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"><CheckCircle2 size={12} /> Saved</span>}
      </span>
      {canEdit && <Input type={visible ? 'text' : 'password'} autoComplete="off" spellCheck={false}
        value={value} onChange={event => onChange(row, event.target.value)} disabled={disabled}
        aria-invalid={rejected || undefined} placeholder={saved ? 'Saved · enter to replace' : 'Paste test key'}
        className="pr-10 font-mono tabular-nums text-xs aria-invalid:border-rose-500" />}
    </label>
    {canEdit && <div className="relative h-0">
      <Button variant="ghost" size="icon-sm" className="transition-colors duration-150 active:scale-[0.98] focus:ring-2 focus:ring-[var(--color-focus)]/40 absolute -top-[2.5rem] right-0.5"
        aria-label={`${visible ? 'Hide' : 'Show'} ${row.name}`} disabled={disabled}
        onClick={() => setVisible(!visible)}>{visible ? <EyeOff /> : <Eye />}</Button>
    </div>}
    {helper && <p className="text-xs text-[var(--color-text-muted)]">{helper}</p>}
    {rejected && <p role="alert" className="rounded-md text-xs bg-rose-500/10 text-rose-400 border border-rose-500/20">This is a live key. Use a test-mode key.</p>}
  </div>;
}

function ServiceCard({ service, focused, renderField }) {
  const card = useRef(null);
  const [copyStatus, setCopyStatus] = useState('');
  useEffect(() => {
    if (!focused) return;
    const element = card.current;
    const frame = requestAnimationFrame(() => {
      const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      element.scrollIntoView({ block: 'center', behavior: reduceMotion ? 'auto' : 'smooth' });
      if (!reduceMotion) element.animate(
        [{ outline: '3px solid var(--color-primary)' }, { outline: '3px solid transparent' }],
        { duration: 1000 },
      );
    });
    return () => cancelAnimationFrame(frame);
  }, [focused]);

  const neutral = 'border border-[var(--color-border)] bg-[var(--color-surface-secondary)] text-[var(--color-text-secondary)]';
  const categoryIcon = service.inferred ? undefined : icons[service.category];
  const [Icon, tile] = categoryIcon ?? [service.id === 'env:APP' ? Settings2 : Plug, neutral];
  const [label, StatusIcon, tone] = statuses[service.status] ?? statuses.OPTIONAL;
  const features = service.features ?? [];
  const extra = features.slice(3).map(featureLabel);
  const envName = service.status === 'HARDCODED' ? service.hardcoded?.[0]?.envName : undefined;
  const snippet = envName ? `process.env.${envName}` : '';

  async function copySnippet() {
    try {
      await navigator.clipboard.writeText(snippet);
      setCopyStatus('copied');
    } catch {
      setCopyStatus('failed');
    }
  }

  return <article ref={card} className="flex min-w-0 flex-col gap-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-sm">
    <header className="flex items-center gap-3">
      <div className={`grid size-10 shrink-0 place-items-center rounded-lg ${tile}`}><Icon size={19} /></div>
      <div className="min-w-0 space-y-1">
        <h4 className="break-words text-sm font-semibold">{service.label}</h4>
        <div className="flex flex-wrap gap-1.5">
          <span className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium ${tone}`}>
            {StatusIcon && <StatusIcon size={12} />} {label}
          </span>
          {service.inferred && (
            <span className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium ${neutral}`}
              title="CovAI found these variables in your code. It doesn't know this provider, so check its docs for test keys.">
              <Search size={12} aria-hidden="true" /> Found in your code
            </span>
          )}
        </div>
      </div>
    </header>
    <div className="space-y-1.5 text-xs text-[var(--color-text-muted)]">
      {features.length ? <>
        <p>Unlocks tests for</p>
        <div className="flex flex-wrap gap-1.5">
          {features.slice(0, 3).map((feature, index) => <code key={index} className={chip}>{featureLabel(feature)}</code>)}
          {!!extra.length && <span tabIndex={0} className={`group relative cursor-help ${chip}`}>
            <span className="font-mono tabular-nums">{`+${extra.length}`}</span> more
            <span role="tooltip" className="pointer-events-none absolute left-0 top-full z-10 mt-1 hidden w-max max-w-52 space-y-1 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-2 shadow-sm group-hover:block group-focus:block">
              {extra.map((feature, index) => <span className="block" key={index}>{feature}</span>)}
            </span>
          </span>}
        </div>
      </> : <p>Used in app.js</p>}
    </div>
    {service.status === 'HARDCODED' && service.hardcoded?.map((entry, index) => (
      <p key={index} className="rounded-lg p-2.5 text-xs leading-relaxed bg-amber-500/10 text-amber-400 border border-amber-500/20">
        The key is written in <code className={chip}>{entry.sourceFile}:<span className="font-mono tabular-nums">{entry.line}</span></code>. Move it to <code className="break-all">process.env.{entry.envName}</code>, then add a test key.
      </p>
    ))}
    {snippet && <div className="flex items-center gap-2 rounded-md border border-[var(--color-border)] bg-[var(--color-surface-secondary)] px-2">
      <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap text-xs">{snippet}</code>
      <Button type="button" variant="ghost" size="icon-sm" className="transition-colors duration-150 active:scale-[0.98] focus:ring-2 focus:ring-[var(--color-focus)]/40 shrink-0"
        aria-label={copyStatus === 'copied' ? 'Environment reference copied' : 'Copy environment reference'} onClick={copySnippet}>
        {copyStatus === 'copied' ? <Check /> : <Copy />}
      </Button>
      {copyStatus === 'failed' && <span role="status" className="rounded-md text-xs bg-rose-500/10 text-rose-400 border border-rose-500/20">Copy failed</span>}
    </div>}
    <div className="space-y-3">{service.variables.map(row => renderField(row, row.name === envName ? 'Saved for when the key is read from process.env.' : undefined))}</div>
    {(service.testKeyHint || service.testKeyUrl) && <footer className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-[var(--color-border)] pt-3 text-xs">
      <span className="text-[var(--color-text-muted)]">{service.testKeyHint}</span>
      {service.testKeyUrl && <a href={service.testKeyUrl} target="_blank" rel="noopener noreferrer"
        className="inline-flex items-center gap-1 font-medium text-[var(--color-primary)] hover:underline">Get test keys <ExternalLink size={12} /></a>}
    </footer>}
  </article>;
}

export default function ExternalServicesPanel({
  snapshotId, revision, services, otherVariables, focusServiceId, canEdit,
  disabled, onSaved, onDownloadTemplate,
}) {
  const { showToast } = useToast();
  const [drafts, setDrafts] = useState({});
  const [rejected, setRejected] = useState([]);
  const [saving, setSaving] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [error, setError] = useState('');

  function update(row, value) {
    setDrafts(previous => ({ ...previous, [variableKey(row)]: { envFile: row.envFile, name: row.name, value } }));
    setRejected(previous => previous.filter(name => name !== row.name));
  }

  const variables = Object.values(drafts).filter(row => row.value.trim());
  const hasEditableServiceVariable = canEdit && services.some(service => service.variables.some(row => row.status !== 'MANAGED'));
  async function saveKeys() {
    setSaving(true);
    setError('');
    setRejected([]);
    try {
      await systemEvidenceRequest(snapshotId, 'setup/environment', {
        method: 'POST', data: { expectedWorkspaceRevision: revision, variables },
      });
      setDrafts({});
      showToast({ type: 'success', title: 'Test keys saved' });
      await onSaved();
    } catch (err) {
      const failure = err.response?.data;
      if (failure?.code === 'LIVE_CREDENTIAL_REJECTED' && failure.details?.variables?.length) {
        setRejected(failure.details.variables);
      } else {
        setError('Could not save test keys. Reload setup and try again.');
      }
    } finally {
      setSaving(false);
    }
  }

  const renderField = (row, helper) => row.status !== 'MANAGED' && <KeyField key={variableKey(row)} row={row} helper={helper}
    value={drafts[variableKey(row)]?.value ?? ''} rejected={rejected.includes(row.name)}
    disabled={disabled || saving} canEdit={canEdit} onChange={update} />;

  return <section className="space-y-4">
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h3 className="text-base font-semibold tracking-tight">External services</h3>
        <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">Add test keys so CovAI can test the features that use them.</p>
      </div>
      {canEdit && <Button className="transition-colors duration-150 active:scale-[0.98] focus:ring-2 focus:ring-[var(--color-focus)]/40" size="sm" variant="secondary" disabled={disabled || saving} onClick={() => setImportOpen(true)}><ClipboardPaste /> Paste .env</Button>}
    </header>
    {services.length ? <div className={`grid gap-3 ${services.length > 1 ? 'md:grid-cols-2' : ''}`}>
      {services.map(service => <ServiceCard key={service.id} service={service} focused={focusServiceId === service.id} renderField={renderField} />)}
    </div> : <p className="text-xs text-[var(--color-text-muted)]">No external services detected.</p>}
    {!!otherVariables.length && <details className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3 text-xs">
      <summary className="cursor-pointer font-medium">Other variables (<span className="font-mono tabular-nums">{otherVariables.length}</span>)</summary>
      <div className="mt-3 grid gap-3 md:grid-cols-2">{otherVariables.map(row => renderField(row))}</div>
    </details>}
    {error && <p role="alert" className="rounded-md text-xs bg-rose-500/10 text-rose-400 border border-rose-500/20">{error}</p>}
    <footer className="flex flex-wrap items-center justify-between gap-2">
      {onDownloadTemplate && <Button className="transition-colors duration-150 active:scale-[0.98] focus:ring-2 focus:ring-[var(--color-focus)]/40" size="sm" variant="ghost" onClick={onDownloadTemplate}><Download /> Download variable template</Button>}
      {hasEditableServiceVariable && <Button size="sm" className="transition-colors duration-150 active:scale-[0.98] focus:ring-2 focus:ring-[var(--color-focus)]/40 ml-auto" loading={saving} disabled={disabled || !variables.length} onClick={saveKeys}>Save keys</Button>}
    </footer>
    {importOpen && <EnvImportDialog snapshotId={snapshotId} revision={revision} onClose={() => setImportOpen(false)} onImported={onSaved} />}
  </section>;
}
