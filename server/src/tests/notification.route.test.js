import request from "supertest";
import express from "express";
import { jest } from "@jest/globals";

import notificationRouter from "../routes/notification.routes.js";
import { notificationService } from "../services/notification.service.js";

jest.mock("../middlewares/auth.middleware.js", () => ({
    authMiddleware: (req, res, next) => {
        req.user = {
            id: "user-123",
            role: "ADMIN",
        };
        next();
    },
}));

jest.mock("../services/notification.service.js", () => ({
    notificationService: {
        getUserNotifications: jest.fn(),
        getUnreadCount: jest.fn(),
        markAsRead: jest.fn(),
        markAllAsRead: jest.fn(),
        createNotification: jest.fn(),
    },
    CuidSchema: {},
}));

const app = express();
app.use(express.json());
app.use("/notifications", notificationRouter);

describe("Notification Routes", () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe("GET /notifications", () => {
        it("should return notifications", async () => {
            notificationService.getUserNotifications.mockResolvedValue({
                notifications: [
                    {
                        id: "1",
                        title: "Hello",
                    },
                ],
                total: 1,
            });

            const res = await request(app)
                .get("/notifications");

            expect(res.status).toBe(200);

            expect(notificationService.getUserNotifications)
                .toHaveBeenCalledWith("user-123", 1, 20);

            expect(res.body.notifications).toHaveLength(1);
        });
    });

    describe("GET /notifications/unread-count", () => {
        it("should return unread count", async () => {
            notificationService.getUnreadCount.mockResolvedValue({
                unread: 5,
            });

            const res = await request(app)
                .get("/notifications/unread-count");

            expect(res.status).toBe(200);

            expect(notificationService.getUnreadCount)
                .toHaveBeenCalledWith("user-123");

            expect(res.body.unread).toBe(5);
        });
    });

    describe("PATCH /notifications/read-all", () => {
        it("should mark all notifications as read", async () => {
            notificationService.markAllAsRead.mockResolvedValue(4);

            const res = await request(app)
                .patch("/notifications/read-all");

            expect(res.status).toBe(200);

            expect(notificationService.markAllAsRead)
                .toHaveBeenCalledWith("user-123");

            expect(res.body.message)
                .toContain("Successfully marked 4 notifications");
        });
    });

    describe("PATCH /notifications/:id/read", () => {
        it("should mark notification as read", async () => {
            notificationService.markAsRead.mockResolvedValue({
                id: "notification-1",
                isRead: true,
            });

            const res = await request(app)
                .patch("/notifications/notification-1/read");

            expect(res.status).toBe(200);

            expect(notificationService.markAsRead)
                .toHaveBeenCalledWith(
                    "notification-1",
                    "user-123"
                );

            expect(res.body.isRead).toBe(true);
        });
    });

    describe("Service Error", () => {
        it("should return 500 when service throws", async () => {
            notificationService.getUnreadCount.mockRejectedValue(
                new Error("Database Error")
            );

            const res = await request(app)
                .get("/notifications/unread-count");

            expect(res.status).toBe(500);
        });
    });
});