import * as Y from 'yjs';
import { MonacoBinding } from 'y-monaco';
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate, removeAwarenessStates } from 'y-protocols/awareness';
import { acquireEditorTransport } from './editorTransport';
import { monaco } from '../monacoSetup';
import { checkpointCurrentSnapshot, getEditorStatus, getEditorRecovery } from '../../services/projectEditor.service';
import { EDITOR_LIMITS, editorBinaryBytes } from '../../../../shared/editorProtocol.js';
import { readRecovery, writeRecovery, encodeBytes, decodeBytes } from './editorRecovery';
import { enqueueEditorUpdate, compactRecoveredEditorQueue } from '../../../../shared/editorBatchQueue.js';

export class ProjectEditorProvider {
  constructor(scope) {
    this.scope = scope; this.listeners = new Set(); this.editors = new Map(); this.bindings = new Map(); this.models = new Set(); this.readonlyEditors = new Set(); this.queue = []; this.users = [];
    this.saved = readRecovery(scope); this.status = 'Joining'; this.canEdit = false; this.revision = 0; this.checkpointRevision = 0;
    this.transport = acquireEditorTransport(scope.userId); this.socket = this.transport.socket;
    this.socketListeners = [];
    this.listen = (event, listener) => { this.socketListeners.push([event, listener]); this.socket.on(event, listener); };
    this.listen('connect', () => { void this.open(); });
    this.listen('disconnect', reason => {
      this.inFlight = false; this.status = this.blocked ? 'Changes not saved' : 'Reconnecting'; this.updateReadonly(); this.persist(); this.changed();
      if (reason === 'io server disconnect' && !this.blocked && !this.disposed) this.reconnectTimer = setTimeout(() => { if (!this.disposed && !this.blocked) this.socket.connect(); }, 1000);
    });
    this.listen('connect_error', () => { this.status = 'Reconnecting'; this.error = 'Unable to connect to live editing.'; this.changed(); });
    this.listen('editor:update', event => this.receiveUpdate(event));
    this.listen('editor:saved', event => { if (event.documentId === this.identity?.documentId) { this.checkpointRevision = event.checkpointRevision; this.changed(); } });
    this.listen('editor:sync-required', event => { if (this.matches(event)) void this.sync(); });
    this.listen('editor:awareness', event => { if (this.matches(event) && this.awareness) { try { applyAwarenessUpdate(this.awareness, editorBinaryBytes(event.updateBytes), 'remote'); } catch { /* Ignore malformed ephemeral cursor data. */ } } });
    this.listen('editor:peer-left', event => { if (event.documentId === this.identity?.documentId && this.awareness) removeAwarenessStates(this.awareness, [event.clientId], 'remote'); });
    this.listen('editor:presence', event => { if (event.projectId === scope.projectId) { this.users = event.users; this.changed(); } });
    this.listen('editor:reset', event => {
      if (event.documentId !== this.identity?.documentId) return;
      this.persist();
      if (event.closed || this.queue.length) this.fail({ message: 'The file changed. Download your pending draft before reopening.', code: 'EDITOR_GENERATION_CHANGED' });
      else { this.detach(); this.doc?.destroy(); this.doc = null; this.identity = null; void this.open(); }
    });
    this.listen('editor:access-changed', event => {
      if (event.projectId !== scope.projectId) return;
      this.canEdit = !event.revoked && event.capabilities.includes('files.write');
      if (event.revoked) this.fail({ message: 'Project access was removed. Your pending draft is preserved.' });
      else if (!this.canEdit && this.queue.length) this.fail({ message: 'Edit access was removed. Download your pending draft before reopening.' });
      else { this.status = this.canEdit ? 'Changes saved' : 'View only'; this.updateReadonly(); this.persist(); this.changed(); }
    });
    if (this.socket.connected) queueMicrotask(() => { void this.open(); }); else this.socket.connect();
  }
  matches(event) { return event.documentId === this.identity?.documentId && event.generation === this.identity?.generation; }
  receiveUpdate(event) {
    if (!this.identity || !this.doc) {
      this.beforeOpen ||= [];
      const size = event.updateBytes?.byteLength || 0;
      if (this.beforeOpen.length < 128 && (this.beforeOpenBytes || 0) + size <= EDITOR_LIMITS.stateBytes) { this.beforeOpen.push(event); this.beforeOpenBytes = (this.beforeOpenBytes || 0) + size; }
      else this.needsInitialSync = true;
      return;
    }
    if (!this.matches(event)) return;
    try { Y.applyUpdate(this.doc, editorBinaryBytes(event.updateBytes), 'remote'); }
    catch { this.fail({ message: 'Shared changes could not be decoded. Your pending draft is preserved. Reload the latest file to reconnect.' }); return; }
    if (event.revision > this.revision + 1) void this.sync();
    this.revision = Math.max(this.revision, event.revision); this.changed();
  }
  changed() { this.version = (this.version || 0) + 1; for (const listener of this.listeners) listener(); }
  subscribe = listener => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
  snapshot = () => this.version || 0;
  async request(event, input) {
    const result = await this.socket.timeout(10000).emitWithAck(event, input);
    if (!result.ok) throw Object.assign(new Error(result.message), { code: result.code });
    return result;
  }
  async open() {
    if (this.disposed || this.opening) return;
    this.opening = true;
    let candidate;
    try {
      const doc = this.doc || new Y.Doc();
      candidate = doc;
      const state = await this.request('editor:open', { projectId: this.scope.projectId, snapshotId: this.scope.snapshotId, path: this.scope.path, clientId: doc.clientID });
      if (this.disposed) { doc.destroy(); return; }
      if (this.identity && !this.matches(state)) { this.fail({ message: 'The editor session changed. Recover your draft before reopening.' }); return; }
      this.doc = doc; this.identity = { ...state, stateBytes: undefined }; this.revision = state.revision; this.checkpointRevision = state.checkpointRevision;
      Y.applyUpdate(doc, editorBinaryBytes(state.stateBytes), 'remote');
      if (!this.ready) {
        if (this.saved?.pending?.length) {
          if (this.saved.documentId !== state.documentId || this.saved.generation !== state.generation) {
            this.recovery = this.saved.text; this.fail({ message: 'A draft from an earlier file version is available. Download it before reopening.' }); return;
          }
          this.queue = compactRecoveredEditorQueue(this.saved.pending, { merge: Y.mergeUpdates, encode: encodeBytes, decode: decodeBytes, maxBytes: EDITOR_LIMITS.updateBytes });
          for (const item of this.queue) Y.applyUpdate(doc, decodeBytes(item.bytes), 'remote');
        }
        this.awareness = new Awareness(doc);
        this.awareness.setLocalStateField('user', { name: 'You', color: '#a78bfa' });
        this.awareness.on('update', ({ added, updated, removed }, origin) => {
          if (origin === 'remote' || this.disposed || !this.identity || !this.socket.connected || ![...added, ...updated, ...removed].includes(doc.clientID)) return;
          if (!this.awarenessTimer) this.awarenessTimer = setTimeout(() => {
            this.awarenessTimer = null;
            const bytes = encodeAwarenessUpdate(this.awareness, [doc.clientID]);
            this.socket.volatile.emit('editor:awareness', { documentId: this.identity.documentId, generation: this.identity.generation, updateBytes: bytes });
          }, 50);
        });
        doc.on('update', (bytes, origin) => {
          if (origin === 'remote' || this.disposed) return;
          enqueueEditorUpdate(this.queue, bytes, { merge: Y.mergeUpdates, encode: encodeBytes, decode: decodeBytes, makeId: () => crypto.randomUUID(), maxBytes: EDITOR_LIMITS.updateBytes });
          this.persist(); this.status = 'Saving changes'; this.changed();
          if (!this.batchTimer) this.batchTimer = setTimeout(() => { this.batchTimer = null; void this.pump(); }, EDITOR_LIMITS.batchMs);
        });
        this.ready = true;
      }
      this.canEdit = state.capabilities.includes('files.write'); this.error = null;
      const waiting = this.beforeOpen || []; this.beforeOpen = []; this.beforeOpenBytes = 0;
      for (const event of waiting) this.receiveUpdate(event);
      if (this.needsInitialSync) { this.needsInitialSync = false; void this.sync(); }
      this.status = this.canEdit ? (this.queue.length ? 'Saving changes' : 'Changes saved') : 'View only';
      this.rebind(); this.updateReadonly(); this.changed(); await this.pump();
    } catch (error) {
      if (candidate && candidate !== this.doc) candidate.destroy();
      if (error.code === 'EDITOR_DOCUMENT_CLOSED' && !this.queue.length) {
        try {
          const state = await getEditorStatus(this.scope.projectId, this.scope.snapshotId);
          const row = state.documents.find(value => value.path === this.scope.path && value.dirty);
          if (row) this.recovery = (await getEditorRecovery(this.scope.projectId, row.documentId)).content;
        } catch { /* Existing local recovery remains available. */ }
      }
      this.fail(error);
    }
    finally { this.opening = false; }
  }
  persist() {
    const text = this.doc?.getText('content').toString() ?? this.recovery ?? this.saved?.text;
    this.recovery = this.queue.length ? text : this.recovery;
    const unopenedRecovery = !this.ready && this.saved?.pending?.length ? this.saved : null;
    if (!writeRecovery(this.scope, this.queue.length ? { ...this.identity, pending: this.queue, text } : unopenedRecovery || (this.recovery ? { ...(this.saved || this.identity), pending: this.saved?.pending || [], text: this.recovery } : null))) this.error = 'Local recovery storage is full. Download your draft before leaving.';
  }
  async pump() {
    if (this.disposed || this.inFlight || !this.queue.length || !this.socket.connected || !this.canEdit || this.blocked || !this.identity) return;
    this.inFlight = true;
    const batch = this.queue[0];
    batch.sent = true;
    try {
      const receipt = await this.request('editor:update', { documentId: this.identity.documentId, generation: this.identity.generation, requestId: batch.requestId, updateBytes: decodeBytes(batch.bytes) });
      if (this.queue[0]?.requestId === receipt.requestId) this.queue.shift();
      this.revision = Math.max(this.revision, receipt.revision); this.recovery = null; this.saved = null;
      this.persist(); this.status = this.queue.length ? 'Saving changes' : 'Changes saved'; this.error = null;
    } catch (error) {
      this.persist(); this.error = error.message;
      if (['AUTH_REQUIRED', 'EDITOR_GENERATION_CHANGED', 'EDITOR_DOCUMENT_CLOSED', 'CAPABILITY_DENIED', 'RESOURCE_NOT_FOUND', 'INVALID_EDITOR_UPDATE', 'EDITOR_LIMIT_EXCEEDED'].includes(error.code)) this.fail(error);
      else { this.status = 'Changes not saved'; clearTimeout(this.retryTimer); this.retryTimer = setTimeout(() => { void this.pump(); }, 1500); }
    } finally { this.inFlight = false; this.changed(); }
    if (this.queue.length && !this.error) void this.pump();
  }
  async sync() {
    if (!this.doc || !this.identity) return;
    if (this.syncing) return this.syncing;
    const doc = this.doc, identity = this.identity;
    this.syncing = (async () => {
      try { const result = await this.request('editor:sync', { documentId: identity.documentId, generation: identity.generation, stateVector: Y.encodeStateVector(doc) });
        if (this.disposed || this.doc !== doc || !this.matches(result)) return;
        Y.applyUpdate(doc, editorBinaryBytes(result.updateBytes), 'remote'); this.revision = Math.max(this.revision, result.revision); this.checkpointRevision = result.checkpointRevision; this.changed();
      } catch (error) { if (!this.disposed && this.doc === doc) this.fail(error); }
      finally { this.syncing = null; }
    })();
    return this.syncing;
  }
  async flushPending() {
    if (this.blocked || !this.socket.connected || !this.ready) throw new Error(this.error || 'Wait for the live editor to reconnect before saving.');
    const deadline = Date.now() + 15000;
    while (this.queue.length || this.inFlight) {
      if (this.blocked || Date.now() > deadline) throw new Error(this.error || 'Shared changes could not be saved. Your draft is preserved.');
      void this.pump(); await new Promise(resolve => setTimeout(resolve, 40));
    }
  }
  save = async () => {
    await this.flushPending();
    const result = await checkpointCurrentSnapshot({ ...this.scope, path: this.identity.path });
    const saved = result.documents?.find(row => row.documentId === this.identity.documentId);
    if (saved) this.checkpointRevision = saved.revision;
    this.identity.workspaceRevision = result.workspaceRevision;
    this.status = this.queue.length ? 'Saving changes' : this.revision === this.checkpointRevision ? 'Saved to workspace' : 'Changes saved';
    this.changed(); return result;
  };
  updateReadonly() { for (const editor of this.editors.keys()) editor.updateOptions({ readOnly: this.readonlyEditors.has(editor) || !this.canEdit || !this.socket.connected || this.blocked }); }
  bind(editor, readOnly = false) {
    if (readOnly) this.readonlyEditors.add(editor); else this.readonlyEditors.delete(editor);
    this.editors.set(editor, null); this.rebind(); this.updateReadonly();
    return () => { this.editors.delete(editor); this.readonlyEditors.delete(editor); this.rebind(); };
  }
  rebind() {
    if (!this.ready || !this.doc || !this.awareness) return;
    if (!this.undo) this.undo = new Y.UndoManager(this.doc.getText('content'), { trackedOrigins: new Set([MonacoBinding]) });
    for (const binding of this.bindings.values()) { this.undo.trackedOrigins.delete(binding); binding.destroy(); }
    this.bindings.clear();
    const groups = new Map();
    for (const editor of this.editors.keys()) {
      const model = editor.getModel(); if (!model) continue;
      if (!groups.has(model)) groups.set(model, new Set()); groups.get(model).add(editor); this.models.add(model);
      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyZ, () => { if (!this.readonlyEditors.has(editor) && this.canEdit && !this.blocked) this.undo.undo(); });
      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyZ, () => { if (!this.readonlyEditors.has(editor) && this.canEdit && !this.blocked) this.undo.redo(); });
    }
    for (const [model, editors] of groups) {
      const binding = new MonacoBinding(this.doc.getText('content'), model, editors, this.awareness);
      this.undo.trackedOrigins.add(binding); this.bindings.set(model, binding);
    }
  }
  detach() {
    for (const binding of this.bindings.values()) binding.destroy(); this.bindings.clear();
    this.undo?.destroy(); this.undo = null; this.awareness?.destroy(); this.awareness = null; this.ready = false;
  }
  fail(error) { this.blocked = true; this.error = error.message; this.status = 'Changes not saved'; this.persist(); this.updateReadonly(); this.changed(); }
  async reopen() {
    this.queue = []; this.recovery = null; this.saved = null; this.blocked = false; writeRecovery(this.scope, null);
    this.detach(); this.doc?.destroy(); this.doc = null; this.identity = null; await this.open();
  }
  dispose() {
    this.disposed = true; this.persist();
    for (const key of ['batchTimer', 'awarenessTimer', 'retryTimer', 'reconnectTimer']) clearTimeout(this[key]);
    if (this.identity && this.socket.connected) this.socket.emit('editor:leave', { documentId: this.identity.documentId });
    for (const [event, listener] of this.socketListeners) this.socket.off(event, listener);
    this.detach(); this.doc?.destroy(); this.transport.release(); this.listeners.clear();
    this.beforeOpen = []; this.beforeOpenBytes = 0;
    for (const model of this.models) if (!model.isDisposed()) model.dispose(); this.models.clear();
  }
}
