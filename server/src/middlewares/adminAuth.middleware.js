import jwt from "jsonwebtoken";
import dotenv from "dotenv";
import prisma from "../config/prisma.js";
import {
  SYSTEM_ROLES,
  isAdminRole,
  hasAdminPermission,
} from "../../../shared/adminRoles.js";

dotenv.config();

/**
 * Base Admin Authentication Middleware
 * Verifies JWT, loads fresh user status, checks role & suspension, supports ADMIN_EMAILS fallback.
 */
export const adminAuthMiddleware = async (req, res, next) => {
  try {
    const tokenQuery = req.query?.token ? `Bearer ${req.query.token}` : null;
    const bearerToken =
      (typeof req.header === "function"
        ? req.header("authorization") || req.header("Authorization")
        : req.headers?.authorization || req.headers?.Authorization) || tokenQuery;

    if (!bearerToken) {
      return res.status(401).json({
        success: false,
        message: "Authentication token is missing. Please log in.",
        code: "UNAUTHENTICATED",
      });
    }

    const match = bearerToken.match(/^Bearer\s+(.+)$/i);
    if (!match || !match[1]) {
      return res.status(401).json({
        success: false,
        message: "Invalid token format. Bearer prefix required.",
        code: "INVALID_TOKEN_FORMAT",
      });
    }

    const token = match[1];
    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) {
      return res.status(500).json({
        success: false,
        message: "Server configuration error: JWT_SECRET not found.",
        code: "SERVER_CONFIG_ERROR",
      });
    }

    let decoded;
    try {
      decoded = jwt.verify(token, jwtSecret);
    } catch (err) {
      if (err.name === "TokenExpiredError") {
        return res.status(401).json({
          success: false,
          message: "Session expired. Please log in again.",
          code: "TOKEN_EXPIRED",
        });
      }
      return res.status(401).json({
        success: false,
        message: "Invalid authentication token.",
        code: "INVALID_TOKEN",
      });
    }

    const userId = decoded.userId || decoded.id;
    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Token payload missing user identifier.",
        code: "MALFORMED_TOKEN_PAYLOAD",
      });
    }

    // Always fetch fresh user state from Database to prevent stale privileges
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        name: true,
        avatarUrl: true,
        systemRole: true,
        isSuspended: true,
      },
    });

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "User account no longer exists.",
        code: "USER_NOT_FOUND",
      });
    }

    if (user.isSuspended) {
      return res.status(403).json({
        success: false,
        message: "Account has been suspended! Please contact platform administration.",
        code: "ACCOUNT_SUSPENDED",
      });
    }

    // Support ADMIN_EMAILS environment variable fallback
    const adminEmails = (process.env.ADMIN_EMAILS || "")
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean);

    const userEmail = (user.email || "").toLowerCase();
    let effectiveRole = user.systemRole;

    if (adminEmails.includes(userEmail) && effectiveRole === SYSTEM_ROLES.USER) {
      effectiveRole = SYSTEM_ROLES.SUPERADMIN;
    }

    if (!isAdminRole(effectiveRole)) {
      return res.status(403).json({
        success: false,
        message: "You do not have administrative privileges to access this console.",
        code: "FORBIDDEN_NOT_ADMIN",
      });
    }

    req.user = {
      ...user,
      systemRole: effectiveRole,
    };
    req.adminRole = effectiveRole;

    return next();
  } catch (error) {
    console.error("[adminAuthMiddleware Error]:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error during admin authentication.",
      code: "INTERNAL_AUTH_ERROR",
    });
  }
};

/**
 * Granular Permission Guard Middleware Factory
 * Checks if the authenticated admin has the requested permission
 * @param {string} permission - e.g. ADMIN_PERMISSIONS.MUTATE_DATA
 */
export const requireAdminPermission = (permission) => {
  return (req, res, next) => {
    const role = req.adminRole || req.user?.systemRole;
    if (!role) {
      return res.status(401).json({
        success: false,
        message: "Admin role not established.",
        code: "UNAUTHENTICATED",
      });
    }

    if (hasAdminPermission(role, permission)) {
      return next();
    }

    return res.status(403).json({
      success: false,
      message: `Your administrative role '${role}' lacks the required '${permission}' permission.`,
      code: "FORBIDDEN_INSUFFICIENT_PERMISSIONS",
      requiredPermission: permission,
      currentRole: role,
    });
  };
};

/**
 * SuperAdmin Only Guard Middleware
 */
export const requireSuperAdmin = (req, res, next) => {
  const role = req.adminRole || req.user?.systemRole;
  if (role === SYSTEM_ROLES.SUPERADMIN) {
    return next();
  }

  return res.status(403).json({
    success: false,
    message: "This operation strictly requires SUPERADMIN privileges.",
    code: "FORBIDDEN_SUPERADMIN_ONLY",
  });
};
