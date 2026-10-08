import request from "supertest";
import express from "express";
import jwt from "jsonwebtoken";
import { describe, expect, it, beforeAll, afterAll, jest } from "@jest/globals";
import prisma from "../config/prisma.js";
import dotenv from "dotenv";

dotenv.config();

jest.unstable_mockModule('../services/queue.service.js', () => ({
    jobQueue: { add: jest.fn() },
    addSupertestCoveragePipeline: jest.fn(),
    addJobToQueue: jest.fn()
}));

const coverageRoute = (await import("../routes/coverage.route.js")).default;

const app = express();
app.use(express.json());
app.use("/coverage", coverageRoute);

const generateToken = (userId, userName, userEmail) => {
    return jwt.sign({ userId, userName, userEmail }, process.env.JWT_SECRET || 'testsecret', { expiresIn: "1h" });
};

describe('F-01 Integration Scenario Authorization via Router', () => {
    let ownerToken;
    let otherToken;
    let validAiTestId;
    let validSnapshotId;
    let projectId;

    beforeAll(async () => {
        if (!process.env.JWT_SECRET) process.env.JWT_SECRET = 'testsecret';

        const timestamp = Date.now();
        const owner = await prisma.user.create({
            data: { name: 'Owner User', email: `owner-${timestamp}@example.com`, passwordHash: 'password' }
        });
        ownerToken = generateToken(owner.id, owner.name, owner.email);

        const other = await prisma.user.create({
            data: { name: 'Other User', email: `other-${timestamp}@example.com`, passwordHash: 'password' }
        });
        otherToken = generateToken(other.id, other.name, other.email);

        const project = await prisma.project.create({
            data: { name: 'Auth Test Project', ownerId: owner.id }
        });
        projectId = project.id;

        const snapshot = await prisma.projectSnapshot.create({
            data: { projectId: project.id, rootDir: '/test/dir', storagePath: 'test/path', source: 'ZIP' }
        });
        validSnapshotId = snapshot.id;

        const aiTest = await prisma.aiTest.create({
            data: {
                projectId: project.id,
                snapshotId: snapshot.id,
                filePath: '/test/file.spec.js',
                content: `it("test", () => {});`,
                mode: 'FULL',
                metaJson: JSON.stringify({ requests: [{ scenarioId: 'scen-1', testName: 'test', enabled: true }] })
            }
        });
        validAiTestId = aiTest.id;
    });

    afterAll(async () => {
        await prisma.aiTest.deleteMany({ where: { projectId } });
        await prisma.projectSnapshot.deleteMany({ where: { projectId } });
        await prisma.project.deleteMany({ where: { id: projectId } });
        await prisma.user.deleteMany({ where: { email: { in: ['owner@example.com', 'other@example.com'] } } });
    });

    const endpoints = [
        { method: 'get', path: (id) => `/coverage/${validSnapshotId}/integration/ai-test/${id}/scenario/scen-1` },
        { method: 'put', path: (id) => `/coverage/${validSnapshotId}/integration/ai-test/${id}/scenario/scen-1` },
        { method: 'post', path: (id) => `/coverage/${validSnapshotId}/integration/ai-test/${id}/scenario` },
        { method: 'delete', path: (id) => `/coverage/${validSnapshotId}/integration/ai-test/${id}/scenario/scen-1` },
        { method: 'patch', path: (id) => `/coverage/${validSnapshotId}/integration/ai-test/${id}/scenario/scen-1/toggle` },
    ];

    describe('E. AUTHENTICATION - No Token', () => {
        endpoints.forEach(({ method, path }) => {
            it(`should reject unauthenticated ${method.toUpperCase()} request`, async () => {
                const res = await request(app)[method](path(validAiTestId)).send({ code: "test", endpoint: "/api" });
                expect(res.status).toBe(401);
            });
        });
    });

    describe('B. NON-OWNER - Denied', () => {
        endpoints.forEach(({ method, path }) => {
            it(`should reject ${method.toUpperCase()} request with 403`, async () => {
                const res = await request(app)[method](path(validAiTestId))
                    .set('Authorization', `Bearer ${otherToken}`)
                    .send({ code: "test", endpoint: "/api", enable: true });
                
                expect(res.status).toBe(403);
                expect(res.body.message).toBe('Forbidden.');
            });
        });

        it(`should reject POST /regenerate request with 403`, async () => {
            const res = await request(app).post(`/coverage/${validSnapshotId}/integration/ai-test/${validAiTestId}/scenario/scen-1/regenerate`)
                .set('Authorization', `Bearer ${otherToken}`);
            expect(res.status).toBe(403);
            expect(res.body.message).toBe('Forbidden.');
        });
    });

    describe('C. INVALID AiTest', () => {
        endpoints.forEach(({ method, path }) => {
            it(`should return 404 for invalid AiTest ID`, async () => {
                const invalidId = '00000000-0000-0000-0000-000000000000';
                const res = await request(app)[method](path(invalidId))
                    .set('Authorization', `Bearer ${ownerToken}`)
                    .send({ code: "test", endpoint: "/api", enable: true });
                
                expect(res.status).toBe(404);
            });
        });
    });

    describe('D. SNAPSHOT MISMATCH', () => {
        it('should reject regenerateScenario if snapshotId does not match AiTest', async () => {
            const fakeSnapshot = await prisma.projectSnapshot.create({
                data: { projectId, rootDir: '/fake', storagePath: '/fake', source: 'ZIP' }
            });

            const res = await request(app).post(`/coverage/${fakeSnapshot.id}/integration/ai-test/${validAiTestId}/scenario/scen-1/regenerate`)
                .set('Authorization', `Bearer ${ownerToken}`);
            
            expect(res.status).toBe(403);
            expect(res.body.message).toBe('Snapshot mismatch.');

            await prisma.projectSnapshot.delete({ where: { id: fakeSnapshot.id } });
        });
    });

    describe('A. OWNER - Allowed & F. ROUTE COVERAGE', () => {
        it('should allow GET scenario', async () => {
            const res = await request(app).get(`/coverage/${validSnapshotId}/integration/ai-test/${validAiTestId}/scenario/scen-1`)
                .set('Authorization', `Bearer ${ownerToken}`);
            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
        });

        it('should allow POST regenerateScenario', async () => {
            const res = await request(app).post(`/coverage/${validSnapshotId}/integration/ai-test/${validAiTestId}/scenario/scen-1/regenerate`)
                .set('Authorization', `Bearer ${ownerToken}`);
            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
        });
    });
});
