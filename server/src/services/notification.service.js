import prisma from '../config/prisma.js';

/**
 * SCRUM-480: Create notification
 * Creates a notification when a job completes (SUCCESS or FAILED)
 */
export const createJobFinishedNotification = async (jobId) => {
    try {
        const job = await prisma.job.findUnique({
            where: { id: jobId },
            include: { project: true }
        });

        if (!job) {
            console.error(`[NotificationService] Job ${jobId} not found when creating notification.`);
            return null;
        }

        // If the job has no associated user, we cannot create a user notification
        if (!job.userId) {
            console.log(`[NotificationService] Job ${jobId} has no userId, skipping notification.`);
            return null;
        }

        // SCRUM-477, SCRUM-478, SCRUM-479
        const projectName = job.project ? job.project.name : "Unknown Project";
        const jobType = job.type;
        const jobStatus = job.status;

        let notificationType = "JOB_FINISHED";
        let notificationTitle = `Job ${jobStatus}`;
        let notificationMessage = `Job ${jobType} for project '${projectName}' finished with status ${jobStatus}.`;

        if (jobStatus === "FAILED" && job.errorMessage) {
            notificationMessage += ` Error: ${job.errorMessage}`;
        }

        // SCRUM-482, SCRUM-486: AI Ready Notification
        if (jobStatus === "SUCCESS" && (jobType === "AI_SUGGEST" || jobType === "AI_TESTS")) {
            notificationType = "AI_READY";
            notificationTitle = "AI Results Ready";
            notificationMessage = `The AI has finished generating results for project '${projectName}'.`;
        }

        const notification = await prisma.notification.create({
            data: {
                userId: job.userId,
                projectId: job.projectId,
                type: notificationType,
                title: notificationTitle,
                message: notificationMessage
            }
        });

        return notification;
    } catch (error) {
        console.error(`[NotificationService] Error creating notification for job ${jobId}:`, error);
        return null; // Return null on error so we don't crash the job flow
    }
};

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
