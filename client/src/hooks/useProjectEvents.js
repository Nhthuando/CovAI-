import { useEffect, useRef } from "react";
import { io } from "socket.io-client";
import { queryClient } from "../lib/queryClient";
import { collaborationRequest, projectPath } from "../services/collaborationHttp";
import {
  SOCKET_URL,
  attachSocketAuthRecovery,
  socketAuth,
} from "../lib/authSession.js";
import { GIT_SOCKET_EVENTS } from "../../../shared/gitProtocol.js";
import { SNAPSHOT_SOCKET_EVENTS } from "../../../shared/snapshotVcsProtocol.js";

const VCS_SOCKET_EVENT_NAMES = [
  GIT_SOCKET_EVENTS.STATUS_UPDATED,
  GIT_SOCKET_EVENTS.OPERATION_PROGRESS,
  GIT_SOCKET_EVENTS.OPERATION_COMPLETED,
  SNAPSHOT_SOCKET_EVENTS.UPDATED,
  SNAPSHOT_SOCKET_EVENTS.GC_COMPLETED,
];

export function useProjectEvents(projectId, userId, onEvent) {
  const callback = useRef(onEvent);
  useEffect(() => {
    callback.current = onEvent;
  }, [onEvent]);

  useEffect(() => {
    if (!projectId || !userId) return;
    let sequence = 0;
    let hasConnectedOnce = false;
    let alive = true;
    let replaying = false;
    let invalidateTimeout = null;

    const invalidate = () => {
      if (invalidateTimeout) clearTimeout(invalidateTimeout);
      invalidateTimeout = setTimeout(() => {
        if (!alive) return;
        queryClient
          .invalidateQueries({
            predicate: (query) =>
              query.queryKey[0] !== "vcsSummary" &&
              query.queryKey.includes(projectId),
            cancelRefetch: false,
          })
          .catch((err) => {
            if (err?.name !== "AbortError" && !err?.message?.includes("aborted")) {
              console.warn("[useProjectEvents] Invalidation error:", err);
            }
          });
      }, 150);
    };

    const receive = (event) => {
      if (!alive || event.projectId !== projectId) return;
      if (event.sequence && event.sequence <= sequence) return;
      if (event.sequence && sequence > 0 && event.sequence > sequence + 1) {
        void replay(sequence);
      }
      if (event.sequence) sequence = event.sequence;
      if (event.accessRevision !== undefined && !event.type) {
        queryClient.setQueryData(["projectAccess", userId, projectId], (previous) =>
          previous ? { ...previous, capabilities: [] } : previous,
        );
      }
      if (event.revoked) {
        queryClient.cancelQueries({
          predicate: (query) => query.queryKey.includes(projectId),
        });
        queryClient.removeQueries({
          predicate: (query) =>
            query.queryKey.includes(projectId) && query.queryKey[0] !== "projectAccess",
        });
      }
      invalidate();
      callback.current?.(event);
      window.dispatchEvent(new CustomEvent("covai:project-event", { detail: event }));
    };

    const replay = async (after) => {
      if (replaying || !alive) return;
      replaying = true;
      try {
        let cursor = after;
        for (let page = 0; page < 20 && alive; page += 1) {
          const data = await collaborationRequest(
            `${projectPath(projectId)}/events?after=${cursor}&limit=100`,
          );
          for (const event of data.events || []) receive(event);
          if (
            !data.events?.length ||
            data.nextSequence <= cursor ||
            data.events.length < 100
          ) {
            break;
          }
          cursor = data.nextSequence;
        }
      } catch (err) {
        if (err?.status === 403 || err?.status === 404) {
          // Access polling independently handles project revocation.
        } else {
          console.warn("[useProjectEvents] Event replay warning:", err?.message || err);
        }
      } finally {
        replaying = false;
      }
    };

    const socket = io(SOCKET_URL, {
      auth: socketAuth,
      transports: ["websocket", "polling"],
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
    });
    attachSocketAuthRecovery(socket, {
      onReauthenticated: () => {
        if (alive && socket.connected) {
          socket.emit("project:subscribe", { projectId });
        }
      },
    });

    socket.on("connect", async () => {
      socket.emit("project:subscribe", { projectId });
      if (hasConnectedOnce) {
        invalidate();
      }
      hasConnectedOnce = true;
      await replay(sequence);
    });
    socket.on("project:event", receive);
    socket.on("project:access-changed", receive);

    for (const eventName of VCS_SOCKET_EVENT_NAMES) {
      socket.on(eventName, (payload) => {
        if (!alive) return;
        if (payload?.projectId && payload.projectId !== projectId) return;
        window.dispatchEvent(
          new CustomEvent("covai:vcs-event", {
            detail: { projectId, event: eventName, payload: payload || {} },
          }),
        );
      });
    }

    return () => {
      alive = false;
      if (invalidateTimeout) clearTimeout(invalidateTimeout);
      socket.emit("project:unsubscribe", { projectId });
      socket.disconnect();
    };
  }, [projectId, userId]);
}
