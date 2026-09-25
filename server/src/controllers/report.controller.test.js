import { jest } from '@jest/globals';
import request from 'supertest';
import express from 'express';

// Mocks
jest.unstable_mockModule('../config/prisma.js', () => ({
    default: {
        project: {
            findFirst: jest.fn()
        }
    }
}));

jest.unstable_mockModule('../services/integrationReport.service.js', () => ({
    getIntegrationAnalytics: jest.fn()
}));

jest.unstable_mockModule('../middlewares/auth.middleware.js', () => ({
    authMiddleware: (req, res, next) => {
        req.user = { id: 'user1', email: 'test@example.com' };
        next();
    }
}));

// Import dynamically after mocks
const prisma = (await import('../config/prisma.js')).default;
const { getIntegrationAnalytics } = await import('../services/integrationReport.service.js');
const { getIntegrationReport } = await import('./report.controller.js');
const { authMiddleware } = await import('../middlewares/auth.middleware.js');

// Setup Express App for Supertest
const app = express();
app.use(express.json());
const router = express.Router();
router.use(authMiddleware);
router.get('/project/:projectId/integration', getIntegrationReport);
app.use('/api/reports', router);

describe('report.controller', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('1. authenticated user with project access receives 200 & 2. correct structure', async () => {
        prisma.project.findFirst.mockResolvedValue({ id: 'p1', ownerId: 'user1' });
        
        const mockAnalytics = {
            overview: { totalScenarios: 5 },
            latestExecution: null,
            apiCoverage: null,
            projectCodeCoverage: null,
            history: { executions: [], coverage: [], generations: [] }
        };
        getIntegrationAnalytics.mockResolvedValue(mockAnalytics);

        const res = await request(app).get('/api/reports/project/p1/integration');

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data).toEqual(mockAnalytics);
        
        // 7. Controller does not recalculate metrics
        expect(getIntegrationAnalytics).toHaveBeenCalledWith('p1');
    });

    it('3. empty project returns valid null/empty sections', async () => {
        prisma.project.findFirst.mockResolvedValue({ id: 'p2', ownerId: 'user1' });
        
        const mockAnalytics = {
            overview: null,
            latestExecution: null,
            apiCoverage: null,
            projectCodeCoverage: null,
            history: { executions: [], coverage: [], generations: [] }
        };
        getIntegrationAnalytics.mockResolvedValue(mockAnalytics);

        const res = await request(app).get('/api/reports/project/p2/integration');

        expect(res.status).toBe(200);
        expect(res.body.data.overview).toBeNull();
        expect(res.body.data.history.executions).toEqual([]);
    });

    it('4. inaccessible project is rejected & 5. nonexistent project', async () => {
        // Return null for project (either doesn't exist or doesn't belong to user1)
        prisma.project.findFirst.mockResolvedValue(null);

        const res = await request(app).get('/api/reports/project/p3/integration');

        expect(res.status).toBe(404);
        expect(res.body.success).toBe(false);
        expect(res.body.message).toBe("Project not found or unauthorized");
        
        expect(getIntegrationAnalytics).not.toHaveBeenCalled();
    });

    it('6. service errors are mapped correctly', async () => {
        prisma.project.findFirst.mockResolvedValue({ id: 'p4', ownerId: 'user1' });
        getIntegrationAnalytics.mockRejectedValue(new Error("Database connection failed"));

        const res = await request(app).get('/api/reports/project/p4/integration');

        expect(res.status).toBe(500);
        expect(res.body.success).toBe(false);
        expect(res.body.message).toBe("Internal server error");
        // internal details not exposed
        expect(res.body.error).toBeUndefined();
    });
});
