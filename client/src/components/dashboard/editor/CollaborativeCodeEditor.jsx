import { useEffect, useState } from 'react';
import MonacoEditor from '@monaco-editor/react';
import { useProjectAccess } from '../../../hooks/useProjectAccess';
import { useAuth } from '../../../hooks/useAuth';
import { useCollaborativeFile } from '../../../hooks/useCollaborativeFile';
import { registerLineHistoryHover } from '../../../lib/editor/registerLineHistoryHover';
import { downloadEditorDraft } from '../../../lib/editorDraft';
import './editorCollaboration.css';
import CollaboratorPresence from './CollaboratorPresence';

export default function CollaborativeCodeEditor({ projectId, snapshotId, filePath, ...props }) {
  const access = useProjectAccess(projectId);
  const { userId } = useAuth();
  const enabled = !!access.access?.features?.liveEditing && !!projectId && !!snapshotId && !!filePath;
  const provider = useCollaborativeFile({ projectId, snapshotId, path: filePath, enabled });
  const [mounted, setMounted] = useState(null);
  const surfaceReadOnly = !!props.options?.readOnly;
  useEffect(() => {
    if (!mounted || !provider) return;
    return provider.bind(mounted.editor, surfaceReadOnly);
  }, [mounted, provider, surfaceReadOnly]);
  useEffect(() => {
    if (!mounted || !projectId || !snapshotId || !filePath) return;
    const hover = registerLineHistoryHover(mounted.monaco, mounted.editor, { projectId, snapshotId, path: filePath }, () => provider);
    return () => hover.dispose();
  }, [mounted, projectId, snapshotId, filePath, provider]);
  const inner = { ...props };
  if (enabled) { delete inner.value; inner.defaultValue = props.value || ''; }
  const ready = provider?.ready && provider.socket.connected && !provider.blocked;
  return <div className="covai-live-editor" style={{ height: props.height || '100%' }}>
    {enabled && <div className="covai-live-toolbar" aria-live="polite">
      <span className={`covai-live-status ${provider?.error ? 'covai-live-error' : ''}`} title={provider?.error || 'Live changes are saved as a shared draft. Use Save to update the workspace used by tests.'}>{surfaceReadOnly && ready ? 'View only' : provider?.status || 'Joining'}</span>
      <CollaboratorPresence users={provider?.users} />
      {provider?.blocked && <><button type="button" onClick={() => downloadEditorDraft(filePath, provider.recovery || provider.doc?.getText('content').toString() || props.value || '')}>Download draft</button><button type="button" onClick={() => { if (provider.recovery || provider.queue.length) downloadEditorDraft(filePath, provider.recovery || provider.doc?.getText('content').toString() || props.value || ''); void provider.reopen(); }}>Reload latest</button></>}
    </div>}
    {enabled && provider?.error && <p className="covai-live-message" role="status">{provider.error}</p>}
    <div className="covai-live-canvas"><MonacoEditor {...inner} height="100%" path={enabled ? `covai://${userId || 'joining'}/${projectId}/${snapshotId}/${filePath}` : props.path}
      keepCurrentModel={enabled} options={{ ...props.options, readOnly: access.isPending || surfaceReadOnly || (enabled && (!ready || !provider?.canEdit)) }}
      onMount={(editor, monaco) => { setMounted({ editor, monaco }); props.onMount?.(editor, monaco); }} />
    </div>
    <style>{(provider?.users || []).map(user => `.yRemoteSelectionHead-${user.clientId}{border-color:${user.color}} .yRemoteSelection-${user.clientId}{background:${user.color}30} .yRemoteSelectionHead-${user.clientId}:hover:after{content:${JSON.stringify(user.name)};background:${user.color}}`).join('\n')}</style>
  </div>;
}
