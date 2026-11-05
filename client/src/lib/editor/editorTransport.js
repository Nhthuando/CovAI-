import { io } from 'socket.io-client';
import { EDITOR_LIMITS } from '../../../../shared/editorProtocol.js';
const URL = import.meta.env.VITE_SOCKET_URL || 'http://localhost:5000';
const transports = new Map();

export function acquireEditorTransport(userId) {
  const token = localStorage.getItem('token');
  let entry = transports.get(userId);
  if (entry && entry.token !== token) { clearTimeout(entry.timer); clearInterval(entry.heartbeat); entry.socket.disconnect(); transports.delete(userId); entry = null; }
  if (!entry) {
    entry = { socket: io(`${URL}/editor`, { auth: { token }, autoConnect: false }), token, refs: 0 };
    const active = entry;
    entry.heartbeat = setInterval(() => { if (active.socket.connected) active.socket.emit('editor:presence', {}); }, EDITOR_LIMITS.heartbeatMs);
    transports.set(userId, entry);
  }
  clearTimeout(entry.timer); entry.refs++;
  return { socket: entry.socket, release() {
    entry.refs--;
    if (!entry.refs) entry.timer = setTimeout(() => {
      if (transports.get(userId) === entry && !entry.refs) { clearInterval(entry.heartbeat); entry.socket.disconnect(); transports.delete(userId); }
    }, 1000);
  } };
}
