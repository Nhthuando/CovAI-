import { jest } from '@jest/globals';
import { refreshAiSuggestions } from '../services/aiSuggestion.service.js';
import prisma from '../config/prisma.js';

// Mock dependencies
const mockPrisma = {
    project: {
        findUnique: jest.fn()
    },
    snapshot: {
        findFirst: jest.fn()
    }
};

jest.mock('../config/prisma.js', () => ({
    __esModule: true,
    default: mockPrisma
}));

jest.mock('../services/aiSuggestJob.service.js', () => ({
    processAiSuggestJob: jest.fn()
}), { virtual: true });

describe('aiSuggestion.service - refreshAiSuggestions', () => {
    const mockUserId = 'user123';
    const mockProjectId = 'proj123';

    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('should throw 401 if userId is missing', async () => {
        await expect(refreshAiSuggestions({ projectId: mockProjectId, userId: null }))
            .rejects.toThrow('Unauthorized');
    });

    it('should throw 404 if project not found', async () => {
        mockPrisma.project.findUnique.mockResolvedValue(null);
        await expect(refreshAiSuggestions({ projectId: mockProjectId, userId: mockUserId }))
            .rejects.toThrow('Project not found');
    });

    it('should throw 403 if user is not owner', async () => {
        mockPrisma.project.findUnique.mockResolvedValue({ id: mockProjectId, ownerId: 'otherUser' });
        await expect(refreshAiSuggestions({ projectId: mockProjectId, userId: mockUserId }))
            .rejects.toThrow('Forbidden');
    });

    it('should throw 404 if no snapshots found', async () => {
        mockPrisma.project.findUnique.mockResolvedValue({ id: mockProjectId, ownerId: mockUserId });
        mockPrisma.snapshot.findFirst.mockResolvedValue(null);
        await expect(refreshAiSuggestions({ projectId: mockProjectId, userId: mockUserId }))
            .rejects.toThrow('No snapshots found for this project');
    });

    it('should return success if suggestions are refreshed', async () => {
        mockPrisma.project.findUnique.mockResolvedValue({ id: mockProjectId, ownerId: mockUserId });
        mockPrisma.snapshot.findFirst.mockResolvedValue({ id: 'snap123' });
        
        const result = await refreshAiSuggestions({ projectId: mockProjectId, userId: mockUserId });
        expect(result).toEqual({ success: true, message: 'Suggestions refreshed successfully' });
    });
});