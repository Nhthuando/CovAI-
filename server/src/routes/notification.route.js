import express from "express";
import { authMiddleware } from "../middlewares/auth.middleware.js";
import {
    listNotifications,
    markAsRead,
    markAllAsRead,
} from "../controllers/notification.controller.js";

const router = express.Router();

// GET /api/notifications -> Lấy danh sách
router.get("/", authMiddleware, listNotifications);

// PATCH /api/notifications/read-all -> Đánh dấu tất cả đã đọc
// (Lưu ý quan trọng: Endpoint tĩnh 'read-all' phải khai báo TRƯỚC endpoint động ':id')
router.patch("/read-all", authMiddleware, markAllAsRead);

// PATCH /api/notifications/:id/read -> Đánh dấu 1 thông báo cụ thể
router.patch("/:id/read", authMiddleware, markAsRead);

export default router;
