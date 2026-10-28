import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X, GitBranch, MessageSquare, Plus, Pin, Trash2, Loader2 } from "lucide-react";
import Button from "../common/Button";
import { getAiContext, saveAiContext, getAiMemories, addAiMemory, editAiMemory, forgetAiMemory, clearAiMemories, previewAiContext, branchAiConversation } from "../../services/aiContext.service";
import { getChatSessionsApi } from "../../services/project.service";
import { useProjectAccess } from "../../hooks/useProjectAccess";

const inputClass = "w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm text-[var(--color-text)] focus-visible:outline-2 focus-visible:outline-[var(--color-primary)]";
export default function AIContextDialog({ projectId, snapshotId, sessionId, useMemory, screenContext, onSelect, onNew, onClose, initialTab = "context" }) {
  const access = useProjectAccess(projectId);
  const canWrite = access.can("memory.write");
  const dialogRef = useRef(null);
  const alive = useRef(true);
  const running = useRef(false);
  const contextRead = useRef(0);
  const [tab, setTab] = useState(initialTab);
  const [settings, setSettings] = useState(null);
  const [saved, setSaved] = useState(null);
  const [notes, setNotes] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [preview, setPreview] = useState(null);
  const [search, setSearch] = useState("");
  const newUsesMemory = useMemory;
  const [note, setNote] = useState("");
  const [editing, setEditing] = useState(null);
  const [pinned, setPinned] = useState(false);
  const [branch, setBranch] = useState(null);
  const [branchPreview, setBranchPreview] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  const [clearConfirm, setClearConfirm] = useState(false);
  const [discardConfirm, setDiscardConfirm] = useState(false);
  const dirty = saved && settings && (saved.guidance !== settings.guidance || saved.automaticMemory !== settings.automaticMemory);
  const settingsDirty = useRef(false);
  useEffect(() => { settingsDirty.current = !!dirty; }, [dirty]);
  const dismiss = () => { if (busy) return; if (dirty || note.trim()) setDiscardConfirm(true); else onClose(); };

  useEffect(() => {
    alive.current = true;
    const trigger = document.activeElement;
    const dialog = dialogRef.current;
    dialog.showModal();
    return () => { alive.current = false; dialog.close(); trigger?.focus(); };
  }, []);
  useEffect(() => {
    let cancelled = false;
    const request = ++contextRead.current;
    Promise.all([getAiContext(projectId), getAiMemories(projectId), getChatSessionsApi(projectId), previewAiContext(projectId, { sessionId, snapshotId, useMemory, screenContext })])
      .then(([config, memories, history, context]) => {
        if (cancelled || request !== contextRead.current) return;
        setSettings(config); setSaved(config); setNotes(memories); setSessions(history.data || []); setPreview(context);
      }).catch(err => { if (!cancelled && request === contextRead.current) setError(err.message); })
      .finally(() => { if (!cancelled && request === contextRead.current) setLoading(false); });
    return () => { cancelled = true; };
  }, [projectId, sessionId, snapshotId, useMemory, screenContext, reload]);

  useEffect(() => {
    let subscribed = true;
    const refreshSharedMemory = async event => {
      if (event.detail?.projectId !== projectId || event.detail.type !== "memory.changed") return;
      const request = ++contextRead.current;
      try {
        const [config, memories, context] = await Promise.all([
          getAiContext(projectId), getAiMemories(projectId),
          previewAiContext(projectId, { sessionId, snapshotId, useMemory, screenContext }),
        ]);
        if (!subscribed || !alive.current || request !== contextRead.current) return;
        setNotes(memories); setPreview(context); setLoading(false);
        // Keep the settings revision belonging to the draft. A stale save must
        // conflict instead of silently adopting another member's base revision.
        if (!settingsDirty.current) { setSettings(config); setSaved(config); }
      } catch (err) {
        if (subscribed && alive.current && request === contextRead.current) { setError(err.message); setLoading(false); }
      }
    };
    window.addEventListener("covai:project-event", refreshSharedMemory);
    return () => { subscribed = false; window.removeEventListener("covai:project-event", refreshSharedMemory); };
  }, [projectId, sessionId, snapshotId, useMemory, screenContext]);

  const run = async action => {
    if (running.current) return;
    running.current = true;
    setBusy(true); setError("");
    try { await action(); } catch (err) { if (alive.current) setError(err.message); }
    finally { running.current = false; if (alive.current) setBusy(false); }
  };
  const refreshNotes = async () => { const rows = await getAiMemories(projectId); if (alive.current) setNotes(rows); };
  const resetEditor = () => { setEditing(null); setNote(""); setPinned(false); };
  const inspectBranch = row => run(async () => {
    const context = await previewAiContext(projectId, { sessionId: row.id, snapshotId, useMemory: newUsesMemory, screenContext });
    if (alive.current) { setBranch(row); setBranchPreview(context); }
  });
  const canNavigate = () => { if (dirty || note.trim()) { setError("Save or discard your edits before switching conversations."); return false; } return true; };
  const chooseSession = async id => { if (!canNavigate()) return; await onSelect(id); onClose(); };
  const trapFocus = event => {
    if (event.key !== 'Tab') return;
    const controls = [...dialogRef.current.querySelectorAll('button, input, textarea, select, a[href], [tabindex="0"]')]
      .filter(el => !el.disabled && el.getClientRects().length);
    const first = controls[0], last = controls.at(-1);
    if (!first) { event.preventDefault(); return; }
    if (event.shiftKey && (document.activeElement === first || !controls.includes(document.activeElement))) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && (document.activeElement === last || !controls.includes(document.activeElement))) { event.preventDefault(); first.focus(); }
  };

  return createPortal(
    <dialog ref={dialogRef} aria-labelledby="ai-context-title" onKeyDown={trapFocus} onCancel={event => { event.preventDefault(); dismiss(); }}
      onClick={event => { if (event.target === event.currentTarget) dismiss(); }}
      className="m-auto w-[calc(100%-24px)] max-w-[680px] max-h-[calc(100dvh-32px)] overflow-y-auto rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)] p-0 shadow-xl backdrop:bg-black/60">
      <div className="p-5 sm:p-6">
        <div className="flex items-start justify-between gap-3">
          <div><h2 id="ai-context-title" className="text-lg font-semibold">What AI knows</h2><p className="mt-1 text-xs text-[var(--color-text-muted)]">Chat history and AI memory are shared with all project members.</p></div>
          <Button variant="ghost" size="sm" onClick={dismiss} aria-label="Close context dialog" disabled={busy}><X size={17} /></Button>
        </div>
        <div role="tablist" aria-label="Context sections" className="flex gap-4 mt-5 border-b border-[var(--color-border)]">
          {[['context', 'Current context'], ['conversations', 'Chat history'], ['memory', 'Memory (optional)']].map(([id, label]) => (
            <button key={id} type="button" role="tab" aria-selected={tab === id} aria-controls={`context-panel-${id}`} id={`context-tab-${id}`} onClick={() => setTab(id)}
              className={`pb-3 text-xs font-medium cursor-pointer border-b-2 ${tab === id ? 'border-[var(--color-primary)] text-[var(--color-primary)]' : 'border-transparent text-[var(--color-text-muted)]'}`}>{label}</button>
          ))}
        </div>
        {error && <div role="alert" className="mt-4 text-sm text-[var(--color-danger)]">{error}<button type="button" className="underline ml-2" disabled={busy} onClick={() => { setError(""); setLoading(true); setReload(value => value + 1); }}>Reload</button></div>}
        {loading ? <p role="status" className="flex items-center gap-2 py-8 text-sm"><Loader2 size={16} className="animate-spin" />Loading saved context...</p> : <>
          {tab === "conversations" && <section role="tabpanel" id="context-panel-conversations" aria-labelledby="context-tab-conversations" className="pt-5 space-y-4">
            <div className="rounded-lg border border-[var(--color-border)] p-4">
              <h3 className="text-sm font-semibold">Start a new chat</h3>
              <p className="mt-1 text-xs leading-relaxed text-[var(--color-text-muted)]">AI still knows your project and current screen. Previous chats stay in your history.</p>
              <Button size="sm" icon={Plus} className="mt-3" disabled={busy || !access.can("chat.write")} onClick={() => { if (!canNavigate()) return; onNew(newUsesMemory); onClose(); }}>New chat</Button>
            </div>
            <label className="block text-xs font-medium">Find a previous chat<input aria-label="Find a previous chat" value={search} onChange={event => setSearch(event.target.value)} className={`${inputClass} mt-2`} placeholder="Search chat titles or messages" /></label>
            {!sessions.length && <p className="text-sm text-[var(--color-text-muted)]">No previous chats yet. Send your first question to get started.</p>}
            <div className="space-y-2">
              {sessions.filter(row => `${row.title} ${row.messages?.[0]?.content || ''}`.toLowerCase().includes(search.toLowerCase())).map(row => (
                <div key={row.id} className={`rounded-lg border p-3 ${row.id === sessionId ? 'border-[var(--color-primary)]' : 'border-[var(--color-border)]'}`}>
                  <div className="flex items-start justify-between gap-2"><h3 className="text-sm font-medium break-words">{row.title}</h3><time className="shrink-0 text-[10px] text-[var(--color-text-muted)]">{new Date(row.updatedAt).toLocaleDateString()}</time></div>
                  <p className="mt-1 text-xs text-[var(--color-text-muted)] line-clamp-2 break-words">{row.messages?.[0]?.content?.slice(0, 200) || 'No messages yet'}</p>
                  <div className="flex gap-2 mt-3"><Button size="sm" variant="secondary" icon={MessageSquare} disabled={busy} onClick={() => run(() => chooseSession(row.id))}>Continue</Button><Button size="sm" variant="ghost" icon={GitBranch} disabled={busy || !access.can("chat.write") || !row._count?.messages} onClick={() => inspectBranch(row)}>Create branch</Button></div>
                </div>
              ))}
            </div>
            {branch && <div className="border border-[var(--color-primary)] rounded-lg p-4">
              <h3 className="text-sm font-semibold">Branch from {branch.title}</h3><p className="mt-2 text-xs text-[var(--color-text-muted)]">Creates an independent conversation. The original stays unchanged.</p>
              {branchPreview?.summary && <p className="mt-2 text-xs whitespace-pre-wrap break-words">{branchPreview.summary}</p>}
              <p className="mt-2 text-xs">Context preview: {branchPreview?.recentTurnCount || 0} recent turns{branchPreview?.summaryIncluded ? ' and a saved summary' : ''}.</p>
              {branchPreview?.warnings?.map(warning => <p key={warning} className="mt-2 text-xs text-[var(--color-text-muted)]">{warning}</p>)}
              <div className="flex gap-2 mt-3"><Button size="sm" disabled={busy} onClick={() => run(async () => { if (!canNavigate()) return; const result = await branchAiConversation(projectId, branch.id, { useMemory: newUsesMemory, snapshotId }); await chooseSession(result.id); })}>Confirm branch</Button><Button size="sm" variant="ghost" disabled={busy} onClick={() => { setBranch(null); setBranchPreview(null); }}>Cancel branch</Button></div>
            </div>}
          </section>}
          {tab === "memory" && <section role="tabpanel" id="context-panel-memory" aria-labelledby="context-tab-memory" className="pt-5 space-y-5"><fieldset disabled={!canWrite} className="space-y-5 min-w-0">
            <form onSubmit={event => { event.preventDefault(); run(async () => { const result = await saveAiContext(projectId, { guidance: settings.guidance, automaticMemory: settings.automaticMemory, revision: saved.revision }); if (alive.current) { setSettings(result); setSaved(result); } }); }}>
              <label className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" checked={Boolean(settings?.automaticMemory)} disabled={busy || !settings} onChange={event => setSettings({ ...settings, automaticMemory: event.target.checked })} />Remember shared project preferences across chats</label>
              <p className="mt-2 text-xs leading-relaxed text-[var(--color-text-muted)]">For example: prefer Jest or keep replies concise. AI saves explicit decisions from chats and recalls them when relevant. This is optional; AI already knows your current tab.</p>
              <label className="block mt-4 text-xs font-medium">Additional instructions (optional)<textarea aria-label="Additional instructions" maxLength={8000} rows={3} value={settings?.guidance || ''} disabled={!settings || busy} onChange={event => setSettings({ ...settings, guidance: event.target.value })} className={`${inputClass} mt-2 resize-y`} placeholder="For example: keep replies concise and use Jest for unit tests. Do not enter passwords or API keys." /></label>
              <div className="flex items-center gap-3 mt-3"><Button type="submit" size="sm" disabled={busy || !dirty}>Save</Button><span className="text-xs text-[var(--color-text-muted)]">{dirty ? 'Unsaved changes' : 'Saved'}</span></div>
            </form>
            <div className="border-t border-[var(--color-border)] pt-4">
              <h3 className="text-sm font-semibold">{editing ? 'Edit a saved note' : 'Add something for AI to remember'}</h3>
              {editing?.status === 'REVIEW' && editing.conflictsWithId && <p className="mt-2 text-xs">Saving accepts this decision and forgets the conflicting note: {notes.find(row => row.id === editing.conflictsWithId)?.content || 'Previous decision'}</p>}
              <form onSubmit={event => { event.preventDefault(); run(async () => { if (editing) await editAiMemory(projectId, editing.id, { content: note, pinned, revision: editing.revision }); else await addAiMemory(projectId, { content: note, pinned }); await refreshNotes(); resetEditor(); }); }}>
                <textarea aria-label="Memory note" rows={3} maxLength={1000} value={note} disabled={busy} onChange={event => setNote(event.target.value)} className={`${inputClass} mt-2 resize-y`} placeholder="Example: completed todo items cannot be edited." />
                <label className="flex items-center gap-2 mt-2 text-xs"><input type="checkbox" checked={pinned} disabled={busy} onChange={event => setPinned(event.target.checked)} />Pin this note for future chats</label>
                <div className="flex gap-2 mt-3"><Button type="submit" size="sm" disabled={busy || !note.trim()}>{editing ? 'Save memory' : 'Add memory'}</Button>{editing && <Button size="sm" variant="ghost" disabled={busy} onClick={resetEditor}>Cancel editing</Button>}</div>
              </form>
            </div>
            <div><h3 className="text-sm font-semibold">Saved memories ({notes.length})</h3><p className="mt-1 text-xs text-[var(--color-text-muted)]">Only relevant or pinned notes are recalled. Unreviewed conflicts are not used.</p>
              {!notes.length && <p className="mt-3 text-sm text-[var(--color-text-muted)]">No saved memories. Add a note or enable automatic memory.</p>}
              <div className="mt-3 space-y-2">{notes.map(row => <article key={row.id} className="p-3 rounded-lg border border-[var(--color-border)]">
                <p className="text-sm whitespace-pre-wrap break-words">{row.pinned && <Pin size={12} className="inline mr-1" />}{row.content}</p>
                {row.status === 'REVIEW' && <p className="mt-2 text-xs text-[var(--color-primary)]">Potential conflict. Review and save before using this memory.</p>}
                {row.evidence && <button type="button" className="mt-2 text-xs underline text-[var(--color-text-muted)]" disabled={busy} onClick={() => run(() => chooseSession(row.evidence.sessionId))}>From: {row.evidence.title}</button>}
                <div className="flex gap-2 mt-2"><Button variant="ghost" size="sm" disabled={busy} onClick={() => { setEditing(row); setNote(row.content); setPinned(row.pinned); }}>Edit</Button><Button variant="ghost" size="sm" icon={Trash2} disabled={busy} onClick={() => run(async () => { await forgetAiMemory(projectId, row.id, row.revision); await refreshNotes(); if (editing?.id === row.id) resetEditor(); })}>Forget</Button></div>
              </article>)}</div>
              {notes.length > 0 && <div className="mt-4"><Button variant="danger" size="sm" disabled={busy || !access.can("chat.delete")} onClick={() => setClearConfirm(true)}>Clear all memory</Button>{clearConfirm && <div className="mt-3 text-xs"><p>Remove all saved notes? Conversation transcripts and project rules will remain.</p><div className="flex gap-2 mt-2"><Button size="sm" variant="danger" disabled={busy || !access.can("chat.delete")} onClick={() => run(async () => { await clearAiMemories(projectId); await refreshNotes(); setClearConfirm(false); resetEditor(); })}>Confirm clear memory</Button><Button size="sm" variant="ghost" disabled={busy} onClick={() => setClearConfirm(false)}>Keep memory</Button></div></div>}</div>}
            </div>
          </fieldset></section>}
          {tab === "context" && <section role="tabpanel" id="context-panel-context" aria-labelledby="context-tab-context" className="pt-5 space-y-4">
            <div className="rounded-lg border border-[var(--color-border)] p-4 space-y-2">
              <h3 className="text-sm font-semibold">Automatically follows your screen</h3>
              <p className="text-sm">{screenContext?.testType ? `${({ unit: 'Unit', integration: 'Integration', system: 'System' })[screenContext.testType]} Test` : ({ explorer: 'Code', jobs: 'Run history', architecture: 'Architecture', settings: 'Settings' })[screenContext?.activity] || 'Project'}</p>
              <p className="text-xs text-[var(--color-text-muted)]">Switch tabs to update the context for your next question. Your conversation history is kept.</p>
              {screenContext?.testType && <p className="text-xs">{preview?.testResults ? `Latest run: ${preview.testResults.passedTests}/${preview.testResults.totalTests} tests passed, ${preview.testResults.failedTests} failed.` : 'No saved test results for this screen yet. Run tests so AI has results to analyze.'}</p>}
              {screenContext?.filePath && <p className="text-xs break-all">Open file: {screenContext.filePath}. Attach the file if you want AI to read its contents.</p>}
            </div>
            <p className="text-xs text-[var(--color-text-muted)]">The information below is sent with your question. Long-term memory is optional; AI knows your current screen even when memory is off.</p>
            <details className="text-xs"><summary className="cursor-pointer text-[var(--color-text-muted)]">View details sent to AI</summary>
            <p className="mt-3 text-xs">Context maintenance: {preview?.maintenanceStatus === 'PENDING' ? 'Processing summary and memory...' : preview?.maintenanceStatus === 'FAILED' ? 'Failed; recent saved messages remain available.' : 'Ready'}</p>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-xs"><dt>Snapshot</dt><dd className="break-all">{preview?.snapshot?.commitSha?.slice(0, 12) || preview?.snapshot?.id || 'No snapshot yet'}</dd><dt>Analysis package</dt><dd>{preview?.snapshot?.analysisPackage || 'Unavailable'}</dd><dt>Conversation</dt><dd>{sessionId ? `${preview?.recentTurnCount || 0} recent turns` : 'New conversation'}</dd><dt>Saved summary</dt><dd>{preview?.summaryIncluded ? 'Included' : 'None'}</dd><dt>Project memory</dt><dd>{preview?.memoryEnabled ? 'Enabled' : 'Off for this request'}</dd><dt>Coverage</dt><dd>{preview?.coverage ? `${preview.coverage.linesPct}% lines` : 'No saved results'}</dd></dl>
            {preview?.guidance && <div><h3 className="text-xs font-semibold">Approved rules</h3><p className="mt-2 text-xs whitespace-pre-wrap break-words">{preview.guidance}</p></div>}
            {preview?.summary && <div><h3 className="text-xs font-semibold">Earlier conversation summary</h3><p className="mt-2 text-xs whitespace-pre-wrap break-words">{preview.summary}</p></div>}
            {preview?.memories?.map(row => <p key={row.id} className="text-xs border-l-2 border-[var(--color-primary)] pl-3">{row.content}</p>)}
            {preview?.warnings?.map(warning => <p key={warning} className="text-xs text-[var(--color-text-muted)]">{warning}</p>)}
            <p className="text-xs text-[var(--color-text-muted)]">Context is bounded. Saved history is retained even when older turns are summarized or omitted.</p>
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => run(async () => { const context = await previewAiContext(projectId, { sessionId, snapshotId, useMemory, screenContext }); if (alive.current) setPreview(context); })}>Refresh preview</Button>
            </details>
          </section>}
        </>}
        {discardConfirm && <div className="mt-5 text-xs border-t border-[var(--color-border)] pt-4"><p>Discard your unsaved changes?</p><div className="flex gap-2 mt-2"><Button size="sm" variant="danger" onClick={onClose}>Discard and close</Button><Button size="sm" variant="secondary" onClick={() => setDiscardConfirm(false)}>Keep editing</Button></div></div>}
        <div role="status" aria-live="polite" className="mt-4 text-xs text-[var(--color-text-muted)]">{busy && 'Saving or loading context...'}</div>
      </div>
    </dialog>, document.body,
  );
}
