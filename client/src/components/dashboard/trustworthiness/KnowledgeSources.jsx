import { useRef, useState } from 'react';
import { Check, FileText, Plus, Trash2, Upload } from 'lucide-react';
import { Button } from '../../ui/button';
import { Badge } from '../../ui/badge';
import { Panel, Field, EmptyState } from './ui';
import { buttonClass, inputClass } from './evaluationTheme';

const docKey = doc => `${doc.kind || 'FILE'}:${doc.path}`;
const docLabel = doc => (doc.kind === 'SEEDED_KNOWLEDGE' ? doc.name : doc.path);

export default function KnowledgeSources({ data, api, act, busy }) {
  const [name, setName] = useState('');
  const [content, setContent] = useState('');
  const [description, setDescription] = useState('');
  const snapshotId = data.designAudit?.snapshotId || '';
  const [filePath, setFilePath] = useState('');
  const [adding, setAdding] = useState(false);
  const [method, setMethod] = useState('upload');
  const inputRef = useRef(null);
  const [selectedFile, setSelectedFile] = useState(null);
  const docs = data.designAudit?.summary?.candidateDocs || [];
  const imported = new Set(data.sources.map(source => source.name));
  // Only the suggested (and already chosen) files show by default; the rest are one click away.
  const [showAllDocs, setShowAllDocs] = useState(false);
  // Recommended documents start selected; `toggled` holds the user's changes, so a late audit still pre-selects.
  const [toggled, setToggled] = useState(() => new Set());
  const selectedDocs = new Set(docs.filter(doc => Boolean(doc.recommended) !== toggled.has(docKey(doc))).map(docKey));
  const shortList = docs.filter(doc => doc.recommended || selectedDocs.has(docKey(doc)) || imported.has(docLabel(doc)));
  const visibleDocs = showAllDocs || !shortList.length ? docs : shortList;
  const hiddenCount = docs.length - visibleDocs.length;
  const openPanel = (nextMethod = 'upload') => {
    setMethod(nextMethod);
    setSelectedFile(null);
    setAdding(true);
  };
  return (
    <Panel>
      {!!data.sources.length && <ul className="divide-y divide-[var(--color-border)] overflow-hidden rounded-md border border-[var(--color-border)]">
        {data.sources.map(source => {
          const ready = source.status === 'READY';
          const failed = source.status === 'FAILED';
          const size = source.sizeBytes ?? source.size;
          const isProfile = source.provenance?.type === 'CHATBOT_PROFILE';
          const files = isProfile ? source.provenance.files || [] : [];
          return (
            <li key={source.id} className="flex flex-wrap items-center gap-3 px-4 py-3 transition-colors duration-150 hover:bg-[var(--color-surface-secondary)]/50">
              <FileText aria-hidden="true" className="size-4 shrink-0 text-[var(--color-text-muted)]" />
              <span className="min-w-0 flex-1">
                <span className="block break-words text-sm font-medium">{source.name}</span>
                {files.length > 0 && (
                  <span className="block break-words text-xs text-[var(--color-text-muted)]">
                    From {files.slice(0, 3).join(', ')}{files.length > 3 && ` +${files.length - 3}`}
                  </span>
                )}
                <span className="block font-mono text-xs tabular-nums text-[var(--color-text-muted)]">
                  v{source.version}{size != null ? ` · ${size < 1024 ? `${size} B` : `${(size / 1024).toFixed(1)} KB`}` : ''}
                </span>
              </span>
              {isProfile && <Badge variant="outline">Profile</Badge>}
              <Badge variant={ready ? 'success' : failed ? 'danger' : 'info'}>
                {!ready && !failed && <span aria-hidden="true" className="size-1.5 animate-ping rounded-full bg-sky-400" />}
                {ready ? 'Ready' : failed ? 'Failed' : 'Processing…'}
              </Badge>
              {source.status !== 'PROCESSING' && (
                <Button className={buttonClass} variant="ghost" size="sm" disabled={busy}
                  aria-label={`Remove ${source.name}`} title="Remove from future test questions"
                  onClick={() => act(() => api(`/sources/${source.id}`, 'DELETE'), 'Document removed. Create new test questions to use the change.')}>
                  <Trash2 aria-hidden="true" className="size-4" />
                </Button>
              )}
              {failed && typeof (source.safeError || source.errorMessage) === 'string' && (
                <p className="w-full break-words text-sm text-rose-400">{(source.safeError || source.errorMessage).slice(0, 500)}</p>
              )}
            </li>
          );
        })}
      </ul>}
      {!data.sources.length && !adding && (
        <EmptyState icon={FileText} title="Add your first document"
          description="Upload the policies, FAQs or product facts your chatbot should know."
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <Button className={buttonClass} variant="primary" disabled={busy} onClick={() => openPanel()}>Add document</Button>
              <Button className={buttonClass} variant="secondary" disabled={busy} onClick={() => openPanel('profile')}>My chatbot has no documents</Button>
            </div>
          } />
      )}
      {!!data.sources.length && !adding && (
        <Button className={buttonClass} variant="secondary" disabled={busy} onClick={() => openPanel()}><Plus aria-hidden="true" />Add document</Button>
      )}
      {adding && <div className="space-y-4 rounded-md border border-[var(--color-border)] p-4">
        <div role="group" aria-label="Add document method" className="flex flex-wrap gap-1 rounded-md border border-[var(--color-border)] p-1">
          {[
            ['upload', 'Upload file'], ['paste', 'Paste text'], ['project', 'From project files'],
            ['profile', 'No documents'],
          ].map(([value, label]) => (
            <Button key={value} className={buttonClass} variant={method === value ? 'secondary' : 'ghost'}
              aria-pressed={method === value} disabled={busy} onClick={() => setMethod(value)}>{label}</Button>
          ))}
        </div>
      {method === 'profile' && (
        <div className="space-y-3">
          <p className="text-sm text-[var(--color-text-muted)]">
            CovAI reads your system prompt and README, then tests the chatbot's role, safety and memory instead of document facts.
          </p>
          <form className="space-y-3" onSubmit={event => {
            event.preventDefault();
            act(async () => {
              const result = await api('/sources/from-project', 'POST', { description: description.trim() || undefined });
              setDescription('');
              setAdding(false);
              return result;
            }, 'Chatbot profile created.');
          }}>
            <Field label="What does your chatbot do? (optional)">
              <textarea className={inputClass} rows={4} maxLength={5000} value={description}
                placeholder="e.g. Helps students plan their study week. Must not give medical advice."
                onChange={event => setDescription(event.target.value)} />
            </Field>
            <Button className={buttonClass} type="submit" variant="primary" loading={busy}>Create profile</Button>
          </form>
        </div>
      )}
      {method === 'paste' && (
      <form className="space-y-3" onSubmit={event => {
        event.preventDefault();
        act(async () => {
          await api('/sources', 'POST', { name, content });
          setContent('');
          setName('');
          setAdding(false);
        }, 'Business document saved.');
      }}>
        <Field label="Document name">
          <input className={inputClass} required value={name} onChange={event => setName(event.target.value)} />
        </Field>
        <Field label="Content">
          <textarea className={inputClass} required rows={5} value={content}
            onChange={event => setContent(event.target.value)} />
        </Field>
        <Button className={buttonClass} type="submit" variant="primary" loading={busy}>Add document</Button>
      </form>
      )}
      {method === 'upload' && <form className="space-y-3" onSubmit={event => {
        event.preventDefault();
        if (!selectedFile) return;
        const form = new FormData();
        form.append('file', selectedFile);
        act(async () => {
          const result = await api('/sources/upload', 'POST', form);
          setSelectedFile(null);
          setAdding(false);
          return result;
        }, 'Document queued for processing.');
      }}>
      <Field label="Upload a document" hint="PDF, DOCX, TXT, Markdown, JSON or YAML">
        <input ref={inputRef} className="sr-only" type="file" accept=".pdf,.docx,.txt,.md,.json,.yaml,.yml"
          disabled={busy} onChange={event => {
            const file = event.target.files?.[0];
            if (!file) return;
            setSelectedFile(file);
            event.target.value = '';
          }} />
        <button type="button" disabled={busy} onClick={() => inputRef.current?.click()}
          onDragOver={event => event.preventDefault()}
          onDrop={event => {
            event.preventDefault();
            const file = event.dataTransfer.files?.[0];
            if (file) setSelectedFile(file);
          }}
          className="flex w-full cursor-pointer flex-col items-center gap-2 rounded-lg border border-dashed border-[var(--color-border-strong)] bg-[var(--color-surface-secondary)]/40 px-6 py-8 text-center transition-colors duration-150 outline-none hover:border-[var(--color-primary)]/50 hover:bg-[var(--color-primary)]/5 focus-visible:ring-2 focus-visible:ring-[var(--color-focus)]/50">
          <Upload className="size-5 text-[var(--color-text-muted)]" aria-hidden="true" />
          {selectedFile
            ? <span className="break-all font-mono text-sm text-[var(--color-text)]">{selectedFile.name}</span>
            : <span className="text-sm text-[var(--color-text-secondary)]"><span className="font-medium text-[var(--color-primary)]">Choose a file</span> or drop it here</span>}
        </button>
      </Field>
        <Button className={buttonClass} type="submit" variant="primary" loading={busy} disabled={!selectedFile}>Upload</Button>
      </form>}
      {method === 'project' && (
        <form className="mt-3 space-y-3" onSubmit={event => {
          event.preventDefault();
          const chosen = docs.filter(doc => selectedDocs.has(docKey(doc)) && !imported.has(docLabel(doc)));
          const extra = filePath.trim();
          if (!chosen.length && !extra) return;
          const projectSnapshot = snapshotId;
          act(async () => {
            const results = [];
            for (const doc of chosen) {
              results.push(await api('/sources', 'POST', {
                name: docLabel(doc), snapshotId: projectSnapshot, filePath: doc.path,
                ...(doc.kind === 'SEEDED_KNOWLEDGE' ? { extract: 'SEEDED_KNOWLEDGE' } : {}),
              }));
            }
            if (extra) results.push(await api('/sources', 'POST', { name: extra, snapshotId: projectSnapshot, filePath: extra }));
            setFilePath('');
            setAdding(false);
            return results.at(-1);
          }, `${chosen.length + (extra ? 1 : 0)} document(s) imported.`);
        }}>
          {!!docs.length && (
            <div>
              <p className="mb-2 text-sm text-[var(--color-text-secondary)]">
                {docs.some(doc => doc.recommended)
                  ? 'Pre-selected: the knowledge your chatbot actually reads. Drafts and technical docs are left out.'
                  : 'Pick the documents your chatbot answers from.'}
              </p>
              <div className="flex flex-wrap gap-2">
                {visibleDocs.map(doc => {
                  const key = docKey(doc);
                  const done = imported.has(docLabel(doc));
                  const checked = done || selectedDocs.has(key);
                  return (
                    <button key={key} type="button" aria-pressed={checked} disabled={busy || done}
                      title={doc.draft ? 'Marked as draft in the file' : doc.coveredBySeed ? 'Your chatbot reads the seeded copy instead' : undefined}
                      onClick={() => setToggled(previous => {
                        const next = new Set(previous);
                        if (next.has(key)) next.delete(key); else next.add(key);
                        return next;
                      })}
                      className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs transition-colors duration-150 active:scale-[0.98] disabled:cursor-default ${checked
                        ? 'border-[var(--color-primary)]/50 bg-[var(--color-primary)]/10 text-[var(--color-text)]'
                        : 'border-[var(--color-border)] bg-[var(--color-surface-secondary)] text-[var(--color-text-secondary)] hover:border-[var(--color-text-muted)]'}`}>
                      {checked ? <Check aria-hidden="true" className="size-3.5 text-[var(--color-primary)]" /> : <span aria-hidden="true" className="size-3.5" />}
                      <span className={doc.kind === 'SEEDED_KNOWLEDGE' ? 'font-medium' : 'font-mono'}>{docLabel(doc)}</span>
                      {done && <span className="text-[var(--color-text-muted)]">· Added</span>}
                      {!done && doc.draft && <span className="text-[var(--color-text-muted)]">· Draft</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          {hiddenCount > 0 && (
            <button type="button" className="text-sm text-[var(--color-text-secondary)] underline hover:text-[var(--color-text)]"
              onClick={() => setShowAllDocs(previous => !previous)}>
              {showAllDocs ? 'Show suggested only' : `Show all files (${hiddenCount} more)`}
            </button>
          )}
          <details>
            <summary className="cursor-pointer text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text)]">Another file</summary>
            <Field label="Relative file path">
              <input className={`${inputClass} font-mono`} value={filePath} placeholder="docs/faq.md"
                onChange={event => setFilePath(event.target.value)} />
            </Field>
          </details>
          <Button className={buttonClass} type="submit" variant="primary" loading={busy}
            disabled={!filePath.trim() && !docs.some(doc => selectedDocs.has(docKey(doc)) && !imported.has(docLabel(doc)))}>
            Import selected
          </Button>
        </form>
      )}
        <Button className={`${buttonClass} underline`} variant="ghost" disabled={busy} onClick={() => {
          setAdding(false);
          setSelectedFile(null);
        }}>Cancel</Button>
      </div>}
    </Panel>
  );
}
