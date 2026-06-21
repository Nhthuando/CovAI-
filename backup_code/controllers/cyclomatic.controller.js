import prisma from '../config/prisma.js';
import { runCyclomaticAnalysis } from '../services/cyclomaticAnalysis.service.js';

export const calculateComplexity = async (req, res) => {
    try {
        const { snapshotId } = req.body;
        const userId = req.user.id;

        const snapshot = await prisma.projectSnapshot.findUnique({
            where: { id: snapshotId },
            include: { project: true }
        });

        if (!snapshot) {
            return res.status(404).json({ error: 'Snapshot not found' });
        }

        if (snapshot.project.ownerId !== userId) {
            return res.status(403).json({ error: 'Unauthorized' });
        }

        const results = await runCyclomaticAnalysis(snapshotId);
        res.json(results);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: error.message });
    }
};

export const getComplexity = async (req, res) => {
    try {
        const snapshotId = req.params.snapshotId ?? req.query.snapshotId;
        const { filePath, functionName } = req.query;
        const userId = req.user.id;

        if (!snapshotId) {
            return res.status(400).json({ error: 'snapshotId is required' });
        }

        const where = { snapshotId };
        if (filePath) where.filePath = filePath;
        if (functionName) where.functionName = functionName;

        // Verify ownership
        const snapshot = await prisma.projectSnapshot.findUnique({
            where: { id: snapshotId },
            include: { project: true }
        });

        if (!snapshot) {
            return res.status(404).json({ error: 'Snapshot not found' });
        }

        if (snapshot.project.ownerId !== userId) {
            console.log(`Auth failed: snapshot.project.ownerId (${snapshot.project.ownerId}) !== userId (${userId})`);
            return res.status(403).json({ error: 'Unauthorized' });
        }

        const results = await prisma.cyclomatic.findMany({
            where,
            orderBy: { value: 'desc' }
        });

        res.json(results);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: error.message });
    }
};