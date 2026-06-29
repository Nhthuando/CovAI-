import { notificationService } from './notification.service';
import { ServiceError } from '../utils/serviceError';

// Mock function to simulate AI generation
async function performAiGeneration(type: 'SUGGESTION' | 'TEST', projectId: string) {
    // In a real app, this would trigger the AI workflow
    console.log(`Performing AI ${type} generation for project ${projectId}`);
    return true; // Simulate success
}

export const aiService = {
    generateAiSuggestions: async (projectId: string, userId: string) => {
        try {
            const success = await performAiGeneration('SUGGESTION', projectId);
            if (success) {
                await notificationService.createAIReadyNotification(userId, projectId);
                console.log(`Created AI_READY notification for project ${projectId}`);
            }
            return { success };
        } catch (error) {
            console.error(`Error generating AI suggestions for project ${projectId}:`, error);
            throw new ServiceError('Failed to generate AI suggestions.', 500);
        }
    },

    generateAiTests: async (projectId: string, userId: string) => {
        try {
            const success = await performAiGeneration('TEST', projectId);
            if (success) {
                await notificationService.createAIReadyNotification(userId, projectId);
                console.log(`Created AI_READY notification for project ${projectId}`);
            }
            return { success };
        } catch (error) {
            console.error(`Error generating AI tests for project ${projectId}:`, error);
            throw new ServiceError('Failed to generate AI tests.', 500);
        }
    },
};