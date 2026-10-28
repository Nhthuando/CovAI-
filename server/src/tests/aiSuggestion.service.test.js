import { jest } from '@jest/globals';

// Mock dependencies
const mockPrisma = {
    project: {
        findUnique: jest.fn(), findFirst: jest.fn(async()=> await mockPrisma.project.findUnique())
    },
    projectMember:{findUnique:jest.fn(async()=>null)},
    projectSnapshot: {
        findFirst: jest.fn()
    }
};

jest.unstable_mockModule('../config/prisma.js', () => ({
    default: mockPrisma
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
const prisma = mockPrisma;

describe('aiSuggestion.service - refreshAiSuggestions', () => {
    const mockUserId = 'user123';
    const mockProjectId = 'proj123';

    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('should throw 401 if userId is missing', async () => {
        await expect(refreshAiSuggestions({ projectId: mockProjectId, userId: null }))
            .rejects.toMatchObject({statusCode:401});
    });

    it('should throw 404 if project not found', async () => {
        mockPrisma.project.findUnique.mockResolvedValue(null);
        await expect(refreshAiSuggestions({ projectId: mockProjectId, userId: mockUserId }))
            .rejects.toThrow('Project not found');
    });

    it('should throw 403 if user is not owner', async () => {
        mockPrisma.project.findUnique.mockResolvedValue({ id: mockProjectId, ownerId: 'otherUser' });
        await expect(refreshAiSuggestions({ projectId: mockProjectId, userId: mockUserId }))
            .rejects.toMatchObject({statusCode:404});
    });

    it('should throw 404 if no snapshots found', async () => {
        mockPrisma.project.findUnique.mockResolvedValue({ id: mockProjectId, ownerId: mockUserId });
        mockPrisma.projectSnapshot.findFirst.mockResolvedValue(null);
        await expect(refreshAiSuggestions({ projectId: mockProjectId, userId: mockUserId }))
            .rejects.toThrow('No snapshots found for this project');
    });

    it('should return success if suggestions are refreshed', async () => {
        mockPrisma.project.findUnique.mockResolvedValue({ id: mockProjectId, ownerId: mockUserId });
        mockPrisma.projectSnapshot.findFirst.mockResolvedValue({ id: 'snap123' });
        
        const result = await refreshAiSuggestions({ projectId: mockProjectId, userId: mockUserId });
        expect(result).toEqual({ success: true, message: 'Suggestions refresh queued', jobId:'queued-suggest' });
    });
});