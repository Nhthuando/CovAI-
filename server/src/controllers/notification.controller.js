import { z } from "zod";
import { notificationService } from "../services/notification.service.js";
import { ServiceError } from "../utils/serviceError.js";

export const notificationController = {
    async getNotifications(req, res, next) {
        try {
            const userId = req.user?.id;
            if (!userId) {
                return res.status(401).json({ success: false, message: "Unauthorized" });
            }

            const page = req.query.page ? Number(req.query.page) : undefined;
            const limit = req.query.limit ? Number(req.query.limit) : undefined;
            const unreadOnly = req.query.unreadOnly === "true";

            const result = await notificationService.getUserNotifications(
                userId,
                page,
                limit,
                unreadOnly
            );

            res.status(200).json({ success: true, ...result });
        } catch (error) {
            next(error);
        }
    },

    async getUnreadCount(req, res, next) {
        try {
            const userId = req.user?.id;
            if (!userId) {
                return res.status(401).json({ success: false, message: "Unauthorized" });
            }

            const result = await notificationService.getUnreadCount(userId);

            res.status(200).json({
                success: true,
                count: result.count,
            });
        } catch (error) {
            next(error);
        }
    },

    async markNotificationAsRead(req, res, next) {
        try {
            const userId = req.user?.id;
            if (!userId) {
                return res.status(401).json({ success: false, message: "Unauthorized" });
            }

            const { id } = req.params;

            const notification = await notificationService.markAsRead(
                id,
                userId
            );

            res.status(200).json({
                success: true,
                data: notification,
            });
        } catch (error) {
            next(error);
        }
    },

    async markAllAsRead(req, res, next) {
        try {
            const userId = req.user?.id;
            if (!userId) {
                return res.status(401).json({ success: false, message: "Unauthorized" });
            }

            const result = await notificationService.markAllAsRead(userId);

            res.status(200).json({
                success: true,
                message: `Successfully marked ${result.updatedCount} notifications as read`,
            });
        } catch (error) {
            next(error);
        }
    },

    async createNotification(req, res, next) {
        try {
            const user = req.user;

            if (!user) {
                return res.status(401).json({ success: false, message: "Unauthorized" });
            }

            // NOTE: requires `role` field on the Prisma User model (see schema fix)
            // and the auth middleware to actually attach `role` onto req.user
            // (e.g. by selecting it when loading the user from the JWT/session).
            if (user.role !== "ADMIN") {
                throw new ServiceError("No permission", 403);
            }

            const created = await notificationService.createNotification({
                userId: req.user.id,
                ...req.body,
            });

            res.status(201).json({
                success: true,
                data: created,
            });
        } catch (error) {
            if (error instanceof z.ZodError) {
                return next(new ServiceError("Invalid request data", 400));
            }
            next(error);
        }
    },
};