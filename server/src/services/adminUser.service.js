import prisma from "../config/prisma.js";
import { ServiceError } from "../utils/serviceError.js";
import { SYSTEM_ROLES } from "../../../shared/adminRoles.js";
import { recordAudit } from "./adminAudit.service.js";

/**
 * Service for Admin User & Access Governance
 */
export class AdminUserService {
  /**
   * List users with summary aggregates (projects count, jobs count, token usage)
   */
  async listUsers({
    page = 1,
    limit = 25,
    q,
    role,
    isSuspended,
    sortBy = "createdAt",
    sortOrder = "desc",
  } = {}) {
    const take = Math.min(Math.max(parseInt(limit, 10) || 25, 1), 100);
    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const skip = (pageNum - 1) * take;

    const where = {};

    if (role && Object.values(SYSTEM_ROLES).includes(role)) {
      where.systemRole = role;
    }

    if (isSuspended !== undefined && isSuspended !== null && isSuspended !== "") {
      where.isSuspended = isSuspended === "true" || isSuspended === true;
    }

    if (q && typeof q === "string" && q.trim()) {
      const searchStr = q.trim();
      where.OR = [
        { email: { contains: searchStr, mode: "insensitive" } },
        { name: { contains: searchStr, mode: "insensitive" } },
        { id: { contains: searchStr } },
      ];
    }

    const order = String(sortOrder).toLowerCase() === "asc" ? "asc" : "desc";
    const allowedSortFields = ["createdAt", "name", "email", "aiTokenUsage", "aiUsageCount", "systemRole"];
    const effectiveSortBy = allowedSortFields.includes(sortBy) ? sortBy : "createdAt";

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        take,
        skip,
        orderBy: { [effectiveSortBy]: order },
        select: {
          id: true,
          email: true,
          name: true,
          avatarUrl: true,
          systemRole: true,
          isSuspended: true,
          aiTokenUsage: true,
          aiUsageCount: true,
          aiUsageDate: true,
          createdAt: true,
          updatedAt: true,
          _count: {
            select: {
              projects: true,
              jobs: true,
            },
          },
        },
      }),
      prisma.user.count({ where }),
    ]);

    return {
      users,
      meta: {
        total,
        page: pageNum,
        limit: take,
        totalPages: Math.ceil(total / take) || 1,
        sortBy: effectiveSortBy,
        sortOrder: order,
      },
    };
  }

  /**
   * Update user status (Active vs. Suspended)
   */
  async updateUserStatus(userId, { isSuspended, reason = "" }, { actorId, req } = {}) {
    const existing = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, isSuspended: true, systemRole: true },
    });

    if (!existing) {
      throw new ServiceError("Target user not found.", 404, "USER_NOT_FOUND");
    }

    // Prevent suspending the initial superadmin or oneself
    if (existing.id === actorId && isSuspended) {
      throw new ServiceError("You cannot suspend your own administrative account.", 400, "CANNOT_SUSPEND_SELF");
    }

    const suspendedFlag = Boolean(isSuspended);

    const updated = await prisma.user.update({
      where: { id: userId },
      data: {
        isSuspended: suspendedFlag,
        // When suspending, immediately invalidate refresh token
        refreshToken: suspendedFlag ? null : undefined,
      },
      select: {
        id: true,
        email: true,
        name: true,
        systemRole: true,
        isSuspended: true,
      },
    });

    // Notify connected user via socket if online
    if (global.io && suspendedFlag) {
      global.io.to(`user_${userId}`).emit("auth:suspended", {
        reason: reason || "Your account has been suspended by system administration.",
      });
    }

    await recordAudit({
      actorId: actorId || null,
      action: suspendedFlag ? "SUSPEND_USER" : "UNSUSPEND_USER",
      targetModel: "User",
      targetId: userId,
      beforeSnapshot: { isSuspended: existing.isSuspended },
      afterSnapshot: { isSuspended: updated.isSuspended, reason },
      req,
    });

    return updated;
  }

  /**
   * Update user systemRole (SUPERADMIN, ADMIN, OPERATOR, USER)
   */
  async updateUserRole(userId, { systemRole }, { actorRole, actorId, req } = {}) {
    if (actorRole && actorRole !== SYSTEM_ROLES.SUPERADMIN) {
      throw new ServiceError(
        "Only SUPERADMIN can promote or demote user roles.",
        403,
        "SUPERADMIN_REQUIRED"
      );
    }

    if (!Object.values(SYSTEM_ROLES).includes(systemRole)) {
      throw new ServiceError(
        `Invalid role '${systemRole}'. Supported roles: ${Object.values(SYSTEM_ROLES).join(", ")}`,
        400,
        "INVALID_ROLE"
      );
    }

    const existing = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, systemRole: true },
    });

    if (!existing) {
      throw new ServiceError("Target user not found.", 404, "USER_NOT_FOUND");
    }

    const updated = await prisma.user.update({
      where: { id: userId },
      data: { systemRole },
      select: {
        id: true,
        email: true,
        name: true,
        systemRole: true,
        isSuspended: true,
      },
    });

    await recordAudit({
      actorId: actorId || null,
      action: "USER_ROLE_CHANGE",
      targetModel: "User",
      targetId: userId,
      beforeSnapshot: { systemRole: existing.systemRole },
      afterSnapshot: { systemRole: updated.systemRole },
      req,
    });

    return updated;
  }

  /**
   * Reset or grant quota for user
   */
  async resetUserQuota(userId, { extraTokens = 0, resetDailyCount = false }, { actorId, req } = {}) {
    const existing = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, aiTokenUsage: true, aiUsageCount: true },
    });

    if (!existing) {
      throw new ServiceError("Target user not found.", 404, "USER_NOT_FOUND");
    }

    const data = {};
    if (resetDailyCount) {
      data.aiUsageCount = 0;
    }

    if (extraTokens && !isNaN(parseInt(extraTokens, 10))) {
      const grant = parseInt(extraTokens, 10);
      data.aiTokenUsage = Math.max(0, existing.aiTokenUsage - grant); // Giving extra quota effectively decreases accumulated usage count
    }

    const updated = await prisma.user.update({
      where: { id: userId },
      data,
      select: {
        id: true,
        email: true,
        name: true,
        aiTokenUsage: true,
        aiUsageCount: true,
      },
    });

    await recordAudit({
      actorId: actorId || null,
      action: "USER_QUOTA_RESET",
      targetModel: "User",
      targetId: userId,
      beforeSnapshot: { aiTokenUsage: existing.aiTokenUsage, aiUsageCount: existing.aiUsageCount },
      afterSnapshot: { aiTokenUsage: updated.aiTokenUsage, aiUsageCount: updated.aiUsageCount, extraTokens, resetDailyCount },
      req,
    });

    return updated;
  }
}

export const adminUserService = new AdminUserService();
