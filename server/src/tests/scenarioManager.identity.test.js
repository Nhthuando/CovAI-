import crypto from 'crypto';
import { jest } from '@jest/globals';
import { parse } from '@babel/parser';
import _traverse from '@babel/traverse';
const traverse = _traverse.default || _traverse;

// Mock prisma before importing the service
jest.unstable_mockModule('../config/prisma.js', () => {
    return {
        default: {
            aiTest: {
                findUnique: jest.fn(),
                update: jest.fn()
            }
        }
    };
});

const prisma = (await import('../config/prisma.js')).default;
const { 
    getScenarioService, 
    updateScenarioService, 
    deleteScenarioService, 
    toggleScenarioService 
} = await import('../services/scenarioManager.service.js');

describe('Scenario Identity Management (F-02)', () => {
    const aiTestId = 'test-id-1';
    
    beforeEach(() => {
        jest.clearAllMocks();
    });

    const createAiTestMock = (content, requests) => {
        return {
            id: aiTestId,
            content,
            metaJson: JSON.stringify({ requests })
        };
    };

    describe('Identical Names (Base)', () => {
        const id1 = 'uuid-1';
        const id2 = 'uuid-2';
        const id3 = 'uuid-3';
        const uniqueId = 'uuid-4';
        
        const content = `
            describe('My API', () => {
                it('should foo', () => { expect(1).toBe(1); });
                it('should foo', () => { expect(2).toBe(2); });
                it('should foo', () => { expect(3).toBe(3); });
                it('should bar', () => { expect(4).toBe(4); });
            });
        `;
        
        const requests = [
            { scenarioId: id1, testName: 'should foo', enabled: true },
            { scenarioId: id2, testName: 'should foo', enabled: true },
            { scenarioId: id3, testName: 'should foo', enabled: true },
            { scenarioId: uniqueId, testName: 'should bar', enabled: true }
        ];

        it('10. Existing unique-name scenario', async () => {
            const aiTest = createAiTestMock(content, requests);
            prisma.aiTest.findUnique.mockResolvedValue(aiTest);
            
            const result = await getScenarioService(aiTestId, uniqueId);
            expect(result.code).toContain("expect(4).toBe(4)");
        });

        it('1. Two (or more) scenarios with identical names resolve correctly', async () => {
            const aiTest = createAiTestMock(content, requests);
            prisma.aiTest.findUnique.mockResolvedValue(aiTest);
            
            const r1 = await getScenarioService(aiTestId, id1);
            expect(r1.code).toContain("expect(1).toBe(1)");

            const r2 = await getScenarioService(aiTestId, id2);
            expect(r2.code).toContain("expect(2).toBe(2)");

            const r3 = await getScenarioService(aiTestId, id3);
            expect(r3.code).toContain("expect(3).toBe(3)");
        });

        it('2. Edit first duplicate', async () => {
            const aiTest = createAiTestMock(content, requests);
            prisma.aiTest.findUnique.mockResolvedValue(aiTest);
            prisma.aiTest.update.mockImplementation(({ data }) => data);

            const newCode = `it('should foo', () => { expect(99).toBe(99); });`;
            const result = await updateScenarioService(aiTestId, id1, newCode);
            
            expect(result.content).toContain("expect(99).toBe(99)");
            expect(result.content).toContain("expect(2).toBe(2)");
            expect(result.content).toContain("expect(3).toBe(3)");
            
            const meta = JSON.parse(result.metaJson);
            expect(meta.requests[0].userEdited).toBe(true);
        });

        it('3. Edit second duplicate', async () => {
            const aiTest = createAiTestMock(content, requests);
            prisma.aiTest.findUnique.mockResolvedValue(aiTest);
            prisma.aiTest.update.mockImplementation(({ data }) => data);

            const newCode = `it('should foo', () => { expect(99).toBe(99); });`;
            const result = await updateScenarioService(aiTestId, id2, newCode);
            
            expect(result.content).toContain("expect(1).toBe(1)");
            expect(result.content).toContain("expect(99).toBe(99)");
            expect(result.content).toContain("expect(3).toBe(3)");
        });

        it('4. Delete first duplicate', async () => {
            const aiTest = createAiTestMock(content, requests);
            prisma.aiTest.findUnique.mockResolvedValue(aiTest);
            prisma.aiTest.update.mockImplementation(({ data }) => data);

            const result = await deleteScenarioService(aiTestId, id1);
            expect(result.content).not.toContain("expect(1).toBe(1)");
            expect(result.content).toContain("expect(2).toBe(2)");
            expect(result.content).toContain("expect(3).toBe(3)");

            const meta = JSON.parse(result.metaJson);
            expect(meta.requests.length).toBe(3);
            expect(meta.requests[0].scenarioId).toBe(id2);
        });

        it('5. Delete second duplicate', async () => {
            const aiTest = createAiTestMock(content, requests);
            prisma.aiTest.findUnique.mockResolvedValue(aiTest);
            prisma.aiTest.update.mockImplementation(({ data }) => data);

            const result = await deleteScenarioService(aiTestId, id2);
            expect(result.content).toContain("expect(1).toBe(1)");
            expect(result.content).not.toContain("expect(2).toBe(2)");
            expect(result.content).toContain("expect(3).toBe(3)");

            const meta = JSON.parse(result.metaJson);
            expect(meta.requests.length).toBe(3);
            expect(meta.requests[1].scenarioId).toBe(id3);
        });

        it('6. Toggle first duplicate', async () => {
            const aiTest = createAiTestMock(content, requests);
            prisma.aiTest.findUnique.mockResolvedValue(aiTest);
            prisma.aiTest.update.mockImplementation(({ data }) => data);

            const result = await toggleScenarioService(aiTestId, id1, false);
            expect(result.content).toMatch(/it\.skip\(['"]should foo['"], \(\) => \{\s*expect\(1\)\.toBe\(1\);\s*\}\)/);
            expect(result.content).toMatch(/it\(['"]should foo['"], \(\) => \{\s*expect\(2\)\.toBe\(2\);\s*\}\)/);

            const meta = JSON.parse(result.metaJson);
            expect(meta.requests[0].enabled).toBe(false);
            expect(meta.requests[1].enabled).toBe(true);
        });

        it('7. Toggle second duplicate', async () => {
            const aiTest = createAiTestMock(content, requests);
            prisma.aiTest.findUnique.mockResolvedValue(aiTest);
            prisma.aiTest.update.mockImplementation(({ data }) => data);

            const result = await toggleScenarioService(aiTestId, id2, false);
            expect(result.content).toMatch(/it\(['"]should foo['"], \(\) => \{\s*expect\(1\)\.toBe\(1\);\s*\}\)/);
            expect(result.content).toMatch(/it\.skip\(['"]should foo['"], \(\) => \{\s*expect\(2\)\.toBe\(2\);\s*\}\)/);
            
            const meta = JSON.parse(result.metaJson);
            expect(meta.requests[0].enabled).toBe(true);
            expect(meta.requests[1].enabled).toBe(false);
        });

        it('8. Rename one duplicate', async () => {
            const aiTest = createAiTestMock(content, requests);
            prisma.aiTest.findUnique.mockResolvedValue(aiTest);
            prisma.aiTest.update.mockImplementation(({ data }) => data);

            const newCode = `it('should completely new name', () => { expect(2).toBe(2); });`;
            const result = await updateScenarioService(aiTestId, id2, newCode);
            
            expect(result.content).toContain("should completely new name");
            expect(result.content).toContain("expect(1).toBe(1)"); // untouched
            expect(result.content).toContain("expect(3).toBe(3)"); // untouched

            const meta = JSON.parse(result.metaJson);
            expect(meta.requests[1].testName).toBe('should completely new name');
        });
    });

    describe('Edge Cases', () => {
        it('11. Legacy scenario without scenarioId resolves via testName MD5 hash (Fallback)', async () => {
            const content = `it('legacy test', () => { });`;
            const legacyHash = crypto.createHash('md5').update('legacy test').digest('hex').substring(0, 8);
            
            const aiTest = createAiTestMock(content, []); // No requests array
            prisma.aiTest.findUnique.mockResolvedValue(aiTest);
            
            const result = await getScenarioService(aiTestId, legacyHash);
            expect(result.code).toContain("legacy test");
        });

        it('12. Metadata/source mismatch throws cleanly', async () => {
            // AST only has 1 test, but meta requests 3 tests
            const content = `it('should foo', () => {});`;
            const requests = [
                { scenarioId: '1', testName: 'should foo' },
                { scenarioId: '2', testName: 'should foo' },
                { scenarioId: '3', testName: 'should foo' }
            ];

            const aiTest = createAiTestMock(content, requests);
            prisma.aiTest.findUnique.mockResolvedValue(aiTest);
            
            // Getting index 0 works
            const r1 = await getScenarioService(aiTestId, '1');
            expect(r1.code).toContain("should foo");

            // Getting index 1 should fail because AST doesn't have a second one
            await expect(getScenarioService(aiTestId, '2')).rejects.toThrow(/Scenario 'should foo' \(index 1\) not found in AST/);
            
            // Getting index 2 should fail
            await expect(getScenarioService(aiTestId, '3')).rejects.toThrow(/Scenario 'should foo' \(index 2\) not found in AST/);
        });
    });
});
