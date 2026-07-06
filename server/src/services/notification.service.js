import prismaClient from '../config/prisma.js';
import { ServiceError } from '../utils/serviceError.js';
import { z } from 'zod';
import { eventDispatcher, NOTIFICATION_EVENT } from '../utils/eventDispatcher.js';

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

            const notification = await prisma.notification.create({
                data: {
                    userId: validatedData.userId,
                    projectId: validatedData.projectId,
                    type: validatedData.type,
                    title: validatedData.title,
                    message: validatedData.message,
                    readAt: null,
                },
                include: {
                    project: {
                        select: { id: true, name: true }
                    }
                }
            });

            // Emit event for real-time notification
            eventDispatcher.emit(NOTIFICATION_EVENT, {
                userId: notification.userId,
                notification: notification,
            });

            // Emit via Socket.IO if available
            if (global.io) {
                console.log(`[NotificationService] Emitting notification to user:${notification.userId}`);
                global.io.to(`user:${notification.userId}`).emit('notification', notification);
            }

            return notification;
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

    /**
     * SCRUM-480: Creates a notification when a job completes (SUCCESS or FAILED).
     * Merged from standalone export — includes AI_READY logic (SCRUM-482, SCRUM-486).
     */
    createJobFinishedNotification: async (jobId) => {
        try {
            console.log(`[NotificationService] Creating notification for job ${jobId}`);
            const job = await prisma.job.findUnique({
                where: { id: jobId },
                include: { project: true },
            });

            if (!job) {
                console.error(`[NotificationService] Job ${jobId} not found when creating notification.`);
                return null;
            }
            console.log(`[NotificationService] Job found:`, job.id, job.status);

            if (!job.userId) {
                console.log(`[NotificationService] Job ${jobId} has no userId, skipping notification.`);
                return null;
            }

            const projectName = job.project ? job.project.name : 'Unknown Project';
            const jobType = job.type;
            const jobStatus = job.status;

            let notificationType = 'JOB_FINISHED';
            let notificationTitle = `Job ${jobStatus}`;
            let notificationMessage = `Job ${jobType} for project '${projectName}' finished with status ${jobStatus}.`;

            if (jobStatus === 'FAILED' && job.errorMessage) {
                notificationMessage += ` Error: ${job.errorMessage}`;
            }

            // SCRUM-482, SCRUM-486: AI Ready Notification
            if (jobStatus === 'SUCCESS' && (jobType === 'AI_SUGGEST' || jobType === 'AI_TESTS')) {
                notificationType = 'AI_READY';
                notificationTitle = 'AI Results Ready';
                notificationMessage = `The AI has finished generating results for project '${projectName}'.`;
            }

            return await notificationService.createNotification({
                userId: job.userId,
                projectId: job.projectId,
                type: notificationType,
                title: notificationTitle,
                message: notificationMessage,
            });
        } catch (error) {
            console.error(`[NotificationService] Error creating notification for job ${jobId}:`, error);
            return null; // Don't crash the job flow
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

    createSystemNotification: async (userId, title, message) => {
        return await notificationService.createNotification({
            userId,
            type: 'SYSTEM',
            title,
            message,
        });
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

    /**
     * Merged: supports unreadOnly filter (from standalone export) and
     * returns unreadCount in meta alongside pagination.
     */
    getUserNotifications: async (userId, page = 1, limit = 20, unreadOnly = false) => {
        try {
            const validatedUserId = CuidSchema.parse(userId);
            const validatedPage = z.number().int().positive().parse(Number(page));
            const validatedLimit = z.number().int().positive().parse(Number(limit));

            const skip = (validatedPage - 1) * validatedLimit;

            const where = {
                userId: validatedUserId,
                ...(unreadOnly === true || unreadOnly === 'true' ? { readAt: null } : {}),
            };

            const [notifications, total, unreadCount] = await Promise.all([
                prisma.notification.findMany({
                    where,
                    include: { project: { select: { id: true, name: true } } },
                    orderBy: { createdAt: 'desc' },
                    skip,
                    take: validatedLimit,
                }),
                prisma.notification.count({ where }),
                prisma.notification.count({ where: { userId: validatedUserId, readAt: null } }),
            ]);

            return {
                data: notifications,
                meta: {
                    unreadCount,
                    pagination: {
                        page: validatedPage,
                        limit: validatedLimit,
                        total,
                        totalPages: Math.ceil(total / validatedLimit),
                    },
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
            return { updatedCount: result.count };
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
};