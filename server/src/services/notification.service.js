import prismaClient from '../config/prisma.js';
import { ServiceError } from '../utils/serviceError.js';
import { z } from 'zod';

const prisma = prismaClient;

// --- Schemas ---

export const NotificationTypeSchema = z.enum([
    'JOB_FINISHED',
    'AI_READY',
    'SYSTEM',
]);

export const CuidSchema = z.string().cuid();

export const CreateNotificationSchema = z.object({
    userId: CuidSchema,
    projectId: CuidSchema.optional(),
    type: NotificationTypeSchema,
    title: z.string().min(1).max(255),
    message: z.string().min(1),
});

export const NotificationIdSchema = CuidSchema;

// --- Service ---

export const notificationService = {
    createNotification: async (data) => {
        try {
            const validatedData = CreateNotificationSchema.parse(data);

            return await prisma.notification.create({
                data: {
                    user: { connect: { id: validatedData.userId } },
                    ...(validatedData.projectId && {
                        project: { connect: { id: validatedData.projectId } },
                    }),
                    type: validatedData.type,
                    title: validatedData.title,
                    message: validatedData.message,
                    readAt: null,
                },
            });
        } catch (error) {
            if (error instanceof z.ZodError) {
                throw new ServiceError('Invalid notification data provided.', 400);
            }
            if (error.code === 'P2025') {
                throw new ServiceError('User or Project not found.', 404);
            }
            if (error instanceof ServiceError) throw error;
            console.error('Error in createNotification:', error);
            throw new ServiceError('Failed to create notification.', 500);
        }
    },

    createAIReadyNotification: async (userId, projectId) => {
        return await notificationService.createNotification({
            userId,
            projectId,
            type: 'AI_READY',
            title: 'AI Analysis Ready',
            message: 'Your AI analysis has completed successfully.',
        });
    },

    createJobFinishedNotification: async (
        userId,
        projectId,
        title = 'Job Finished',
        message = 'Your requested job has completed successfully.'
    ) => {
        return await notificationService.createNotification({
            userId,
            projectId,
            type: 'JOB_FINISHED',
            title,
            message,
        });
    },

    createSystemNotification: async (userId, title, message) => {
        return await notificationService.createNotification({
            userId,
            type: 'SYSTEM',
            title,
            message,
        });
    },

    getUserNotifications: async (
        userId,
        page = 1,
        limit = 20
    ) => {
        try {
            const validatedUserId = CuidSchema.parse(userId);
            const validatedPage = z.number().int().positive().parse(Number(page));
            const validatedLimit = z.number().int().positive().parse(Number(limit));

            const skip = (validatedPage - 1) * validatedLimit;

            const [notifications, total] = await prisma.$transaction([
                prisma.notification.findMany({
                    where: { userId: validatedUserId },
                    include: { project: { select: { id: true, name: true } } },
                    orderBy: { createdAt: 'desc' },
                    skip,
                    take: validatedLimit,
                }),
                prisma.notification.count({ where: { userId: validatedUserId } }),
            ]);

            return {
                data: notifications,
                pagination: {
                    page: validatedPage,
                    limit: validatedLimit,
                    total,
                    totalPages: Math.ceil(total / validatedLimit),
                },
            };
        } catch (error) {
            if (error instanceof ServiceError) throw error;
            if (error instanceof z.ZodError) throw new ServiceError('Invalid pagination parameters.', 400);
            console.error('Error in getUserNotifications:', error);
            throw new ServiceError('Failed to fetch notifications.', 500);
        }
    },

    markAsRead: async (notificationId, userId) => {
        try {
            const validatedNotificationId = NotificationIdSchema.parse(notificationId);
            const validatedUserId = CuidSchema.parse(userId);

            const existingNotification = await prisma.notification.findUnique({
                where: { id: validatedNotificationId },
                select: { userId: true },
            });

            if (!existingNotification) {
                throw new ServiceError('Notification not found.', 404);
            }

            if (existingNotification.userId !== validatedUserId) {
                throw new ServiceError('You do not have permission.', 403);
            }

            return await prisma.notification.update({
                where: { id: validatedNotificationId },
                data: { readAt: new Date() },
            });
        } catch (error) {
            if (error instanceof ServiceError) throw error;
            if (error instanceof z.ZodError) throw new ServiceError('Invalid notification ID.', 400);
            console.error('Error in markAsRead:', error);
            throw new ServiceError('Failed to mark notification as read.', 500);
        }
    },

    markAllAsRead: async (userId) => {
        try {
            const validatedUserId = CuidSchema.parse(userId);
            const result = await prisma.notification.updateMany({
                where: { userId: validatedUserId, readAt: null },
                data: { readAt: new Date() },
            });
            return result.count;
        } catch (error) {
            if (error instanceof ServiceError) throw error;
            if (error instanceof z.ZodError) throw new ServiceError('Invalid user ID.', 400);
            console.error('Error in markAllAsRead:', error);
            throw new ServiceError('Failed to mark all notifications as read.', 500);
        }
    },

    getUnreadCount: async (userId) => {
        try {
            const validatedUserId = CuidSchema.parse(userId);
            const count = await prisma.notification.count({
                where: { userId: validatedUserId, readAt: null },
            });
            return { count };
        } catch (error) {
            if (error instanceof ServiceError) throw error;
            if (error instanceof z.ZodError) throw new ServiceError('Invalid user ID.', 400);
            console.error('Error in getUnreadCount:', error);
            throw new ServiceError('Failed to get unread notification count.', 500);
        }
    },

    createSystemBroadcastNotification: async (title, message) => {
        try {
            z.string().min(1).max(255).parse(title);
            z.string().min(1).parse(message);

            const users = await prisma.user.findMany({ select: { id: true } });
            if (users.length === 0) return 0;

            const result = await prisma.notification.createMany({
                data: users.map((user) => ({
                    userId: user.id,
                    type: 'SYSTEM',
                    title,
                    message,
                    readAt: null,
                })),
            });
            return result.count;
        } catch (error) {
            if (error instanceof ServiceError) throw error;
            if (error instanceof z.ZodError) throw new ServiceError('Invalid broadcast data.', 400);
            console.error('Error in createSystemBroadcastNotification:', error);
            throw new ServiceError('Failed to create system broadcast notification.', 500);
        }
    },
};