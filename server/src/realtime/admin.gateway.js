import jwt from "jsonwebtoken";
import prisma from "../config/prisma.js";
import { isAdminRole } from "../../../shared/adminRoles.js";
import { adminQueueService } from "../services/adminQueue.service.js";

let adminNamespace = null;
let heartbeatTimer = null;
let queueStreamTimer = null;

/**
 * Broadcast an alert to all connected admin consoles
 */
export function broadcastAdminAlert({
  id = `alt_${Date.now()}`,
  type = "SYSTEM_ALERT",
  message,
  severity = "info", // 'info' | 'warning' | 'danger'
  timestamp = new Date().toISOString(),
}) {
  if (adminNamespace) {
    adminNamespace.emit("admin:alert", {
      id,
      type,
      message,
      severity,
      timestamp,
    });
  }
}

/**
 * Attach Admin Socket.IO Gateway on namespace '/admin'
 */
export function attachAdminGateway(io) {
  if (!io) return;

  adminNamespace = io.of("/admin");

  // 1. Handshake Security Middleware (Admin Authentication Gate)
  adminNamespace.use(async (socket, next) => {
    try {
      const token =
        socket.handshake.auth?.token ||
        socket.handshake.headers?.authorization?.replace("Bearer ", "");

      if (!token) {
        return next(new Error("Authentication required: Token missing"));
      }

      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      if (!decoded || !decoded.userId) {
        return next(new Error("Invalid token claims"));
      }

      let systemRole = decoded.systemRole;
      const userEmail = (decoded.userEmail || decoded.email || "").toLowerCase();

      // Check DB if systemRole not present or is USER
      if (!systemRole || systemRole === "USER") {
        try {
          const dbUser = await prisma.user.findUnique({
            where: { id: decoded.userId },
            select: { systemRole: true, email: true },
          });
          if (dbUser?.systemRole) {
            systemRole = dbUser.systemRole;
          }
        } catch {}
      }

      // Check ADMIN_EMAILS environment variable fallback
      const adminEmails = (process.env.ADMIN_EMAILS || "")
        .split(",")
        .map((e) => e.trim().toLowerCase())
        .filter(Boolean);
      if (adminEmails.includes(userEmail)) {
        systemRole = "SUPERADMIN";
      }

      if (!isAdminRole(systemRole)) {
        return next(new Error("Forbidden: Administrative privilege required"));
      }

      socket.data.user = {
        userId: decoded.userId,
        email: userEmail,
        systemRole,
      };

      next();
    } catch (err) {
      console.warn("[AdminGateway] Unauthorized connection attempt:", err.message);
      next(new Error(`Unauthorized: ${err.message}`));
    }
  });

  // 2. Connection Lifecycle
  adminNamespace.on("connection", (socket) => {
    const adminUser = socket.data.user;
    console.log(`[AdminGateway] Admin connected: ${adminUser.email} (${adminUser.systemRole}) [socket ${socket.id}]`);

    // Ping / Pong for latency measurement
    socket.on("admin:ping", (clientSentTime, callback) => {
      const serverTime = Date.now();
      if (typeof callback === "function") {
        callback({
          clientSentTime,
          serverTime,
          latencyMs: clientSentTime ? serverTime - clientSentTime : 0,
        });
      }
    });

    // Room subscriptions
    socket.on("subscribe:queues", () => {
      socket.join("admin:queues");
    });

    socket.on("subscribe:audit", () => {
      socket.join("admin:audit");
    });

    socket.on("disconnect", (reason) => {
      console.log(`[AdminGateway] Admin disconnected: ${adminUser.email} [${reason}]`);
    });
  });

  // 3. Heartbeat & System Pulse Stream (every 5 seconds)
  if (!heartbeatTimer) {
    heartbeatTimer = setInterval(() => {
      if (!adminNamespace || adminNamespace.sockets.size === 0) return;

      const memory = process.memoryUsage();
      const heartbeatPayload = {
        timestamp: new Date().toISOString(),
        uptime: Math.floor(process.uptime()),
        connectedAdmins: adminNamespace.sockets.size,
        memory: {
          rssMb: Math.round(memory.rss / (1024 * 1024)),
          heapUsedMb: Math.round(memory.heapUsed / (1024 * 1024)),
          heapTotalMb: Math.round(memory.heapTotal / (1024 * 1024)),
        },
      };

      adminNamespace.emit("admin:heartbeat", heartbeatPayload);
    }, 5000);
    heartbeatTimer.unref();
  }

  // 4. BullMQ Queue Status Stream (every 5 seconds)
  if (!queueStreamTimer) {
    queueStreamTimer = setInterval(async () => {
      if (!adminNamespace || adminNamespace.sockets.size === 0) return;

      try {
        const queueStatus = await adminQueueService.getQueuesStatus();
        adminNamespace.emit("admin:queues:update", queueStatus);

        // Check for sudden failure spike to broadcast alert
        const failedCount = queueStatus?.queues?.[0]?.counts?.failed || 0;
        if (failedCount > 20) {
          broadcastAdminAlert({
            type: "QUEUE_BACKPRESSURE",
            message: `High dead-letter count in main queue: ${failedCount} failed jobs detected!`,
            severity: "warning",
          });
        }
      } catch (err) {
        // Safe suppression
      }
    }, 5000);
    queueStreamTimer.unref();
  }

  return adminNamespace;
}

export { adminNamespace };
