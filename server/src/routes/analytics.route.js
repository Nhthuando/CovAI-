import express from "express";
import { getDashboardAnalytics } from "../controllers/analytics.controller.js";
import { authMiddleware } from "../middlewares/auth.middleware.js";

const router = express.Router();

/**
 * Admin-only middleware.
 * Kiểm tra email của user có nằm trong ADMIN_EMAILS env không.
 * ADMIN_EMAILS format: "admin1@example.com,admin2@example.com"
 */
const adminOnly = (req, res, next) => {
  const adminEmails = (process.env.ADMIN_EMAILS || "").split(",").map(e => e.trim().toLowerCase()).filter(Boolean);
  const userEmail = req.user?.email?.toLowerCase();

  if (!userEmail || !adminEmails.includes(userEmail)) {
    return res.status(403).json({
      success: false,
      message: "Bạn không có quyền truy cập chức năng này.",
    });
  }
  next();
};

// Get Dashboard analytics data (Admin only)
router.get("/dashboard", authMiddleware, adminOnly, getDashboardAnalytics);

export default router;