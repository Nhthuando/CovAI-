import prisma from '../config/prisma.js';
import { getIntegrationAnalytics } from '../services/integrationReport.service.js';

export const getIntegrationReport = async (req, res) => {
    try {
        const { projectId } = req.params;
        const userId = req.user.id;

        if (!projectId) {
            return res.status(400).json({ success: false, message: "Missing projectId" });
        }

        const project = await prisma.project.findFirst({
            where: { id: projectId, ownerId: userId }
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
