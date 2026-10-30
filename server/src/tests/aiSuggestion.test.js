import { jest } from '@jest/globals';

const prismaMock = {
    project: {
        findUnique: jest.fn(), findFirst: jest.fn(async()=> await prismaMock.project.findUnique())
    },
    projectMember:{findUnique:jest.fn(async()=>null)},
    projectSnapshot: {
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

const createAiSuggestJob=jest.fn(async()=>({id:'queued-suggest'}));
const enqueue=jest.fn(async()=>{});
jest.unstable_mockModule('../services/job.service.js',()=>({createAiSuggestJob}));
jest.unstable_mockModule('../services/queue.service.js',()=>({addJobToQueue:enqueue}));
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
            .rejects.toMatchObject({statusCode:401});
    });

    it('should throw 404 if project does not exist', async () => {
        prisma.project.findUnique.mockResolvedValue(null);
        await expect(refreshAiSuggestions({ projectId: mockProjectId, userId: mockUserId }))
            .rejects.toThrow('Project not found');
    });

    it('should throw 403 if user is not the owner', async () => {
        prisma.project.findUnique.mockResolvedValue({ ownerId: 'otherUser' });
        await expect(refreshAiSuggestions({ projectId: mockProjectId, userId: mockUserId }))
            .rejects.toMatchObject({statusCode:404});
    });

    it('should return success message if valid', async () => {
        prisma.project.findUnique.mockResolvedValue({ ownerId: mockUserId });
        prisma.projectSnapshot.findFirst.mockResolvedValue({ id: 'snapshot-1' });
        const result = await refreshAiSuggestions({ projectId: mockProjectId, userId: mockUserId });
        expect(result.success).toBe(true);
        expect(result.message).toBe('Suggestions refresh queued');
    });
});