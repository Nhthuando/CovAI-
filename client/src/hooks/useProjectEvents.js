import { useEffect, useRef } from "react";
import { io } from "socket.io-client";
import { queryClient } from "../lib/queryClient";
import { collaborationRequest, projectPath } from "../services/collaborationHttp";

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || "http://localhost:5000";
export function useProjectEvents(projectId, userId, onEvent) {
  const callback = useRef(onEvent);
  useEffect(() => { callback.current = onEvent; }, [onEvent]);
  useEffect(() => {
    if (!projectId || !userId) return;
    let sequence = 0;
    let alive = true;
    let replaying = false;
    const invalidate = () => queryClient.invalidateQueries({ predicate: query => query.queryKey.includes(projectId) });
    const receive = event => {
      if (!alive || event.projectId !== projectId) return;
      if (event.sequence && event.sequence <= sequence) return;
      if (event.sequence && sequence > 0 && event.sequence > sequence + 1) void replay(sequence);
      if (event.sequence) sequence = event.sequence;
      if (event.accessRevision !== undefined && !event.type) {
        queryClient.setQueryData(["projectAccess", userId, projectId], previous => previous ? { ...previous, capabilities: [] } : previous);
      }
      if (event.revoked) {
        queryClient.cancelQueries({ predicate: query => query.queryKey.includes(projectId) });
        queryClient.removeQueries({ predicate: query => query.queryKey.includes(projectId) && query.queryKey[0] !== "projectAccess" });
      }
      invalidate();
      callback.current?.(event);
      window.dispatchEvent(new CustomEvent("covai:project-event", { detail: event }));
    };
    const replay = async after => {
      if (replaying || !alive) return;
      replaying = true;
      try {
        let cursor = after;
        for (let page = 0; page < 20 && alive; page++) {
          const data = await collaborationRequest(`${projectPath(projectId)}/events?after=${cursor}&limit=100`);
          for (const event of data.events || []) receive(event);
          if (!data.events?.length || data.nextSequence <= cursor || data.events.length < 100) break;
          cursor = data.nextSequence;
        }
      } catch { /* Access polling independently reports expiry or revocation. */ }
      finally { replaying = false; }
    };
    const socket = io(SOCKET_URL, { auth: { token: localStorage.getItem("token") } });
    socket.on("connect", async () => {
      socket.emit("project:subscribe", { projectId });
      invalidate();
      await replay(sequence);
    });
    socket.on("project:event", receive);
    socket.on("project:access-changed", receive);
    return () => { alive = false; socket.emit("project:unsubscribe", { projectId }); socket.disconnect(); };
  }, [projectId, userId]);
}
