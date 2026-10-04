import request from "supertest";
import express from "express";
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, jest } from "@jest/globals";

const prismaMock = {
    projectSnapshot: {
        findFirst: jest.fn(),
        findUnique: jest.fn(),
    },
    testScenario: {findFirst:jest.fn()},
    testRun: {
        findMany: jest.fn(),
    },
    aiTest: {
        findFirst: jest.fn(),
    },
};

await jest.unstable_mockModule("../config/prisma.js", () => ({
    default: prismaMock,
}));

await jest.unstable_mockModule("../middlewares/auth.middleware.js", () => ({
    authMiddleware: (req, _res, next) => {
        if (req.headers["x-test-unauth"]) {
            return _res.status(401).json({ success: false, message: "Unauthorized." });
        }
        req.user = { id: "user-123" };
        next();
    },
}));

const { default: coverageRouter } = await import("../routes/coverage.route.js");

const app = express();
app.use(express.json());
app.use("/api/coverage", coverageRouter);

describe('system evidence ownership',()=>{
    it('does not save a failed AI candidate as VERIFIED',async()=>{
        prismaMock.projectSnapshot.findUnique.mockResolvedValueOnce({id:'snap',rootDir:'/not-used',project:{ownerId:'user-123'}});
        prismaMock.aiTest.findFirst.mockResolvedValueOnce({status:'FAILED',filePath:'tests/system/candidate.spec.js'});
        const response=await request(app).post('/api/coverage/snap/system/save-ai-test');
        expect(response.status).toBe(409);
        expect(response.body.message).toContain('verification');
    });
    it('requires authentication',async()=>{
        const response=await request(app).get('/api/coverage/snap/system/scenarios/scenario/evidence').set('x-test-unauth','true');
        expect(response.status).toBe(401);
    });
    it('does not disclose evidence for another user snapshot',async()=>{
        prismaMock.projectSnapshot.findFirst.mockResolvedValueOnce(null);
        const response=await request(app).get('/api/coverage/snap/system/scenarios/scenario/evidence');
        expect(response.status).toBe(404);
        expect(prismaMock.projectSnapshot.findFirst).toHaveBeenCalledWith(expect.objectContaining({where:{id:'snap',project:{ownerId:'user-123'}}}));
        expect(prismaMock.testScenario.findFirst).not.toHaveBeenCalled();
    });
    it('serves an owned PNG from the hidden artifact directory',async()=>{
        const root=fs.mkdtempSync(path.join(os.tmpdir(),'covai-image-route-'));
        const screenshotPath='.covai-system-test/evidence/run/test.png';
        fs.mkdirSync(path.dirname(path.join(root,screenshotPath)),{recursive:true});
        fs.writeFileSync(path.join(root,screenshotPath),Buffer.from([137,80,78,71,13,10,26,10]));
        prismaMock.projectSnapshot.findFirst.mockResolvedValueOnce({id:'snap',rootDir:root});
        prismaMock.testScenario.findFirst.mockResolvedValueOnce({screenshotPath});
        try {
            const response=await request(app).get('/api/coverage/snap/system/scenarios/scenario/evidence');
            expect(response.status).toBe(200);
            expect(response.headers['content-type']).toContain('image/png');
            expect(response.headers['cache-control']).toBe('private, no-store');
            expect(prismaMock.testScenario.findFirst).toHaveBeenCalledWith({where:{id:'scenario',testRun:{snapshotId:'snap'}}});
        } finally {fs.rmSync(root,{recursive:true,force:true});}
    });
});

