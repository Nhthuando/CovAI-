import prisma from '../config/prisma.js';
import { getPerformanceReport } from '../services/performance.service.js';

export const getSnapshotPerformanceReport = async (req, res) => {
    console.log(`[PerformanceController] Fetching report for snapshot: ${req.params.snapshotId}`);
    try {
        const snapshot = await prisma.projectSnapshot.findFirst({
            where: { id: req.params.snapshotId, project: { ownerId: req.user.id } },
            select: { id: true }
        });
        if (!snapshot) return res.status(404).json({ error: 'Snapshot not found' });

        const report = await getPerformanceReport(snapshot.id);
        if (!report) return res.status(404).json({ error: 'Performance report not found' });
        return res.json(report);
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
};
