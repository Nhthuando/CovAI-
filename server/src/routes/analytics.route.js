import express from "express";
import { getDashboardAnalytics } from "../controllers/analytics.controller.js";
import { authMiddleware } from "../middlewares/auth.middleware.js";

const router = express.Router();

// Get Dashboard analytics data (Login required)
router.get("/dashboard", authMiddleware, getDashboardAnalytics);

export default router;