describe("GET /api/coverage/:snapshotId/system/summary route", () => {
    it("returns 401 when unauthorized", async () => {
        const res = await request(app)
            .get("/api/coverage/snap-1/system/summary")
            .set("x-test-unauth", "true");

        expect(res.status).toBe(401);
        expect(res.body.success).toBe(false);
    });

    it("returns 404 if snapshot does not exist", async () => {
        prismaMock.projectSnapshot.findUnique.mockResolvedValueOnce(null);

        const res = await request(app).get("/api/coverage/snap-999/system/summary");

        expect(res.status).toBe(404);
        expect(res.body.success).toBe(false);
    });

    it("returns 403 if project is not owned by user", async () => {
        prismaMock.projectSnapshot.findUnique.mockResolvedValueOnce({
            id: "snap-1",
            projectId: "p-1",
            rootDir: "/tmp/repo",
            project: { ownerId: "someone-else", name: "Other Project" },
        });

        const res = await request(app).get("/api/coverage/snap-1/system/summary");

        expect(res.status).toBe(403);
        expect(res.body.success).toBe(false);
    });

    it("returns Empty State (DoD 1.1) when no E2E test runs have been executed", async () => {
        prismaMock.projectSnapshot.findUnique.mockResolvedValueOnce({
            id: "snap-1",
            projectId: "p-1",
            rootDir: "/tmp/repo",
            project: { ownerId: "user-123", name: "My Project" },
        });
        prismaMock.testRun.findMany.mockResolvedValueOnce([]);

        const res = await request(app).get("/api/coverage/snap-1/system/summary");

        expect(res.status).toBe(200);
        expect(res.body).toEqual({
            success: true,
            data: {
                hasRun: false,
                e2eTests: 0,
                passed: 0,
                failed: 0,
                flaky: 0,
                coverageAvailable: false,
                featureCoverage: null,
                files: [],
                testRuns: [],
                scenarios: [],
                latestAiTest: null,
            },
        });
    });

    it("returns Populated State (DoD 1.2) when a Playwright test run exists", async () => {
        prismaMock.projectSnapshot.findUnique.mockResolvedValueOnce({
            id: "snap-1",
            projectId: "p-1",
            rootDir: "/tmp/repo",
            project: { ownerId: "user-123", name: "My Project" },
        });
        prismaMock.testRun.findMany.mockResolvedValueOnce([
            {
                id: "run-e2e-1",
                snapshotId: "snap-1",
                type: "PLAYWRIGHT",
                totalTests: 3,
                passedTests: 3,
                failedTests: 0,
                flakyTests: 0,
                skippedTests: 0,
                durationMs: 950,
                status: "PASSED",
                startedAt: new Date().toISOString(),
                finishedAt: new Date().toISOString(),
                createdAt: new Date().toISOString(),
            },
        ]);

        const res = await request(app).get("/api/coverage/snap-1/system/summary");

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.hasRun).toBe(true);
        expect(res.body.data.runner).toBe("playwright");
        expect(res.body.data.e2eTests).toBe(3);
        expect(res.body.data.passed).toBe(3);
        expect(res.body.data.failed).toBe(0);
        expect(res.body.data.flaky).toBe(0);
        expect(res.body.data.coverageAvailable).toBe(false);
        expect(res.body.data.files).toEqual([]);
    });

    it("returns Populated State with scenarios from DB and flaky count", async () => {
        prismaMock.projectSnapshot.findUnique.mockResolvedValueOnce({
            id: "snap-2",
            projectId: "p-1",
            rootDir: "/tmp/repo",
            project: { ownerId: "user-123", name: "My Project" },
        });
        prismaMock.testRun.findMany.mockResolvedValueOnce([
            {
                id: "run-e2e-2",
                snapshotId: "snap-2",
                type: "PLAYWRIGHT",
                totalTests: 4,
                passedTests: 3,
                failedTests: 0,
                flakyTests: 1,
                skippedTests: 0,
                durationMs: 1200,
                status: "PASSED",
                startedAt: new Date().toISOString(),
                finishedAt: new Date().toISOString(),
                createdAt: new Date().toISOString(),
                scenarios: [
                    {
                        id: "sc-1",
                        title: "Login success",
                        suiteName: "auth.spec.js",
                        testFile: "tests/auth.spec.js",
                        status: "passed",
                        durationMs: 300,
                        failureMessages: [],
                    },
                    {
                        id: "sc-2",
                        title: "Checkout payment",
                        suiteName: "checkout.spec.js",
                        testFile: "tests/checkout.spec.js",
                        status: "flaky",
                        durationMs: 900,
                        failureMessages: ["gateway timeout retry succeeded"],
                    },
                ],
            },
        ]);

        const res = await request(app).get("/api/coverage/snap-2/system/summary");

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.hasRun).toBe(true);
        expect(res.body.data.e2eTests).toBe(4);
        expect(res.body.data.passed).toBe(3);
        expect(res.body.data.failed).toBe(0);
        expect(res.body.data.flaky).toBe(1);
        expect(res.body.data.scenarios).toHaveLength(2);
        expect(res.body.data.scenarios[1]).toMatchObject({
            id: "sc-2",
            title: "Checkout payment",
            status: "flaky",
            failureMessages: ["gateway timeout retry succeeded"],
        });
    });
});
