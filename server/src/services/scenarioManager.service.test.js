import { jest } from '@jest/globals';

jest.unstable_mockModule('../config/prisma.js', () => ({
    default: {
        aiTest: {
            findUnique: jest.fn(),
            update: jest.fn(),
            findMany: jest.fn()
        },
        job: { findMany: jest.fn() },
        projectSnapshot: { findUnique: jest.fn() },
        testRun: { findFirst: jest.fn(), findMany: jest.fn() },
        coverageFile: { findMany: jest.fn() },
        sourceCode: { findMany: jest.fn() }
    }
}));

jest.unstable_mockModule('./gemini.service.js', () => ({
    generateText: jest.fn()
}));

const prisma = (await import('../config/prisma.js')).default;
const { generateText } = await import('./gemini.service.js');
const { 
    getScenarioService, 
    updateScenarioService, 
    addScenarioService, 
    deleteScenarioService, 
    toggleScenarioService,
    regenerateScenarioService 
} = await import('./scenarioManager.service.js');
const { processSingleSupertestTest } = await import('./supertestPostProcessor.service.js');
const { buildIntegrationWorkspace } = await import('./integrationWorkspace.service.js');

describe('scenarioManager.service', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    const mockAiTest = {
        id: '123',
        content: `
import supertest from "supertest";
import app from "../app.js";
const request = supertest;

describe("GET /api/test", () => {
    it("should work", async () => {
        await request(app).get('/test');
        expect(true).toBe(true);
    });
});
        `,
        metaJson: JSON.stringify({
            requests: [
                {
                    scenarioId: "scenario1",
                    testName: "should work",
                    enabled: true
                }
            ]
        })
    };

    describe('getScenarioService', () => {
        it('should get scenario code', async () => {
            prisma.aiTest.findUnique.mockResolvedValue(mockAiTest);
            const { code } = await getScenarioService('123', 'scenario1');
            expect(code).toContain('should work');
        });
    });

    describe('updateScenarioService', () => {
        it('should update scenario code and metaJson (rename/stable ID)', async () => {
            prisma.aiTest.findUnique.mockResolvedValue(mockAiTest);
            prisma.aiTest.update.mockResolvedValue({ id: '123' });

            const updatedCode = `
it("should work renamed", async () => {
    expect(false).toBe(false);
});`;
            
            await updateScenarioService('123', 'scenario1', updatedCode);
            
            expect(prisma.aiTest.update).toHaveBeenCalled();
            const updateCall = prisma.aiTest.update.mock.calls[0][0];
            expect(updateCall.data.content).toContain('should work renamed');
            expect(updateCall.data.content).not.toContain('should work", async');
            
            const meta = JSON.parse(updateCall.data.metaJson);
            // Stable ID preserved
            expect(meta.requests.find(r => r.scenarioId === 'scenario1').testName).toBe('should work renamed');
            expect(meta.requests.find(r => r.scenarioId === 'scenario1').userEdited).toBe(true);
        });

        it('should rollback (not update) if syntax is invalid', async () => {
            prisma.aiTest.findUnique.mockResolvedValue(mockAiTest);
            
            const invalidCode = `it("should fail", async () => { expect(false).toBe(false);`; // missing closing
            
            await expect(updateScenarioService('123', 'scenario1', invalidCode)).rejects.toThrow();
            expect(prisma.aiTest.update).not.toHaveBeenCalled(); // Atomicity
        });
    });

    describe('deleteScenarioService', () => {
        it('should remove scenario code and metaJson request', async () => {
            prisma.aiTest.findUnique.mockResolvedValue(mockAiTest);
            prisma.aiTest.update.mockResolvedValue({ id: '123' });

            await deleteScenarioService('123', 'scenario1');
            
            expect(prisma.aiTest.update).toHaveBeenCalled();
            const updateCall = prisma.aiTest.update.mock.calls[0][0];
            expect(updateCall.data.content).not.toContain('should work');
            
            const meta = JSON.parse(updateCall.data.metaJson);
            expect(meta.requests.find(r => r.scenarioId === 'scenario1')).toBeUndefined();
        });
    });

    describe('toggleScenarioService', () => {
        it('should toggle it to it.skip', async () => {
            prisma.aiTest.findUnique.mockResolvedValue(mockAiTest);
            prisma.aiTest.update.mockResolvedValue({ id: '123' });

            await toggleScenarioService('123', 'scenario1', false);
            
            expect(prisma.aiTest.update).toHaveBeenCalled();
            const updateCall = prisma.aiTest.update.mock.calls[0][0];
            expect(updateCall.data.content).toContain('it.skip("should work"');
            
            const meta = JSON.parse(updateCall.data.metaJson);
            expect(meta.requests.find(r => r.scenarioId === 'scenario1').enabled).toBe(false);
        });
    });

    describe('regenerateScenarioService', () => {
        it('should call gemini and update scenario', async () => {
            prisma.aiTest.findUnique.mockResolvedValue(mockAiTest);
            prisma.aiTest.update.mockResolvedValue({ id: '123' });
            generateText.mockResolvedValue('it("regenerated", () => {});');

            await regenerateScenarioService('123', 'scenario1', { apiDefinitions: [] });
            
            expect(generateText).toHaveBeenCalled();
            expect(prisma.aiTest.update).toHaveBeenCalled();
            const updateCall = prisma.aiTest.update.mock.calls[0][0];
            expect(updateCall.data.content).toContain('regenerated');
        });

        it('should rollback and preserve original if Gemini fails', async () => {
            prisma.aiTest.findUnique.mockResolvedValue(mockAiTest);
            generateText.mockRejectedValue(new Error('AI failed'));

            await expect(regenerateScenarioService('123', 'scenario1', {})).rejects.toThrow('AI failed');
            expect(prisma.aiTest.update).not.toHaveBeenCalled(); // Original unchanged
        });
    });

    describe('Phase 3 Root Cause Tests', () => {
        let generatedAiTest = null;
        let originalScenarioId = null;

        it('Test 1: Generate new scenarios -> verify scenarioId is persisted immediately in metaJson.requests', () => {
            const rawTest = {
                filePath: '/test.js',
                content: `
const request = require('supertest');
describe("API", () => {
    it("should generate", async () => { 
        await request(app).get('/test');
        expect(1).toBe(1); 
    });
});`
            };
            const processed = processSingleSupertestTest(rawTest, { projectId: 'p1', snapshotId: 's1' });
            expect(processed).not.toBeNull();
            const meta = JSON.parse(processed.metaJson);
            expect(meta.requests.length).toBe(1);
            expect(meta.requests[0].scenarioId).toBeDefined();
            expect(meta.requests[0].scenarioId.length).toBeGreaterThan(10); // UUID
            
            generatedAiTest = {
                id: 'new123',
                content: processed.content,
                filePath: processed.filePath,
                metaJson: processed.metaJson
            };
            originalScenarioId = meta.requests[0].scenarioId;
        });

        it('Test 2: Read workspace -> verify the same persisted scenarioId is returned to frontend', async () => {
            prisma.job.findMany.mockResolvedValue([]);
            prisma.sourceCode.findMany.mockResolvedValue([]);
            prisma.aiTest.findMany.mockResolvedValue([generatedAiTest]);
            prisma.testRun.findMany.mockResolvedValue([]);
            prisma.coverageFile.findMany.mockResolvedValue([]);
            prisma.coverageSummary = { findUnique: jest.fn().mockResolvedValue(null) };

            const workspace = await buildIntegrationWorkspace('s1');
            const uiScenario = workspace.aiTests[0].requests[0];
            
            expect(uiScenario.scenarioId).toBe(originalScenarioId);
            expect(uiScenario.testName).toBe("should generate");
        });

        it('Test 3: Rename scenario -> verify scenarioId remains identical', async () => {
            prisma.aiTest.findUnique.mockResolvedValue(generatedAiTest);
            prisma.aiTest.update.mockResolvedValue({ id: 'new123' });

            const newCode = `it("should generate renamed", async () => { await request(app).get('/test'); expect(1).toBe(1); });`;
            await updateScenarioService('new123', originalScenarioId, newCode);
            
            const updateCall = prisma.aiTest.update.mock.calls[0][0];
            const meta = JSON.parse(updateCall.data.metaJson);
            const req = meta.requests[0];
            
            expect(req.scenarioId).toBe(originalScenarioId);
            expect(req.testName).toBe("should generate renamed");

            // Update local memory for next test
            generatedAiTest.content = updateCall.data.content;
            generatedAiTest.metaJson = updateCall.data.metaJson;
        });

        it('Test 4: Refresh/reload -> verify scenarioId remains identical', async () => {
            prisma.aiTest.findMany.mockResolvedValue([generatedAiTest]);
            const workspace = await buildIntegrationWorkspace('s1');
            const uiScenario = workspace.aiTests[0].requests[0];
            
            expect(uiScenario.scenarioId).toBe(originalScenarioId);
            expect(uiScenario.testName).toBe("should generate renamed");
        });

        it('Test 5: Edit after rename -> verify mutation still targets the correct AST node', async () => {
            prisma.aiTest.findUnique.mockResolvedValue(generatedAiTest);
            prisma.aiTest.update.mockClear();
            
            const newerCode = `it("should edit again", async () => { await request(app).get('/test'); });`;
            await updateScenarioService('new123', originalScenarioId, newerCode);
            
            const updateCall = prisma.aiTest.update.mock.calls[0][0];
            expect(updateCall.data.content).toContain('should edit again');
            
            const meta = JSON.parse(updateCall.data.metaJson);
            expect(meta.requests[0].scenarioId).toBe(originalScenarioId);
            
            generatedAiTest.content = updateCall.data.content;
            generatedAiTest.metaJson = updateCall.data.metaJson;
        });

        it('Test 6: Toggle after rename -> verify only the correct scenario is affected', async () => {
            prisma.aiTest.findUnique.mockResolvedValue(generatedAiTest);
            prisma.aiTest.update.mockClear();

            await toggleScenarioService('new123', originalScenarioId, false);
            
            const updateCall = prisma.aiTest.update.mock.calls[0][0];
            expect(updateCall.data.content).toContain('it.skip("should edit again"');
            
            generatedAiTest.content = updateCall.data.content;
            generatedAiTest.metaJson = updateCall.data.metaJson;
        });

        it('Test 7: Regenerate after rename -> verify only the correct scenario is regenerated and scenarioId is preserved', async () => {
            prisma.aiTest.findUnique.mockResolvedValue(generatedAiTest);
            prisma.aiTest.update.mockClear();
            generateText.mockResolvedValue('it("regenerated after rename", async () => { await request(app).get("/test"); });');

            await regenerateScenarioService('new123', originalScenarioId, { apiDefinitions: [] });
            
            const updateCall = prisma.aiTest.update.mock.calls[0][0];
            expect(updateCall.data.content).toContain('regenerated after rename');
            
            const meta = JSON.parse(updateCall.data.metaJson);
            expect(meta.requests[0].scenarioId).toBe(originalScenarioId);
            
            generatedAiTest.content = updateCall.data.content;
            generatedAiTest.metaJson = updateCall.data.metaJson;
        });

        it('Test 8: Add scenario -> verify new stable scenarioId is persisted', async () => {
            prisma.aiTest.findUnique.mockResolvedValue(generatedAiTest);
            prisma.aiTest.update.mockClear();

            await addScenarioService('new123', 'it("new test added", async () => { await request(app).get("/test"); });', { method: 'GET', path: '/test' });
            
            const updateCall = prisma.aiTest.update.mock.calls[0][0];
            expect(updateCall.data.content).toContain('new test added');
            
            const meta = JSON.parse(updateCall.data.metaJson);
            expect(meta.requests.length).toBe(2);
            expect(meta.requests[1].scenarioId).toBeDefined();
            expect(meta.requests[1].testName).toBe('new test added');
        });

        it('Test 9: Delete scenario -> verify its metadata is removed', async () => {
            prisma.aiTest.findUnique.mockResolvedValue(generatedAiTest);
            prisma.aiTest.update.mockClear();

            await deleteScenarioService('new123', originalScenarioId);
            
            const updateCall = prisma.aiTest.update.mock.calls[0][0];
            expect(updateCall.data.content).not.toContain('regenerated after rename');
            
            const meta = JSON.parse(updateCall.data.metaJson);
            expect(meta.requests.find(r => r.scenarioId === originalScenarioId)).toBeUndefined();
        });

        it('Test 10: Legacy AiTest without scenarioId -> verify backward-compatible normalization', async () => {
            const legacyAiTest = {
                id: 'legacy_workspace',
                filePath: '/legacy.js',
                content: `
const request = require('supertest');
describe("API", () => {
    it("legacy test", async () => { await request(app).get('/test'); expect(1).toBe(1); });
});`,
                metaJson: JSON.stringify({
                    framework: "SUPERTEST",
                    requests: [ { testName: "legacy test", enabled: true } ]
                })
            };

            prisma.aiTest.findMany.mockResolvedValue([legacyAiTest]);
            const workspace = await buildIntegrationWorkspace('s1');
            
            const uiScenario = workspace.aiTests[0].requests[0];
            expect(uiScenario.scenarioId).toBeDefined(); // Fallback generated
            
            prisma.aiTest.findUnique.mockResolvedValue(legacyAiTest);
            prisma.aiTest.update.mockClear();

            await updateScenarioService('legacy_workspace', uiScenario.scenarioId, `it("renamed legacy", async () => { await request(app).get('/test'); });`);
            
            const updateCall = prisma.aiTest.update.mock.calls[0][0];
            const meta = JSON.parse(updateCall.data.metaJson);
            
            const updatedReq = meta.requests.find(r => r.scenarioId === uiScenario.scenarioId);
            expect(updatedReq).toBeDefined();
            expect(updatedReq.testName).toBe("renamed legacy");
        });
    });
});
