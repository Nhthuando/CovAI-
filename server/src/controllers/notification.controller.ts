import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { notificationService, CuidSchema } from '../services/notification.service';
import { ServiceError } from '../utils/serviceError';

export const notificationController = {
    getNotifications: async (req: Request, res: Response, next: NextFunction) => {
        try {
            const userId = (req as any).user.id;
            const page = parseInt(req.query.page as string) || 1;
            const limit = parseInt(req.query.limit as string) || 20;

            const result = await notificationService.getUserNotifications(userId, page, limit);
            res.status(200).json(result);
        } catch (error) {
            next(error);
        }
    },

    getUnreadCount: async (req: Request, res: Response, next: NextFunction) => {
        try {
            const userId = (req as any).user.id;
            const result = await notificationService.getUnreadCount(userId);
            res.status(200).json(result);
        } catch (error) {
            next(error);
        }
    },

    markNotificationAsRead: async (req: Request, res: Response, next: NextFunction) => {
        try {
            const notificationId = typeof req.params.id === 'string' ? req.params.id : req.params.id[0];
            const userId = (req as any).user.id;

            const updatedNotification = await notificationService.markAsRead(notificationId, userId);
            res.status(200).json(updatedNotification);
        } catch (error) {
            next(error);
        }
    },

    markAllAsRead: async (req: Request, res: Response, next: NextFunction) => {
        try {
            const userId = (req as any).user.id;
            const count = await notificationService.markAllAsRead(userId);
            res.status(200).json({ message: `Successfully marked ${count} notifications as read.` });
        } catch (error) {
            next(error);
        }
    },

    createNotification: async (req: Request, res: Response, next: NextFunction) => {
        try {
            const user = (req as any).user;

            if (user.role !== 'ADMIN') {
                throw new ServiceError('You do not have permission to create notifications.', 403);
            }

            const notificationData = req.body;
            const createdNotification = await notificationService.createNotification(notificationData);
            res.status(201).json(createdNotification);
        } catch (error) {
            if (error instanceof z.ZodError) {
                return next(
                    new ServiceError(
                        'Invalid request data.',
                        400
                    )
                );
            }

            next(error);
        }
    },
};