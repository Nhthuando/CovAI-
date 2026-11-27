import { io } from 'socket.io-client';
import { EDITOR_LIMITS } from '../../../../shared/editorProtocol.js';
import {
  SOCKET_URL,
  attachSocketAuthRecovery,
  getAccessToken,
  socketAuth,
} from '../authSession.js';

const transports = new Map();

export function acquireEditorTransport(userId) {
  let entry = transports.get(userId);
  if (!entry) {
    const socket = io(`${SOCKET_URL}/editor`, {
      auth: socketAuth,
      autoConnect: false,
      transports: ['websocket', 'polling'],
    });
    attachSocketAuthRecovery(socket, { authEventName: 'editor:auth' });
    const active = {
      socket,
      token: getAccessToken(),
      refs: 0,
      timer: null,
      heartbeat: null,
      onTokenRefreshed: null,
    };
    active.onTokenRefreshed = (event) => {
      const nextToken = event?.detail?.token || getAccessToken();
      if (!nextToken) return;
      active.token = nextToken;
      if (!active.socket.connected && active.refs > 0) {
        active.socket.connect();
      }
    };
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      window.addEventListener('covai:token-refreshed', active.onTokenRefreshed);
    }
    active.heartbeat = setInterval(() => {
      if (active.socket.connected) active.socket.emit('editor:presence', {});
    }, EDITOR_LIMITS.heartbeatMs);
    transports.set(userId, active);
    entry = active;
  }
  clearTimeout(entry.timer);
  entry.refs++;
  return {
    socket: entry.socket,
    release() {
      entry.refs--;
      if (!entry.refs) {
        entry.timer = setTimeout(() => {
          if (transports.get(userId) === entry && !entry.refs) {
            clearInterval(entry.heartbeat);
            if (typeof window !== 'undefined' && entry.onTokenRefreshed) {
              window.removeEventListener('covai:token-refreshed', entry.onTokenRefreshed);
            }
            entry.socket.disconnect();
            transports.delete(userId);
          }
        }, 1000);
      }
    },
  };
}
