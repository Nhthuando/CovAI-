import { useEffect, useState } from 'react';
import { useAuth } from './useAuth';
import { acquireEditor } from '../lib/editor/editorModelRegistry';
export function useCollaborativeFile({ projectId, snapshotId, path, enabled }) {
  const { userId } = useAuth();
  const [snapshot, setSnapshot] = useState(null);
  useEffect(() => {
    if (!enabled || !userId || !projectId || !snapshotId || !path) return;
    let alive = true;
    const entry = acquireEditor({ userId, projectId, snapshotId, path });
    const update = () => { if (alive) setSnapshot({ provider: entry.provider, version: entry.provider.snapshot() }); };
    const unsubscribe = entry.provider.subscribe(update);
    queueMicrotask(update);
    return () => { alive = false; unsubscribe(); entry.release(); };
  }, [enabled, userId, projectId, snapshotId, path]);
  const provider = snapshot?.provider;
  if (!enabled || !userId || !provider?.scope) return null;
  const scope = provider.scope;
  return scope.userId === userId && scope.projectId === projectId && scope.snapshotId === snapshotId && scope.path === path ? provider : null;
}
