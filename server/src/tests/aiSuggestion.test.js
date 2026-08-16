import { jest } from '@jest/globals';

const prismaMock = {
    project: {
        findUnique: jest.fn()
    },
    snapshot: {
        findFirst: jest.fn()
    }
};

jest.unstable_mockModule('../config/prisma.js', () => ({
    default: prismaMock
}));

const mockProcessAiSuggestJob = jest.fn();
jest.unstable_mockModule('../services/aiSuggestJob.service.js', () => ({
    processAiSuggestJob: mockProcessAiSuggestJob
}));

const { refreshAiSuggestions } = await import('../services/aiSuggestion.service.js');
const prisma = prismaMock;

describe('aiSuggestionService - refreshAiSuggestions', () => {
    const mockUserId = 'user123';
    const mockProjectId = 'proj123';

    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('should throw 401 if userId is missing', async () => {
        await expect(refreshAiSuggestions({ projectId: mockProjectId, userId: null }))
            .rejects.toThrow('Unauthorized');
    });

    it('should throw 404 if project does not exist', async () => {
        prisma.project.findUnique.mockResolvedValue(null);
        await expect(refreshAiSuggestions({ projectId: mockProjectId, userId: mockUserId }))
            .rejects.toThrow('Project not found');
    });

    it('should throw 403 if user is not the owner', async () => {
        prisma.project.findUnique.mockResolvedValue({ ownerId: 'otherUser' });
        await expect(refreshAiSuggestions({ projectId: mockProjectId, userId: mockUserId }))
            .rejects.toThrow('Forbidden');
    });

    it('should return success message if valid', async () => {
        prisma.project.findUnique.mockResolvedValue({ ownerId: mockUserId });
        prisma.snapshot.findFirst.mockResolvedValue({ id: 'snapshot-1' });
        const result = await refreshAiSuggestions({ projectId: mockProjectId, userId: mockUserId });
        expect(result.success).toBe(true);
        expect(result.message).toBe('Suggestions refreshed successfully');
    });
});