import * as service from '../services/codeHygiene.service.js';
import { createCodeHygieneJob } from '../services/job.service.js';
import { addJobToQueue } from '../services/queue.service.js';
import prisma from '../config/prisma.js';

const findOwnedSnapshot = (snapshotId, userId) => prisma.projectSnapshot.findFirst({
    where: { id: snapshotId, project: { ownerId: userId } },
    select: { id: true, projectId: true, rootDir: true, storagePath: true }
});

export const runAnalysis = async (req, res) => {
    try {
        const snapshot = await findOwnedSnapshot(req.params.snapshotId, req.user.id);
        if (!snapshot) return res.status(404).json({ error: 'Snapshot not found' });

        const job = await createCodeHygieneJob({
            projectId: snapshot.projectId,
            snapshotId: snapshot.id,
            userId: req.user.id
        });
        await addJobToQueue('CODE_HYGIENE', job.id);
        return res.status(202).json({ jobId: job.id, status: job.status, snapshotId: snapshot.id });
    } catch (error) {
        return res.status(error.statusCode ?? 500).json({ error: error.message });
    }
};

export const getReport = async (req, res) => {
    try {
        const snapshot = await findOwnedSnapshot(req.params.snapshotId, req.user.id);
        if (!snapshot) return res.status(404).json({ error: 'Snapshot not found' });

        const report = await service.getCodeHygieneReport(snapshot.id);
        if (!report.summary) return res.status(404).json({ error: 'Report not found' });
        return res.json(report);
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
};

export const getProjectStats = async (req, res) => {
    try {
        const project = await prisma.project.findFirst({ where: { id: req.params.projectId, ownerId: req.user.id } });
        if (!project) return res.status(404).json({ error: 'Project not found' });

        const summaries = await prisma.codeHygieneSummary.findMany({
            where: { snapshot: { projectId: project.id } },
            orderBy: { createdAt: 'desc' },
            take: 10
        });
        return res.json(summaries);
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
};
