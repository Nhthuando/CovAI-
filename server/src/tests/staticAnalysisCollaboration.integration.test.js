import { jest } from '@jest/globals';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import prisma from '../config/prisma.js';
import { assertCollaborationTestDatabase } from './helpers/collaborationDb.js';
import { admitProjectOperation } from '../services/projectOperation.service.js';
import { runJobInOperationWorkspace } from '../services/projectOperationWorkspace.service.js';
import { removeProjectMember } from '../services/projectMember.service.js';

let revokeDuringCompute = false;
let owner, editor, member, project, snapshot, root;
const maybeRevoke = async () => {
    if (revokeDuringCompute) await removeProjectMember({ projectId: project.id, userId: owner.id, memberId: member.id, expectedRevision: member.revision });
};
await jest.unstable_mockModule('../services/securityScanner.service.js', () => ({
    scanLocalVulnerabilities: () => [{ type: 'NEW', severity: 'HIGH', file: 'app.js', description: 'new result' }],
    scanAiVulnerabilities: async () => { await maybeRevoke(); return []; },
}));
await jest.unstable_mockModule('../services/qualityAiAnalysis.service.js', () => ({
    runQualityAiAnalysis: async () => { await maybeRevoke(); return { securityScore: 99, securityDetails: {}, debugReport: {}, recommendations: [], aiAvailable: true, aiError: null }; },
}));
const { processQualityAnalysisJob } = await import('../services/qualityAnalysisJob.service.js');
const { processSecurityAnalysisJob } = await import('../services/securityScanJob.service.js');
const suite = process.env.COLLABORATION_INTEGRATION === 'true' ? describe : describe.skip;
suite('static analysis guarded publication on PostgreSQL', () => {
    let safe = false;
    beforeAll(() => { assertCollaborationTestDatabase(process.env.DATABASE_URL); safe = true; });
    beforeEach(async () => {
        project = undefined; owner = undefined; editor = undefined; revokeDuringCompute = false;
        root = await fs.mkdtemp(path.join(os.tmpdir(), 'covai-static-db-'));
        await fs.writeFile(path.join(root, 'app.js'), 'module.exports = 1;');
        const suffix = randomUUID();
        [owner, editor] = await Promise.all(['owner', 'editor'].map(name => prisma.user.create({ data: { name, email: `${name}-${suffix}@static.test` } })));
        project = await prisma.project.create({ data: { name: 'Static publication fixture', ownerId: owner.id } });
        member = await prisma.projectMember.create({ data: { projectId: project.id, userId: editor.id, role: 'EDITOR' } });
        snapshot = await prisma.projectSnapshot.create({ data: { projectId: project.id, source: 'ZIP', rootDir: root, storagePath: root } });
        await prisma.vulnerability.create({ data: { snapshotId: snapshot.id, type: 'OLD', severity: 'LOW', file: 'old.js', description: 'prior complete report' } });
        await prisma.qualityReport.create({ data: { projectId: project.id, snapshotId: snapshot.id, performanceScore: 1, securityScore: 1, coverageScore: 1,
            maintainabilityScore: 1, overallScore: 1, performanceDetails: '{}', securityDetails: '{}', debugReport: '{}', recommendations: '[]' } });
    });
    afterEach(async () => {
        if (!safe) return;
        if (project) await prisma.project.delete({ where: { id: project.id } });
        const ids = [owner, editor].filter(Boolean).map(user => user.id);
        if (ids.length) await prisma.user.deleteMany({ where: { id: { in: ids } } });
        if (root && path.basename(root).startsWith('covai-static-db-')) await fs.rm(root, { recursive: true, force: true });
    });
    afterAll(async () => { if (safe) await prisma.$disconnect(); });
    for (const [type, run] of [['QUALITY_ANALYSIS', processQualityAnalysisJob], ['SECURITY_ANALYSIS', processSecurityAnalysisJob]]) {
        test(`${type} commits the new report and terminal status together`, async () => {
            const admission = await admitProjectOperation({ projectId: project.id, snapshotId: snapshot.id, userId: editor.id, type });
            await runJobInOperationWorkspace(admission.jobId, () => run(admission.jobId));
            expect((await prisma.job.findUniqueOrThrow({ where: { id: admission.jobId } })).status).toBe('SUCCESS');
            if (type === 'QUALITY_ANALYSIS') expect((await prisma.qualityReport.findUniqueOrThrow({ where: { snapshotId: snapshot.id } })).securityScore).toBe(99);
            else expect((await prisma.vulnerability.findMany({ where: { snapshotId: snapshot.id } })).map(row => row.type)).toEqual(['NEW']);
        });
        test(`${type} keeps the previous complete report when its Editor is removed during computation`, async () => {
            const admission = await admitProjectOperation({ projectId: project.id, snapshotId: snapshot.id, userId: editor.id, type });
            revokeDuringCompute = true;
            await expect(runJobInOperationWorkspace(admission.jobId, () => run(admission.jobId))).rejects.toMatchObject({ statusCode: 404 });
            expect((await prisma.job.findUniqueOrThrow({ where: { id: admission.jobId } })).status).toBe('FAILED');
            expect((await prisma.qualityReport.findUniqueOrThrow({ where: { snapshotId: snapshot.id } })).securityScore).toBe(1);
            expect((await prisma.vulnerability.findMany({ where: { snapshotId: snapshot.id } })).map(row => row.type)).toEqual(['OLD']);
        });
    }
});
