import express from "express";
import { authMiddleware } from "../middlewares/auth.middleware.js";
import { notificationController } from "../controllers/notification.controller.js";

const router = express.Router();

router.get("/", authMiddleware, notificationController.getNotifications);

router.get("/unread-count", authMiddleware, notificationController.getUnreadCount);

router.patch("/read-all", authMiddleware, notificationController.markAllAsRead);

router.patch("/:id/read", authMiddleware, notificationController.markNotificationAsRead);

router.post("/", authMiddleware, notificationController.createNotification);

export default router;