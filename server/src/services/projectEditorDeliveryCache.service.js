import * as Y from 'yjs';
const recent = new Map();
let bytes = 0;
const remove = key => { bytes -= recent.get(key).size; recent.delete(key); };
export function rememberEditorCommit(event) {
    const { documentId, generation, projectId, revision, updateBytes } = event;
    let entry = recent.get(documentId);
    if (entry && (entry.generation !== generation || entry.projectId !== projectId)) { remove(documentId); entry = null; }
    if (!entry) { entry = { generation, projectId, items: [], size: 0, at: Date.now() }; recent.set(documentId, entry); }
    entry.items.push({ revision, updateBytes, contentHash: event.contentHash }); entry.size += updateBytes.byteLength; bytes += updateBytes.byteLength; entry.at = Date.now();
    while (entry.items.length > 64) { const item = entry.items.shift(); entry.size -= item.updateBytes.byteLength; bytes -= item.updateBytes.byteLength; }
    while (recent.size > 128 || bytes > 16 * 1024 * 1024) remove(recent.keys().next().value);
}
export function catchUpEditorOpen(state) {
    const entry = recent.get(state.documentId);
    if (!entry || entry.generation !== state.generation || entry.projectId !== state.projectId) return { state, needsSync: false };
    if (Date.now() - entry.at > 60000) { remove(state.documentId); return { state, needsSync: false }; }
    const items = entry.items.filter(item => item.revision > state.revision).sort((a, b) => a.revision - b.revision);
    if (!items.length) return { state, needsSync: false };
    if (items.some((item, index) => item.revision !== state.revision + index + 1)) return { state, needsSync: true };
    return { state: { ...state, stateBytes: Y.mergeUpdates([state.stateBytes, ...items.map(item => item.updateBytes)]), revision: items.at(-1).revision, contentHash: items.at(-1).contentHash || state.contentHash }, needsSync: false };
}
