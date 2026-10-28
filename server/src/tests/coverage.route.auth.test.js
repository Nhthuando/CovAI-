import request from "supertest";
import express from "express";
import jwt from "jsonwebtoken";
import { describe, expect, it, beforeAll, afterAll, jest } from "@jest/globals";
import prisma from "../config/prisma.js";
import dotenv from "dotenv";

dotenv.config();
import { assertCollaborationTestDatabase } from './helpers/collaborationDb.js';

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
    let editorToken;
    let viewerToken;
    const createdUserIds = [];

    beforeAll(async () => {
        assertCollaborationTestDatabase(process.env.DATABASE_URL);
        if (!process.env.JWT_SECRET) process.env.JWT_SECRET = 'testsecret';

        const timestamp = Date.now();
        const owner = await prisma.user.create({
            data: { name: 'Owner User', email: `owner-${timestamp}@example.com`, passwordHash: 'password' }
        });
        createdUserIds.push(owner.id);
        ownerToken = generateToken(owner.id, owner.name, owner.email);

        const other = await prisma.user.create({
            data: { name: 'Other User', email: `other-${timestamp}@example.com`, passwordHash: 'password' }
        });
        createdUserIds.push(other.id);
        otherToken = generateToken(other.id, other.name, other.email);

        const project = await prisma.project.create({
            data: { name: 'Auth Test Project', ownerId: owner.id }
        });
        projectId = project.id;
        for (const role of ['EDITOR', 'VIEWER']) {
            const member = await prisma.user.create({ data: { name: role, email: `${role.toLowerCase()}-${timestamp}@example.com`, passwordHash: 'password' } });
            createdUserIds.push(member.id);
            await prisma.projectMember.create({ data: { projectId, userId: member.id, role } });
            const token = generateToken(member.id, member.name, member.email);
            if (role === 'EDITOR') editorToken = token; else viewerToken = token;
        }

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
        assertCollaborationTestDatabase(process.env.DATABASE_URL);
        if (!projectId) {
            if (createdUserIds.length) await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
            return;
        }
        await prisma.aiTest.deleteMany({ where: { projectId } });
        await prisma.projectSnapshot.deleteMany({ where: { projectId } });
        await prisma.project.deleteMany({ where: { id: projectId } });
        if (createdUserIds.length) await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
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
                
                expect(res.status).toBe(404);
            });
        });

        it(`should reject POST /regenerate request with 403`, async () => {
            const res = await request(app).post(`/coverage/${validSnapshotId}/integration/ai-test/${validAiTestId}/scenario/scen-1/regenerate`)
                .set('Authorization', `Bearer ${otherToken}`);
            expect(res.status).toBe(404);
        });
    });

    describe('shared member access', () => {
        it.each(['EDITOR', 'VIEWER'])('allows %s to read the Owner-created integration scenario', async role => {
            const res = await request(app).get(`/coverage/${validSnapshotId}/integration/ai-test/${validAiTestId}/scenario/scen-1`)
                .set('Authorization', `Bearer ${role === 'EDITOR' ? editorToken : viewerToken}`);
            expect(res.status).toBe(200);
        });
        it('rejects Viewer changes before modifying the scenario', async () => {
            const res = await request(app).put(`/coverage/${validSnapshotId}/integration/ai-test/${validAiTestId}/scenario/scen-1`)
                .set('Authorization', `Bearer ${viewerToken}`).send({ code: 'changed' });
            expect(res.status).toBe(403);
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
            const displayed = await request(app).get(`/coverage/${validSnapshotId}/integration/ai-test/${validAiTestId}/scenario/scen-1`)
                .set('Authorization', `Bearer ${ownerToken}`);
            expect(displayed.status).toBe(200);
            expect(displayed.body.data.version).toMatch(/^[a-f0-9]{64}$/);
            const res = await request(app).post(`/coverage/${validSnapshotId}/integration/ai-test/${validAiTestId}/scenario/scen-1/regenerate`)
                .set('Authorization', `Bearer ${ownerToken}`)
                .send({expectedVersion:displayed.body.data.version});
            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            const admitted = await prisma.job.findUnique({where:{id:res.body.jobId},include:{projectOperation:true}});
            expect(admitted.userId).toBe(jwt.verify(ownerToken,process.env.JWT_SECRET).userId);
            expect(admitted.projectOperation).toMatchObject({status:'QUEUED',snapshotId:validSnapshotId});
            expect(JSON.parse(admitted.payloadJson)).toMatchObject({mode:'SUPERTEST_REGENERATE',aiTestId:validAiTestId,expectedVersion:displayed.body.data.version});
            const {addJobToQueue}=await import('../services/queue.service.js');
            expect(addJobToQueue).toHaveBeenCalledWith('AI_TESTS',res.body.jobId,expect.objectContaining({snapshotId:validSnapshotId,userId:admitted.userId}));
        });
        it('rejects regeneration with missing or stale displayed versions',async()=>{
            for(const [body,status] of [[{},428],[{expectedVersion:'0'.repeat(64)},409]]) {
                const res=await request(app).post(`/coverage/${validSnapshotId}/integration/ai-test/${validAiTestId}/scenario/scen-1/regenerate`)
                    .set('Authorization',`Bearer ${ownerToken}`).send(body);
                expect(res.status).toBe(status);
            }
            expect(await prisma.job.count({where:{projectId}})).toBe(1);
        });
    });
});
