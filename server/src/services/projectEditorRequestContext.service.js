import { AsyncLocalStorage } from 'node:async_hooks';
const context = new AsyncLocalStorage();
export const withEditorCheckpoint = (workspaceRevision, run) => context.run({ workspaceRevision }, run);
export const currentEditorCheckpoint = () => context.getStore()?.workspaceRevision;
