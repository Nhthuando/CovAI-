import { useState, useEffect, useRef } from "react";
import { io } from "socket.io-client";

const SOCKET_URL = import.meta.env.VITE_API_URL
  ? import.meta.env.VITE_API_URL.replace(/\/api$/, "")
  : "http://localhost:5000";

/**
 * useAdminSocket — Realtime Socket.IO hook for Admin Console (/admin namespace)
 */
export function useAdminSocket() {
  const [isConnected, setIsConnected] = useState(false);
  const [pulseLatency, setPulseLatency] = useState(4);
  const [heartbeat, setHeartbeat] = useState(null);
  const [latestQueueUpdate, setLatestQueueUpdate] = useState(null);
  const [alerts, setAlerts] = useState([]);
  const socketRef = useRef(null);

  useEffect(() => {
    const token = localStorage.getItem("token");
    if (!token) return;

    const socket = io(`${SOCKET_URL}/admin`, {
      auth: { token },
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 10000,
    });

    socketRef.current = socket;

    socket.io.on("reconnect_attempt", () => {
      const freshToken = localStorage.getItem("token");
      socket.auth = { token: freshToken };
    });

    socket.on("connect", () => {
      setIsConnected(true);
      console.log("[useAdminSocket] Connected to /admin namespace");
      // Trigger instant ping on connection
      const start = Date.now();
      socket.emit("admin:ping", start, (response) => {
        if (response) {
          const rtt = Date.now() - start;
          setPulseLatency(Math.max(1, rtt));
        }
      });
    });

    socket.on("disconnect", () => {
      setIsConnected(false);
    });

    socket.on("connect_error", async (err) => {
      console.warn("[useAdminSocket] Connection error:", err.message);
      setIsConnected(false);
      if (
        err.message &&
        (err.message.toLowerCase().includes("jwt") ||
          err.message.toLowerCase().includes("unauthorized") ||
          err.message.toLowerCase().includes("expired") ||
          err.message.toLowerCase().includes("token"))
      ) {
        try {
          const storedRefreshToken = localStorage.getItem("refreshToken");
          const res = await fetch(`${SOCKET_URL}/api/refresh`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({ refreshToken: storedRefreshToken }),
          });
          if (res.ok) {
            const data = await res.json();
            if (data.accessToken) {
              localStorage.setItem("token", data.accessToken);
              if (data.refreshToken) localStorage.setItem("refreshToken", data.refreshToken);
              window.dispatchEvent(new Event("covai:auth-change"));
              socket.auth = { token: data.accessToken };
              socket.connect();
            }
          }
        } catch (refreshErr) {
          console.warn("[useAdminSocket] Socket refresh error:", refreshErr);
        }
      }
    });

    // Listen to global auth changes from other tabs or components
    const handleAuthChange = () => {
      const freshToken = localStorage.getItem("token");
      if (freshToken && socket) {
        socket.auth = { token: freshToken };
        if (!socket.connected) {
          socket.connect();
        }
      }
    };
    window.addEventListener("covai:auth-change", handleAuthChange);

    // Heartbeat from server
    socket.on("admin:heartbeat", (data) => {
      setHeartbeat(data);
    });

    // Queue updates from server
    socket.on("admin:queues:update", (data) => {
      setLatestQueueUpdate(data);
    });

    // Realtime alerts from server
    socket.on("admin:alert", (alert) => {
      setAlerts((prev) => [alert, ...prev].slice(0, 5));
    });

    // Measure roundtrip latency every 5 seconds
    const pingInterval = setInterval(() => {
      if (socket.connected) {
        const start = Date.now();
        socket.emit("admin:ping", start, (response) => {
          if (response) {
            const rtt = Date.now() - start;
            setPulseLatency(Math.max(1, rtt));
          }
        });
      }
    }, 5000);

    return () => {
      window.removeEventListener("covai:auth-change", handleAuthChange);
      clearInterval(pingInterval);
      socket.disconnect();
    };
  }, []);

  const dismissAlert = (alertId) => {
    setAlerts((prev) => prev.filter((a) => a.id !== alertId));
  };

  return {
    socket: socketRef.current,
    isConnected,
    pulseLatency,
    heartbeat,
    latestQueueUpdate,
    alerts,
    dismissAlert,
  };
}
