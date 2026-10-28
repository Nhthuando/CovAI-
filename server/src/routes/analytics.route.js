import express from "express";
import { getDashboardAnalytics } from "../controllers/analytics.controller.js";
import { authMiddleware } from "../middlewares/auth.middleware.js";

const router = express.Router();

/**
 * Admin-only middleware.
 * Check if user email is present in ADMIN_EMAILS env.
 * ADMIN_EMAILS format: "admin1@example.com,admin2@example.com"
 */
const adminOnly = (req, res, next) => {
  const adminEmails = (process.env.ADMIN_EMAILS || "").split(",").map(e => e.trim().toLowerCase()).filter(Boolean);
  const userEmail = req.user?.email?.toLowerCase();

  if (!userEmail || !adminEmails.includes(userEmail)) {
    return res.status(403).json({
      success: false,
      message: "You are not authorized to access this feature.",
    });
  }
  next();
};

// Get Dashboard analytics data (Admin only)
router.get("/dashboard", authMiddleware, adminOnly, getDashboardAnalytics);

export default router;