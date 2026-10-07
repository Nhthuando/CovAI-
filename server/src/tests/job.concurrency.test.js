import { jest } from '@jest/globals';
import prisma from '../config/prisma.js';
import { createSnapshotJob } from '../services/job.service.js';
import { ServiceError } from '../utils/serviceError.js';

describe('F-04 Job Concurrency (Actual DB Constraint)', () => {
    jest.setTimeout(30000);
    let projectA, projectB;
    let snapshotA, snapshotB;
    let user;

    beforeAll(async () => {
        // Clean up any leftovers from previous aborted test runs
        await prisma.job.deleteMany({ where: { userId: 'user-conc-1' } }).catch(() => {});
        await prisma.projectSnapshot.deleteMany({ where: { id: { in: ['snap-conc-A', 'snap-conc-B'] } } }).catch(() => {});
        await prisma.project.deleteMany({ where: { id: { in: ['proj-conc-A', 'proj-conc-B'] } } }).catch(() => {});
        await prisma.user.deleteMany({ where: { id: 'user-conc-1' } }).catch(() => {});

        // Create base data
        user = await prisma.user.create({
            data: {
                id: 'user-conc-1',
                email: 'concurrency@example.com',
                passwordHash: 'hash',
                name: 'Concurrency Tester'
            }
        });

        projectA = await prisma.project.create({
            data: { id: 'proj-conc-A', name: 'Proj A', ownerId: user.id }
        });
        projectB = await prisma.project.create({
            data: { id: 'proj-conc-B', name: 'Proj B', ownerId: user.id }
        });

        snapshotA = await prisma.projectSnapshot.create({
            data: { id: 'snap-conc-A', projectId: projectA.id, source: 'ZIP', rootDir: '/tmp', storagePath: '/tmp/test.zip' }
        });
        snapshotB = await prisma.projectSnapshot.create({
            data: { id: 'snap-conc-B', projectId: projectA.id, source: 'ZIP', rootDir: '/tmp', storagePath: '/tmp/test.zip' }
        });
    });

    afterAll(async () => {
        await prisma.job.deleteMany({ where: { userId: 'user-conc-1' } });
        await prisma.projectSnapshot.deleteMany({ where: { projectId: { in: [projectA.id, projectB.id] } } });
        await prisma.project.deleteMany({ where: { id: { in: [projectA.id, projectB.id] } } });
        await prisma.user.deleteMany({ where: { id: 'user-conc-1' } });
    });

    beforeEach(async () => {
        await prisma.job.deleteMany({ where: { userId: 'user-conc-1' } });
    });

    const createDummyJob = async (status, snapId, projId, type = "SUPERTEST_COVERAGE") => {
        return prisma.job.create({
            data: {
                projectId: projId,
                snapshotId: snapId,
                userId: user.id,
                type,
                status,
                progress: 0,
            }
        });
    };

    const tryCreateJob = async (snapId, projId) => {
        return createSnapshotJob({
            projectId: projId,
            snapshotId: snapId,
            userId: user.id,
            type: "SUPERTEST_COVERAGE",
        });
    };

    test('A. Existing QUEUED SUPERTEST_COVERAGE -> new request returns 409', async () => {
        await createDummyJob('QUEUED', snapshotA.id, projectA.id);
        await expect(tryCreateJob(snapshotA.id, projectA.id))
            .rejects.toMatchObject({ statusCode: 409 });
    });

    test('B. Existing RUNNING SUPERTEST_COVERAGE -> new request returns 409', async () => {
        await createDummyJob('RUNNING', snapshotA.id, projectA.id);
        await expect(tryCreateJob(snapshotA.id, projectA.id))
            .rejects.toMatchObject({ statusCode: 409 });
    });

    test('C. Existing SUCCESS -> new request succeeds', async () => {
        await createDummyJob('SUCCESS', snapshotA.id, projectA.id);
        const job = await tryCreateJob(snapshotA.id, projectA.id);
        expect(job).toBeDefined();
        expect(job.status).toBe('QUEUED');
    });

    test('D. Existing FAILED -> new request succeeds', async () => {
        await createDummyJob('FAILED', snapshotA.id, projectA.id);
        const job = await tryCreateJob(snapshotA.id, projectA.id);
        expect(job).toBeDefined();
        expect(job.status).toBe('QUEUED');
    });

    test('E. Existing active job for Snapshot A -> Snapshot B succeeds', async () => {
        await createDummyJob('RUNNING', snapshotA.id, projectA.id);
        const jobB = await tryCreateJob(snapshotB.id, projectA.id);
        expect(jobB).toBeDefined();
        expect(jobB.snapshotId).toBe(snapshotB.id);
    });

    test('F. Existing active job for Project A -> Project B succeeds', async () => {
        // Create snapshot for Project B
        const snapshotBProjectB = await prisma.projectSnapshot.create({
            data: { id: 'snap-conc-B-Proj-B', projectId: projectB.id, source: 'ZIP', rootDir: '/tmp', storagePath: '/tmp/test2.zip' }
        });

        await createDummyJob('RUNNING', snapshotA.id, projectA.id);
        const jobB = await tryCreateJob(snapshotBProjectB.id, projectB.id);
        expect(jobB).toBeDefined();
        expect(jobB.projectId).toBe(projectB.id);

        await prisma.projectSnapshot.delete({ where: { id: snapshotBProjectB.id } });
    });

    test('G. Concurrent request race: only one creates an active Job, other throws 409', async () => {
        // Directly hit prisma to simulate two transactions inserting at exactly the same time,
        // bypassing the application `assertNoActiveJob` preflight which usually masks this.
        
        const insert1 = prisma.job.create({
            data: {
                projectId: projectA.id,
                snapshotId: snapshotA.id,
                userId: user.id,
                type: "SUPERTEST_COVERAGE",
                status: "QUEUED",
                progress: 0,
            }
        });

        const insert2 = prisma.job.create({
            data: {
                projectId: projectA.id,
                snapshotId: snapshotA.id,
                userId: user.id,
                type: "SUPERTEST_COVERAGE",
                status: "QUEUED",
                progress: 0,
            }
        });

        const results = await Promise.allSettled([insert1, insert2]);
        
        const fulfilled = results.filter(r => r.status === 'fulfilled');
        const rejected = results.filter(r => r.status === 'rejected');

        expect(fulfilled.length).toBe(1);
        expect(rejected.length).toBe(1);
        expect(rejected[0].reason.code).toBe('P2002'); // Prisma Unique Constraint Violation
    });
});
