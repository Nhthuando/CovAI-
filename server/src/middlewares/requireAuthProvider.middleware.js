import prisma from "../config/prisma.js";
import { AUTH_ERROR_CODES, AUTH_MESSAGES } from "../../../shared/authValidation.js";
import {
  AUTH_PROVIDERS,
  normalizeAuthProvider,
} from "../../../shared/versionControlMode.js";

/**
 * Resolves the active session's authentication provider ("github" | "email").
 * Uses the JWT claim when present, and falls back to DB inspection for legacy tokens.
 */
export async function resolveRequestAuthProvider(req, db = prisma) {
  const fromToken = normalizeAuthProvider(req?.user?.authProvider);
  if (fromToken) return fromToken;

  if (!req?.user?.id) return null;

  const user = await db.user.findUnique({
    where: { id: req.user.id },
    select: {
      passwordHash: true,
      githubUserId: true,
      lastAuthProvider: true,
    },
  });

  if (!user) return null;

  const resolved =
    normalizeAuthProvider(user.lastAuthProvider) ||
    (!user.passwordHash && user.githubUserId
      ? AUTH_PROVIDERS.GITHUB
      : AUTH_PROVIDERS.EMAIL);

  req.user.authProvider = resolved;
  return resolved;
}

/**
 * Express middleware enforcing exclusive access by login provider.
 * Blocks GitHub-only endpoints for Email sessions and Snapshot VCS endpoints for GitHub sessions.
 */
export const requireAuthProvider =
  (expectedProvider, dependencies = {}) =>
  async (req, res, next) => {
    try {
      const normalizedExpected = normalizeAuthProvider(expectedProvider);
      if (!normalizedExpected) {
        return res.status(500).json({
          success: false,
          code: "AUTH_PROVIDER_CONFIG_ERROR",
          message: "Invalid required auth provider configuration.",
        });
      }

      if (!req.user?.id) {
        return res.status(401).json({
          success: false,
          message: "Authentication required",
        });
      }

      const db = dependencies.db || prisma;
      const actualProvider = await resolveRequestAuthProvider(req, db);
      if (!actualProvider) {
        return res.status(401).json({
          success: false,
          message: "User session could not be resolved.",
        });
      }

      if (actualProvider !== normalizedExpected) {
        return res.status(403).json({
          success: false,
          code: AUTH_ERROR_CODES.AUTH_PROVIDER_MISMATCH,
          expectedProvider: normalizedExpected,
          actualProvider,
          message:
            normalizedExpected === AUTH_PROVIDERS.GITHUB
              ? AUTH_MESSAGES.AUTH_PROVIDER_MISMATCH_GITHUB
              : AUTH_MESSAGES.AUTH_PROVIDER_MISMATCH_EMAIL,
        });
      }

      return next();
    } catch (error) {
      console.error("[requireAuthProvider] Error:", error?.message || error);
      return res.status(500).json({
        success: false,
        code: "AUTH_PROVIDER_CHECK_FAILED",
        message: "Unable to verify session authentication provider.",
      });
    }
  };
