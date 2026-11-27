import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { io } from 'socket.io-client';
import {
  SOCKET_URL,
  attachSocketAuthRecovery,
  socketAuth,
} from '../lib/authSession.js';
import { evaluationKey } from './useTrustworthinessQuery';

const emptyState = (projectId, userId) => ({
  projectId,
  userId,
  connected: false,
  progressByRun: {},
  prepareByVersion: {},
});

export function useEvaluationSocket({ projectId, userId }) {
  const queryClient = useQueryClient();
  const [state, setState] = useState(() => emptyState(projectId, userId));
  useEffect(() => {
    if (!projectId || !userId) return;
    let alive = true;
    let timer = null;
    let lastInvalidation = 0;
    const socket = io(SOCKET_URL, {
      auth: socketAuth,
      transports: ['websocket', 'polling'],
      reconnectionAttempts: 15,
      reconnectionDelay: 1000,
    });
    attachSocketAuthRecovery(socket, {
      onReauthenticated: () => {
        if (alive && socket.connected) {
          socket.emit('project:subscribe', { projectId });
        }
      },
    });
    const update = change => {
      if (!alive) return;
      setState(previous => change(
        previous.projectId === projectId && previous.userId === userId
          ? previous
          : emptyState(projectId, userId),
      ));
    };
    const invalidate = () => {
      if (!alive) return;
      timer = null;
      lastInvalidation = Date.now();
      queryClient.invalidateQueries({ queryKey: evaluationKey(userId, projectId) })
        .catch(error => console.error('Could not refresh evaluation data.', error));
    };
    const schedule = () => {
      const remaining = 1500 - (Date.now() - lastInvalidation);
      if (remaining <= 0) {
        if (timer !== null) clearTimeout(timer);
        invalidate();
      } else if (timer === null) {
        timer = setTimeout(invalidate, remaining);
      }
    };
    const connect = () => {
      if (!alive) return;
      update(previous => ({ ...previous, connected: true }));
      socket.emit('project:subscribe', { projectId });
    };
    const disconnect = () => update(previous => ({ ...previous, connected: false }));
    const receive = (key, idKey) => payload => {
      if (!alive || payload?.projectId !== projectId) return;
      if (payload[idKey]) {
        update(previous => ({
          ...previous,
          [key]: {
            ...previous[key],
            [payload[idKey]]: {
              ...(previous[key]?.[payload[idKey]] || {}),
              ...Object.fromEntries(Object.entries(payload).filter(([, value]) => value !== undefined)),
            },
          },
        }));
      }
      schedule();
    };
    const progress = receive('progressByRun', 'runId');
    const prepare = receive('prepareByVersion', 'profileVersionId');
    socket.on('connect', connect);
    socket.on('disconnect', disconnect);
    socket.on('evaluation:progress', progress);
    socket.on('evaluation:prepare:progress', prepare);
    return () => {
      alive = false;
      if (timer !== null) clearTimeout(timer);
      socket.off('connect', connect);
      socket.off('disconnect', disconnect);
      socket.off('evaluation:progress', progress);
      socket.off('evaluation:prepare:progress', prepare);
      socket.disconnect();
    };
  }, [projectId, userId, queryClient]);
  if (state.projectId !== projectId || state.userId !== userId) return emptyState(projectId, userId);
  return {
    connected: state.connected,
    progressByRun: state.progressByRun,
    prepareByVersion: state.prepareByVersion,
  };
}
