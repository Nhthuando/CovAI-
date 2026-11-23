import { useState } from 'react';
import ConfirmDialog from '../common/ConfirmDialog';
import { downloadEditorDraft } from '../../lib/editorDraft';
import { getFileContentApi } from '../../services/project.service';

function ConflictContents({ conflict, onClose, onReload, onMerged, loading }) {
  const [latest, setLatest] = useState(null);
  const [merged, setMerged] = useState(conflict.draft);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const compare = async () => {
    setBusy(true); setError('');
    try { const result = await getFileContentApi(conflict.projectId, conflict.path, { snapshotId: conflict.snapshotId }); setLatest(result.data); }
    catch (failure) { setError(failure.message); } finally { setBusy(false); }
  };
  const save = async () => {
    setBusy(true); setError('');
    try { await onMerged(merged, latest); }
    catch (failure) { await compare(); setError(failure.message); }
    finally { setBusy(false); }
  };
  const field = 'block w-full mt-1 h-28 p-2 rounded-md bg-[var(--color-bg)] border border-[var(--color-border)] font-mono text-xs';
  return <ConfirmDialog isOpen title="File changed" variant="warning" loading={loading || busy} onClose={onClose}
    onConfirm={latest && onMerged ? save : onReload} confirmText={latest && onMerged ? 'Save merged version' : 'Reload latest'} cancelText="Keep editing"
    message="Another change was saved after you opened this file. Your draft is preserved. Compare both versions before saving.">
    <div className="space-y-3 max-h-[60vh] overflow-y-auto"><p className="text-xs text-[var(--color-text-muted)] break-all">{conflict.path}</p>
      {conflict.original !== undefined && <details className="text-xs"><summary>Original version</summary><textarea aria-label="Original version" readOnly value={conflict.original} className={field} /></details>}
      <label className="block text-xs font-medium">Your draft<textarea aria-label="Your draft" readOnly value={conflict.draft} className={field} /></label>
      {latest && <><label className="block text-xs font-medium">Server version<textarea aria-label="Server version" readOnly value={latest.content} className={field} /></label><label className="block text-xs font-medium">Merged version<textarea aria-label="Merged version" value={merged} onChange={event => setMerged(event.target.value)} className={field} /></label></>}
      {error && <p role="alert" className="text-xs text-[var(--color-danger)]">{error}</p>}
      <div className="flex flex-wrap gap-3 text-xs"><button type="button" className="underline" onClick={() => downloadEditorDraft(conflict.path, conflict.draft)}>Download draft</button><button type="button" className="underline" onClick={async () => { try { await navigator.clipboard.writeText(conflict.draft); } catch { downloadEditorDraft(conflict.path, conflict.draft); } }}>Copy draft</button>
        {conflict.projectId && <button type="button" disabled={busy} className="underline" onClick={compare}>{latest ? 'Refresh server version' : 'Compare latest'}</button>}
      </div>
    </div>
  </ConfirmDialog>;
}
export default function FileConflictDialog(props) {
  return props.conflict ? <ConflictContents key={`${props.conflict.snapshotId}:${props.conflict.path}`} {...props} /> : null;
}
