import { useEffect, useRef, useState } from 'react';
import { CircleAlert, FileUp, Lock, Plus, RefreshCw, X } from 'lucide-react';
import { Button } from '../../ui/button.jsx';
import { Textarea } from '../../ui/input.jsx';
import { importSystemEnvironment } from '../../../services/systemTest.service.js';
import { useToast } from '../ToastContext.jsx';

function PreviewGroup({ title, items, icon: Icon, tone }) {
  if (!items.length) return null;
  return <section className="space-y-1">
    <h3 className={`flex items-center gap-1.5 text-xs font-semibold ${tone}`}>
      <Icon size={14} /> {title} (<span className="font-mono tabular-nums">{items.length}</span>)
    </h3>
    <ul className="space-y-1 pl-5 text-xs text-[var(--color-text-secondary)]">
      {items.map((item, index) => <li key={index} className={item.reason ? 'break-words rounded-md px-2 py-1 bg-rose-500/10 text-rose-400 border border-rose-500/20' : 'break-words'}>
        <code>{item.name}</code>
        {item.reason && <span> — {item.reason === 'LIVE_KEY' ? 'live key, use a test key' : 'empty value'}</span>}
      </li>)}
    </ul>
  </section>;
}

export default function EnvImportDialog({ snapshotId, revision, onClose, onImported }) {
  const dialog = useRef(null);
  const picker = useRef(null);
  const reader = useRef(null);
  const { showToast } = useToast();
  const [content, setContent] = useState('');
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const element = dialog.current;
    element.showModal();
    return () => {
      if (reader.current?.readyState === FileReader.LOADING) reader.current.abort();
      element.close();
    };
  }, []);

  function updateContent(value) {
    setContent(value);
    setPreview(null);
    setError('');
  }

  function readFile(file) {
    if (!file || busy || reading) return;
    if (!/\.(env|txt)$/i.test(file.name)) {
      setError('Choose an .env or .txt file.');
      return;
    }
    const next = new FileReader();
    reader.current = next;
    setReading(true);
    setPreview(null);
    setError('');
    next.onload = () => {
      updateContent(String(next.result));
      setReading(false);
    };
    next.onerror = () => {
      setError('Could not read the file.');
      setReading(false);
    };
    next.readAsText(file);
  }

  async function submit(dryRun) {
    setBusy(true);
    setError('');
    try {
      const result = await importSystemEnvironment(snapshotId, {
        expectedWorkspaceRevision: revision, content, dryRun,
      });
      if (dryRun || !result.saved) {
        setPreview(result);
        if (!dryRun) setError('No test keys were saved.');
        return;
      }
      showToast({ type: 'success', title: 'Test keys imported' });
      onClose();
      onImported();
    } catch {
      setError(dryRun ? 'Could not preview this file.' : 'Could not import test keys.');
    } finally {
      setBusy(false);
    }
  }

  const recognized = preview?.recognized ?? [];
  return <dialog ref={dialog} aria-labelledby="env-import-heading"
    onCancel={event => { event.preventDefault(); event.stopPropagation(); if (!busy) onClose(); }}
    className="m-auto max-h-[90vh] w-[min(560px,92vw)] overflow-auto rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-5 text-[var(--color-text)] shadow-sm backdrop:bg-black/60">
    <div className="space-y-4">
      <header className="flex items-center justify-between gap-3">
        <h2 id="env-import-heading" className="text-base font-semibold">Import from .env</h2>
        <Button className="transition-colors duration-150 active:scale-[0.98] focus-visible:ring-2 focus-visible:ring-[var(--color-focus)]/40" variant="ghost" size="icon-sm" aria-label="Close import" onClick={onClose} disabled={busy}><X /></Button>
      </header>
      <Textarea aria-label=".env contents" rows={10} spellCheck={false} autoComplete="off"
        className="font-mono tabular-nums text-xs" placeholder="STRIPE_SECRET_KEY=sk_test_..." value={content}
        disabled={busy || reading} onChange={event => updateContent(event.target.value)}
        onDragOver={event => event.preventDefault()}
        onDrop={event => { event.preventDefault(); readFile(event.dataTransfer.files[0]); }} />
      <p className="flex items-center gap-1.5 text-xs text-[var(--color-text-muted)]">
        <Lock size={13} className="shrink-0" aria-hidden="true" /> Values are kept in memory for this session and never saved to disk.
      </p>
      <div className="flex items-center justify-between gap-2">
        <input ref={picker} type="file" accept=".env,.txt" hidden onChange={event => {
          readFile(event.target.files[0]);
          event.target.value = '';
        }} />
        <Button className="transition-colors duration-150 active:scale-[0.98] focus-visible:ring-2 focus-visible:ring-[var(--color-focus)]/40" variant="outline" size="sm" disabled={busy || reading} onClick={() => picker.current.click()}><FileUp /> Choose file</Button>
        <Button className="transition-colors duration-150 active:scale-[0.98] focus-visible:ring-2 focus-visible:ring-[var(--color-focus)]/40" variant="secondary" size="sm" loading={busy && !preview} disabled={busy || reading || !content.trim()} onClick={() => submit(true)}>Preview</Button>
      </div>
      {preview && <div className="space-y-3 rounded-lg border border-[var(--color-border)] p-3">
        <PreviewGroup title="Rejected" items={preview.rejected ?? []} icon={CircleAlert} tone="rounded-md bg-rose-500/10 text-rose-400 border border-rose-500/20" />
        <PreviewGroup title="Will add" items={recognized.filter(item => item.action === 'add')} icon={Plus} tone="rounded-md bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" />
        <PreviewGroup title="Will replace" items={recognized.filter(item => item.action === 'replace')} icon={RefreshCw} tone="rounded-md bg-sky-500/10 text-sky-400 border border-sky-500/20" />
        {!!preview.ignored?.length && <details className="text-xs text-[var(--color-text-muted)]">
          <summary className="cursor-pointer">Not used by this app (<span className="font-mono tabular-nums">{preview.ignored.length}</span>)</summary>
          <p className="mt-1 break-words font-mono">{preview.ignored.join(', ')}</p>
        </details>}
        {!recognized.length && <p className="text-xs text-[var(--color-text-muted)]">No keys ready to import.</p>}
      </div>}
      {error && <p role="alert" className="rounded-md text-xs bg-rose-500/10 text-rose-400 border border-rose-500/20">{error}</p>}
      <footer className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-[var(--color-text-muted)]">Only keys this app uses are kept.</p>
        {preview && <Button className="transition-colors duration-150 active:scale-[0.98] focus-visible:ring-2 focus-visible:ring-[var(--color-focus)]/40" size="sm" loading={busy} disabled={!recognized.length} onClick={() => submit(false)}>
          Import <span className="font-mono tabular-nums">{recognized.length}</span> {recognized.length === 1 ? 'key' : 'keys'}
        </Button>}
      </footer>
    </div>
  </dialog>;
}
