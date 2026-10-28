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

jest.unstable_mockModule('../services/integrationGuidance.service.js', () => ({
    getIntegrationGuidance: jest.fn()
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
const { getIntegrationGuidance } = await import('../services/integrationGuidance.service.js');
const { getIntegrationReport, getIntegrationGuidanceController } = await import('./report.controller.js');
const { authMiddleware } = await import('../middlewares/auth.middleware.js');

// Setup Express App for Supertest
const app = express();
app.use(express.json());
const router = express.Router();
router.use(authMiddleware);
router.get('/project/:projectId/integration', getIntegrationReport);
router.get('/project/:projectId/integration/guidance', getIntegrationGuidanceController);
app.use('/api/reports', router);

describe('report.controller', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('GET /api/reports/project/:projectId/integration', () => {
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

    describe('GET /api/reports/project/:projectId/integration/guidance', () => {
        it('authenticated project owner receives 200 and exact response contract', async () => {
            prisma.project.findFirst.mockResolvedValue({ id: 'p1', ownerId: 'user1' });
            
            const mockGuidanceResponse = {
                success: true,
                data: {
                    rules: [
                        {
                            id: "RULE_NO_EXECUTION",
                            severity: "WARNING",
                            result: "Generated integration scenarios have not been executed.",
                            finding: "Scenarios exist but have not been validated against the active codebase.",
                            evidence: "5 AiTest scenarios exist; 0 TestRun records found.",
                            evidenceData: { scenarios: 5, testRuns: 0 },
                            recommendedAction: "Click 'Execute Tests' in the Integration Workbench.",
                            actionType: "EXECUTE_TESTS",
                            expectedImpact: "Establish a baseline integration execution result."
                        }
                    ]
                }
            };
            getIntegrationGuidance.mockResolvedValue(mockGuidanceResponse);

            const res = await request(app).get('/api/reports/project/p1/integration/guidance');

            expect(res.status).toBe(200);
            expect(res.body).toEqual(mockGuidanceResponse);
            expect(getIntegrationGuidance).toHaveBeenCalledWith('p1');
        });

        it('inaccessible/nonexistent project is rejected with 404', async () => {
            prisma.project.findFirst.mockResolvedValue(null);

            const res = await request(app).get('/api/reports/project/p2/integration/guidance');

            expect(res.status).toBe(404);
            expect(res.body.success).toBe(false);
            expect(res.body.message).toBe("Project not found or unauthorized");
            expect(getIntegrationGuidance).not.toHaveBeenCalled();
        });

        it('empty rules response contract', async () => {
            prisma.project.findFirst.mockResolvedValue({ id: 'p3', ownerId: 'user1' });
            
            const mockGuidanceResponse = {
                success: true,
                data: { rules: [] }
            };
            getIntegrationGuidance.mockResolvedValue(mockGuidanceResponse);

            const res = await request(app).get('/api/reports/project/p3/integration/guidance');

            expect(res.status).toBe(200);
            expect(res.body).toEqual(mockGuidanceResponse);
        });

        it('multiple rules response contract', async () => {
            prisma.project.findFirst.mockResolvedValue({ id: 'p4', ownerId: 'user1' });
            
            const mockGuidanceResponse = {
                success: true,
                data: {
                    rules: [
                        { id: 'RULE_SOME_FAILED', severity: 'ERROR' },
                        { id: 'RULE_ENDPOINTS_UNCOVERED', severity: 'WARNING' }
                    ]
                }
            };
            getIntegrationGuidance.mockResolvedValue(mockGuidanceResponse);

            const res = await request(app).get('/api/reports/project/p4/integration/guidance');

            expect(res.status).toBe(200);
            expect(res.body.data.rules).toHaveLength(2);
        });

        it('malformed/internal service error returns 500', async () => {
            prisma.project.findFirst.mockResolvedValue({ id: 'p5', ownerId: 'user1' });
            getIntegrationGuidance.mockRejectedValue(new Error("Service failed"));

            const res = await request(app).get('/api/reports/project/p5/integration/guidance');

            expect(res.status).toBe(500);
            expect(res.body.success).toBe(false);
            expect(res.body.message).toBe("Internal server error");
        });
    });
});
