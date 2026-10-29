import ConfirmDialog from "../common/ConfirmDialog";
import { downloadEditorDraft } from "../../lib/editorDraft";
export default function FileConflictDialog({ conflict, onClose, onReload, loading }) {
  return <ConfirmDialog isOpen={!!conflict} title="File changed" variant="warning" loading={loading} onClose={onClose} onConfirm={onReload} confirmText="Reload latest" cancelText="Keep editing" message="Another change was saved after you opened this file. Your draft has been preserved. Download or copy it before reloading the latest file.">
    {conflict && <div className="space-y-3"><p className="text-xs text-[var(--color-text-muted)] break-all">{conflict.path}</p><label className="block text-xs font-medium">Your unsaved draft<textarea aria-label="Your unsaved draft" readOnly value={conflict.draft} className="block w-full mt-2 h-40 p-3 rounded-md bg-[var(--color-bg)] border border-[var(--color-border)] font-mono text-xs" /></label><div className="flex gap-3 text-xs"><button type="button" className="underline" onClick={() => downloadEditorDraft(conflict.path, conflict.draft)}>Download draft</button><button type="button" className="underline" onClick={async () => { try { await navigator.clipboard.writeText(conflict.draft); } catch { downloadEditorDraft(conflict.path, conflict.draft); } }}>Copy draft</button></div></div>}
  </ConfirmDialog>;
}
