import { membershipWhere } from '../services/projectAccess.service.js';
import prisma from '../config/prisma.js';
import { getIntegrationAnalytics } from '../services/integrationReport.service.js';
import { getIntegrationGuidance } from '../services/integrationGuidance.service.js';
import { buildIntegrationExportDto, renderIntegrationReportPdf } from '../services/integrationPdf.service.js';

export const getIntegrationReport = async (req, res) => {
    try {
        const { projectId } = req.params;
        const userId = req.user.id;

        if (!projectId) {
            return res.status(400).json({ success: false, message: "Missing projectId" });
        }

        const project = await prisma.project.findFirst({
            where: { id: projectId, ...membershipWhere(userId) }
        });

        if (!project) {
            return res.status(404).json({ success: false, message: "Project not found or unauthorized" });
        }

        const analytics = await getIntegrationAnalytics(projectId);
        
        return res.status(200).json({
            success: true,
            data: analytics
        });
    } catch (error) {
        console.error("[getIntegrationReport]", error);
        return res.status(500).json({ success: false, message: "Internal server error" });
    }
};

export const getIntegrationGuidanceController = async (req, res) => {
    try {
        const { projectId } = req.params;
        const userId = req.user.id;

        if (!projectId) {
            return res.status(400).json({ success: false, message: "Missing projectId" });
        }

        const project = await prisma.project.findFirst({
            where: { id: projectId, ...membershipWhere(userId) }
        });

        if (!project) {
            return res.status(404).json({ success: false, message: "Project not found or unauthorized" });
        }

        const guidanceResponse = await getIntegrationGuidance(projectId);
        
        return res.status(200).json(guidanceResponse);
    } catch (error) {
        console.error("[getIntegrationGuidanceController]", error);
        return res.status(500).json({ success: false, message: "Internal server error" });
    }
};

const safeFilenameSlug = (name) => {
    const slug = String(name || 'project')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 48);
    return slug || 'project';
};

export const exportIntegrationReport = async (req, res) => {
    try {
        const { projectId } = req.params;
        const userId = req.user.id;
        const format = String(req.query.format || 'json').trim().toLowerCase();
        const requestedSnapshotId = typeof req.query.snapshotId === 'string' ? req.query.snapshotId.trim() : null;

        if (!projectId) {
            return res.status(400).json({ success: false, message: "Missing projectId" });
        }
        if (format !== 'json' && format !== 'pdf') {
            return res.status(400).json({ success: false, message: "Unsupported format. Use 'pdf' or 'json'." });
        }

        const project = await prisma.project.findFirst({
            where: { id: projectId, ...membershipWhere(userId) },
            select: { id: true, name: true, description: true, repoUrl: true }
        });

        if (!project) {
            return res.status(404).json({ success: false, message: "Project not found or unauthorized" });
        }

        const analytics = await getIntegrationAnalytics(projectId);
        const targetSnapshotId = requestedSnapshotId || analytics?.overview?.snapshotId || null;

        let workspace = null;
        if (targetSnapshotId && !analytics?.isPeakCoverageReport) {
            try {
                const { buildIntegrationWorkspace } = await import('../services/integrationWorkspace.service.js');
                const wsResult = await buildIntegrationWorkspace(targetSnapshotId);
                workspace = wsResult?.payload || wsResult || null;
            } catch (wsErr) {
                console.warn("[exportIntegrationReport] Workspace enrichment skipped:", wsErr?.message);
            }
        }

        const exportDto = buildIntegrationExportDto({
            project,
            report: analytics,
            workspace,
            snapshotId: targetSnapshotId,
        });

        const slug = safeFilenameSlug(project.name || projectId);
        res.setHeader('Cache-Control', 'no-store');

        if (format === 'pdf') {
            const pdfBuffer = await renderIntegrationReportPdf(exportDto);
            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', `attachment; filename="${slug}-integration-report.pdf"`);
            return res.status(200).send(pdfBuffer);
        }

        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${slug}-integration-report.json"`);
        return res.status(200).send(JSON.stringify(exportDto, null, 2));
    } catch (error) {
        console.error("[exportIntegrationReport]", error);
        return res.status(500).json({ success: false, message: "Failed to export integration report" });
    }
};
