import prisma from "../config/prisma.js";
import { redactRecord } from "./adminSchema.service.js";

/**
 * Compute compact differential object between before and after snapshots.
 * Omits identical values to preserve storage efficiency.
 */
export function computeJsonDiff(before, after) {
  if (!before && !after) return null;
  if (!before && after) return { _created: after };
  if (before && !after) return { _deleted: before };

  const diff = {};
  const allKeys = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);

  for (const key of allKeys) {
    const valBefore = before?.[key];
    const valAfter = after?.[key];

    // Check deep equality for primitives or objects
    const strBefore = typeof valBefore === "object" ? JSON.stringify(valBefore) : valBefore;
    const strAfter = typeof valAfter === "object" ? JSON.stringify(valAfter) : valAfter;

    if (strBefore !== strAfter) {
      diff[key] = {
        old: valBefore !== undefined ? valBefore : null,
        new: valAfter !== undefined ? valAfter : null,
      };
    }
  }

  return Object.keys(diff).length > 0 ? diff : null;
}

/**
 * Extract Client IP Address from request headers or socket
 */
export function extractClientIp(req) {
  if (!req) return null;
  const forwarded = req.headers?.["x-forwarded-for"];
  if (forwarded) {
    return String(forwarded).split(",")[0].trim();
  }
  return req.ip || req.socket?.remoteAddress || null;
}

/**
 * Record an immutable audit log entry in PostgreSQL
 */
export async function recordAudit({
  actorId,
  action,
  targetModel,
  targetId,
  beforeSnapshot,
  afterSnapshot,
  req,
  ipAddress,
  userAgent,
}) {
  try {
    const ip = ipAddress || extractClientIp(req);
    const ua = userAgent || (req ? req.headers?.["user-agent"] : null);

    // Compute diff before redacting or with redacted data
    const sanitizedBefore = beforeSnapshot ? redactRecord(targetModel, beforeSnapshot) : null;
    const sanitizedAfter = afterSnapshot ? redactRecord(targetModel, afterSnapshot) : null;
    const diff = computeJsonDiff(sanitizedBefore, sanitizedAfter);

    return await prisma.adminAuditLog.create({
      data: {
        actorId: actorId || null,
        action: String(action || "UNKNOWN").toUpperCase(),
        targetModel: String(targetModel || "Unknown"),
        targetId: targetId ? String(targetId) : null,
        beforeSnapshot: sanitizedBefore,
        afterSnapshot: sanitizedAfter,
        diff,
        ipAddress: ip ? String(ip).slice(0, 100) : null,
        userAgent: ua ? String(ua).slice(0, 500) : null,
      },
    });
  } catch (error) {
    console.error("[AdminAuditService] Failed to record audit log:", error);
    return null;
  }
}

/**
 * Query Audit Logs with pagination and filters
 */
export async function listAuditLogs({
  page = 1,
  limit = 25,
  actorId,
  targetModel,
  action,
  dateFrom,
  dateTo,
} = {}) {
  const take = Math.min(Math.max(parseInt(limit, 10) || 25, 1), 100);
  const skip = (Math.max(parseInt(page, 10) || 1, 1) - 1) * take;

  const where = {};
  if (actorId) where.actorId = actorId;
  if (targetModel) where.targetModel = targetModel;
  if (action) where.action = action.toUpperCase();

  if (dateFrom || dateTo) {
    where.createdAt = {};
    if (dateFrom) where.createdAt.gte = new Date(dateFrom);
    if (dateTo) where.createdAt.lte = new Date(dateTo);
  }

  const [logs, total] = await Promise.all([
    prisma.adminAuditLog.findMany({
      where,
      take,
      skip,
      orderBy: { createdAt: "desc" },
      include: {
        actor: {
          select: {
            id: true,
            email: true,
            name: true,
            avatarUrl: true,
            systemRole: true,
          },
        },
      },
    }),
    prisma.adminAuditLog.count({ where }),
  ]);

  return {
    logs,
    meta: {
      total,
      page: Math.max(parseInt(page, 10) || 1, 1),
      limit: take,
      totalPages: Math.ceil(total / take),
    },
  };
}
