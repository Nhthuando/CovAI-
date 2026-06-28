import prisma from '../config/prisma.js';

export const getNotifications = async ({ userId, page = 1, limit = 20, unreadOnly = false }) => {
    const db = prisma;
    if (!db) throw new Error('Prisma client instance is not properly initialized.');

    if (!userId) {
        const error = new Error('User ID is required');
        error.status = 400;
        throw error;
    }

    const skip = (Math.max(1, page) - 1) * limit;

    // Lọc thông báo của user này, và kiểm tra biến unreadOnly
    const where = {
        userId,
        ...(unreadOnly === 'true' || unreadOnly === true ? { readAt: null } : {})
    };

    // Chạy 3 câu query song song để tối ưu tốc độ
    const [total, unreadCount, notifications] = await Promise.all([
        db.notification.count({ where }),
        db.notification.count({ where: { userId, readAt: null } }),
        db.notification.findMany({
            where,
            skip,
            take: Number(limit),
            orderBy: { createdAt: 'desc' }
        })
    ]);

    return {
        data: notifications,
        meta: {
            unreadCount,
            pagination: {
                total,
                page: Number(page),
                limit: Number(limit),
                totalPages: Math.ceil(total / limit)
            }
        }
    };
};

export const markAsRead = async ({ notificationId, userId }) => {
    const db = prisma;
    if (!db) throw new Error('Prisma client instance is not properly initialized.');

    const notification = await db.notification.findUnique({
        where: { id: notificationId }
    });

    if (!notification) {
        const error = new Error('Notification not found');
        error.status = 404;
        throw error;
    }

    // Chống IDOR: Không cho phép user khác sửa thông báo của mình
    if (notification.userId !== userId) {
        const error = new Error('Forbidden: You do not have access to this notification');
        error.status = 403;
        throw error;
    }

    return await db.notification.update({
        where: { id: notificationId },
        data: { readAt: new Date() }
    });
};

export const markAllAsRead = async ({ userId }) => {
    const db = prisma;
    if (!db) throw new Error('Prisma client instance is not properly initialized.');

    if (!userId) {
        const error = new Error('User ID is required');
        error.status = 400;
        throw error;
    }

    // Update hàng loạt cực nhanh bằng Prisma
    const result = await db.notification.updateMany({
        where: {
            userId,
            readAt: null
        },
        data: { readAt: new Date() }
    });

    return { updatedCount: result.count };
};
