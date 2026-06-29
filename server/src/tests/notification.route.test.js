import request from "supertest";
import express from "express";
import { jest } from "@jest/globals";

// ---------------- MOCK SERVICE (PHẢI đặt trước import router) ----------------
const notificationServiceMock = {
    getUserNotifications: jest.fn(),
    getUnreadCount: jest.fn(),
    markAsRead: jest.fn(),
    markAllAsRead: jest.fn(),
    createNotification: jest.fn(),
};

// IMPORTANT: dùng factory inline KHÔNG reference outside variable
jest.unstable_mockModule("../services/notification.service.js", () => ({
    notificationService: notificationServiceMock,
}));

jest.unstable_mockModule("../middlewares/auth.middleware.js", () => ({
    authMiddleware: (req, res, next) => {
        req.user = { id: "user-123", role: "ADMIN" };
        next();
    },
}));

// ---------------- IMPORT SAU MOCK ----------------
const { default: notificationRouter } = await import("../routes/notification.routes.js");

// ---------------- APP ----------------
const app = express();
app.use(express.json());
app.use("/api/notifications", notificationRouter);

// ---------------- TESTS ----------------
describe("Notification API", () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it("GET notifications", async () => {
        notificationServiceMock.getUserNotifications.mockResolvedValue({
            data: [{ id: "1", title: "Hello" }],
            meta: { unreadCount: 1 },
        });

        const res = await request(app).get("/api/notifications");

        expect(res.status).toBe(200);
        expect(notificationServiceMock.getUserNotifications).toHaveBeenCalled();
    });
});